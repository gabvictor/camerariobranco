const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * @service HidroWebAuthService
 * Responsável pela obtenção, armazenamento em memória e renovação segura
 * dos tokens de autenticação do HidroWebService da ANA.
 * 
 * NUNCA expõe senhas ou tokens nos logs ou respostas públicas.
 */
class HidroWebAuthService {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || 'https://www.ana.gov.br/hidrowebservice';
        this.timeout = options.timeout || 15000;
        this._token = null;
        this._tokenExpiresAt = 0;
        this._authPromise = null;
        this._secretPath = null;
    }

    /**
     * Localiza o caminho do arquivo secreto serviceAccountKey.json
     * utilizando a estratégia de resolução segura do projeto.
     */
    _resolveSecretPath() {
        if (this._secretPath) return this._secretPath;

        const candidates = [
            process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
            '/etc/secrets/serviceAccountKey.json',
            path.resolve(process.cwd(), 'serviceAccountKey.json')
        ].filter(Boolean);

        const found = candidates.find(candidate => {
            try {
                return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
            } catch {
                return false;
            }
        });

        if (found) {
            this._secretPath = found;
        }
        return found;
    }

    /**
     * Carrega as credenciais da ANA de forma segura do backend
     * sem nunca expor ou registrar os valores.
     */
    getCredentials() {
        // 1. Variáveis de ambiente têm prioridade
        const envUser = process.env.ANA_HIDROWEB_USUARIO || process.env.ANA_HIDROWEB_IDENTIFICADOR || process.env.ANA_HIDROWEB_LOGIN;
        const envPass = process.env.ANA_HIDROWEB_SENHA || process.env.ANA_HIDROWEB_PASSWORD;

        if (envUser && envPass) {
            return {
                usuario: String(envUser).trim(),
                senha: String(envPass).trim(),
                fonte: 'env'
            };
        }

        // 2. Leitura do serviceAccountKey.json
        const secretPath = this._resolveSecretPath();
        if (secretPath) {
            try {
                const raw = fs.readFileSync(secretPath, 'utf8');
                const parsed = JSON.parse(raw);

                const anaConfig = parsed.hidroWebANA || parsed.hidrowebana || parsed.ana || parsed.hidroWeb || parsed.hidroweb;
                if (anaConfig && typeof anaConfig === 'object') {
                    const usuario = anaConfig.usuario || anaConfig.identificador || anaConfig.email || anaConfig.login || anaConfig.user;
                    const senha = anaConfig.senha || anaConfig.password || anaConfig.pass;

                    if (usuario && senha) {
                        return {
                            usuario: String(usuario).trim(),
                            senha: String(senha).trim(),
                            fonte: 'serviceAccountKey.json'
                        };
                    }
                }
            } catch (err) {
                // Silencioso por segurança
            }
        }

        return null;
    }

    /**
     * Verifica se as credenciais da ANA estão configuradas no ambiente
     */
    hasCredentials() {
        return this.getCredentials() !== null;
    }

    /**
     * Retorna o token Bearer válido, reutilizando o cache em memória
     * ou autenticando/renovando quando necessário.
     */
    async getToken(forceRefresh = false) {
        const now = Date.now();
        const safetyMarginMs = 5 * 60 * 1000; // 5 minutos de margem antes de expirar

        if (!forceRefresh && this._token && (now < this._tokenExpiresAt - safetyMarginMs)) {
            return this._token;
        }

        // Se já houver uma autenticação em andamento, aguarda a mesma promise (evita chamadas simultâneas)
        if (this._authPromise) {
            return this._authPromise;
        }

        this._authPromise = (async () => {
            try {
                const isRenewal = !!this._token;
                const token = await this._authenticate();
                if (isRenewal) {
                    console.log('[HidroWebAuth] Token renovado com sucesso');
                } else {
                    console.log('[HidroWebAuth] Token obtido com sucesso');
                }
                return token;
            } finally {
                this._authPromise = null;
            }
        })();

        return this._authPromise;
    }

    /**
     * Executa a requisição de autenticação na API HidroWebService
     */
    async _authenticate() {
        const credentials = this.getCredentials();
        if (!credentials) {
            console.warn('[HidroWebAuth] Credenciais da ANA não configuradas em serviceAccountKey.json ou variáveis de ambiente');
            throw new Error('Credenciais da ANA não configuradas');
        }

        const url = `${this.baseUrl}/EstacoesTelemetricas/OAUth/v1`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'Identificador': credentials.usuario,
                    'Senha': credentials.senha,
                    'User-Agent': 'CamRB-RioBranco-Monitoring/2.0',
                    'Accept': 'application/json, text/plain, */*'
                },
                timeout: this.timeout
            });

            const data = response.data;
            let tokenStr = null;

            if (typeof data === 'string' && data.length > 20) {
                tokenStr = data;
            } else if (data && typeof data === 'object') {
                if (typeof data.items === 'string') {
                    tokenStr = data.items;
                } else if (data.items && typeof data.items === 'object') {
                    // Prioriza o token JWT de autenticação (tokenautenticacao) exigido pela API da ANA
                    tokenStr = data.items.tokenautenticacao || data.items.tokenAutenticacao || data.items.access_token || data.items.accessToken || data.items.usuarioToken || data.items.tokenDeAcesso || data.items.token;
                } else if (data.tokenautenticacao || data.tokenAutenticacao || data.access_token || data.accessToken || data.token) {
                    tokenStr = data.tokenautenticacao || data.tokenAutenticacao || data.access_token || data.accessToken || data.token;
                }
            }

            if (!tokenStr || typeof tokenStr !== 'string') {
                throw new Error('Resposta de autenticação da ANA não continha token válido');
            }

            tokenStr = tokenStr.trim();
            this._token = tokenStr;
            this._tokenExpiresAt = this._calculateExpiration(tokenStr);

            return this._token;
        } catch (error) {
            const status = error.response?.status;
            if (status === 401 || status === 403) {
                console.warn('[HidroWebAuth] Falha na autenticação da ANA: Credenciais recusadas (HTTP ' + status + ')');
            } else {
                console.warn('[HidroWebAuth] Erro ao comunicar com endpoint de autenticação da ANA:', error.message);
            }
            this.invalidateToken();
            throw error;
        }
    }

    /**
     * Calcula a data de expiração do token baseado na claim exp do JWT
     * ou adota um TTL padrão de 12 horas.
     */
    _calculateExpiration(token) {
        try {
            const parts = token.split('.');
            if (parts.length === 3) {
                const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
                const payload = JSON.parse(payloadStr);
                if (payload.exp && typeof payload.exp === 'number') {
                    return payload.exp * 1000;
                }
            }
        } catch (_) {}

        // Fallback: 12 horas a partir de agora
        return Date.now() + (12 * 60 * 60 * 1000);
    }

    /**
     * Invalida o token em memória (útil em caso de erro 401 durante chamadas de API)
     */
    invalidateToken() {
        this._token = null;
        this._tokenExpiresAt = 0;
    }
}

module.exports = HidroWebAuthService;
