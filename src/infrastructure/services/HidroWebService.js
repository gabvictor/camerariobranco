const axios = require('axios');
const HidroWebAuthService = require('./HidroWebAuthService');

/**
 * @service HidroWebService
 * Cliente HTTP oficial para consumo da API REST HidroWebService da ANA.
 * Centraliza URLs, autenticação Bearer, headers, timeouts, retentativas e qualidade de dados.
 */
class HidroWebService {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || 'https://www.ana.gov.br/hidrowebservice';
        this.timeout = options.timeout || 20000;
        this.authService = options.authService || new HidroWebAuthService({ baseUrl: this.baseUrl, timeout: this.timeout });
    }

    /**
     * Normaliza os códigos de qualidade de dados da ANA (QC)
     * @param {number|string} code Código de status da ANA
     * @returns {{ codigo: number, status: string, confiavel: boolean }}
     */
    normalizeQuality(code) {
        const num = code !== null && code !== undefined ? Number(code) : -1;
        if (num === 0) {
            return { codigo: 0, status: 'OK', confiavel: true };
        }
        if (num === 1) {
            return { codigo: 1, status: 'SUSPEITO', confiavel: false };
        }
        if (num === 2) {
            return { codigo: 2, status: 'RUIM', confiavel: false };
        }
        return { codigo: isNaN(num) ? -1 : num, status: 'DESCONHECIDO', confiavel: true };
    }

    /**
     * Executa uma requisição HTTP autenticada com suporte a renovação automática em 401
     * @param {string} endpoint 
     * @param {object} [params] 
     * @param {boolean} [isRetry=false] 
     */
    async _request(endpoint, params = {}, isRetry = false) {
        const token = await this.authService.getToken();
        const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

        try {
            const response = await axios.get(url, {
                params,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'CamRB-RioBranco-Monitoring/2.0',
                    'Accept': 'application/json, text/plain, */*'
                },
                timeout: this.timeout
            });

            return response.data;
        } catch (error) {
            const status = error.response?.status;

            // Se for 401 e ainda não for retentativa, invalida token e tenta mais uma vez
            if ((status === 401 || status === 403) && !isRetry) {
                console.warn('[HidroWeb] Token expirado ou rejeitado (HTTP ' + status + '). Renovando e tentando novamente...');
                this.authService.invalidateToken();
                return this._request(endpoint, params, true);
            }

            throw error;
        }
    }

    /**
     * Consulta a série telemétrica adotada (dados oficiais/validados de nível, chuva e vazão)
     * 
     * @param {object} options
     * @param {string} options.codigosEstacoes Código ou lista de códigos (ex: '13600002')
     * @param {'DATA_LEITURA'|'DATA_ULTIMA_ATUALIZACAO'} [options.tipoFiltroData='DATA_LEITURA']
     * @param {string} [options.dataBusca] Data de busca no formato 'YYYY-MM-DD'
     * @param {string} [options.rangeIntervalo='DIAS_30'] Intervalo (DIAS_2, DIAS_7, DIAS_14, DIAS_21, DIAS_30, HORA_24)
     * @returns {Promise<Array<object>>}
     */
    async consultarSerieTelemetricaAdotada({
        codigosEstacoes,
        tipoFiltroData = 'DATA_LEITURA',
        dataBusca = null,
        rangeIntervalo = 'DIAS_30'
    }) {
        const params = {
            'Codigos_Estacoes': String(codigosEstacoes),
            'Tipo Filtro Data': tipoFiltroData,
            'Range Intervalo de busca': rangeIntervalo
        };

        if (dataBusca) {
            params['Data de Busca (yyyy-MM-dd)'] = dataBusca;
        }

        try {
            // Tenta a versão v2 do endpoint adotado
            const data = await this._request('/EstacoesTelemetricas/HidroinfoanaSerieTelemetricaAdotada/v2', params);
            return this._extractItems(data);
        } catch (v2Error) {
            // Fallback para v1 caso v2 não responda
            try {
                const dataV1 = await this._request('/EstacoesTelemetricas/HidroinfoanaSerieTelemetricaAdotada/v1', params);
                return this._extractItems(dataV1);
            } catch (_) {
                throw v2Error;
            }
        }
    }

    /**
     * Consulta a série telemétrica detalhada (dados adotados + brutos) para diagnóstico/fallback
     * 
     * @param {object} options
     * @param {string} options.codigosEstacoes Código ou lista de códigos
     * @param {'DATA_LEITURA'|'DATA_ULTIMA_ATUALIZACAO'} [options.tipoFiltroData='DATA_LEITURA']
     * @param {string} [options.dataBusca]
     * @param {string} [options.rangeIntervalo='DIAS_30']
     * @returns {Promise<Array<object>>}
     */
    async consultarSerieTelemetricaDetalhada({
        codigosEstacoes,
        tipoFiltroData = 'DATA_LEITURA',
        dataBusca = null,
        rangeIntervalo = 'DIAS_30'
    }) {
        const params = {
            'Codigos_Estacoes': String(codigosEstacoes),
            'Tipo Filtro Data': tipoFiltroData,
            'Range Intervalo de busca': rangeIntervalo
        };

        if (dataBusca) {
            params['Data de Busca (yyyy-MM-dd)'] = dataBusca;
        }

        const data = await this._request('/EstacoesTelemetricas/HidroinfoanaSerieTelemetricaDetalhada/v2', params);
        return this._extractItems(data);
    }

    /**
     * Extrai a lista de itens do envelope de resposta da ANA
     */
    _extractItems(responsePayload) {
        if (!responsePayload) return [];

        if (Array.isArray(responsePayload)) {
            return responsePayload;
        }

        if (responsePayload.items) {
            if (Array.isArray(responsePayload.items)) {
                return responsePayload.items;
            }
            if (typeof responsePayload.items === 'object') {
                for (const key of Object.keys(responsePayload.items)) {
                    if (Array.isArray(responsePayload.items[key])) {
                        return responsePayload.items[key];
                    }
                }
                return [responsePayload.items];
            }
        }

        return [];
    }

    // ─── Futura Integração HidroSat (Estações Virtuais / Satélite) ───────────────
    /**
     * Consulta o inventário de estações virtuais HidroSat (Complemento futuro)
     */
    async consultarInventarioHidroSat(params = {}) {
        const data = await this._request('/EstacoesTelemetricas/HidrosatInventarioEstacoes/v1', params);
        return this._extractItems(data);
    }

    /**
     * Consulta a série de dados HidroSat (Complemento futuro)
     */
    async consultarSerieHidroSat(params = {}) {
        const data = await this._request('/EstacoesTelemetricas/HidrosatSerieDados/v1', params);
        return this._extractItems(data);
    }
}

module.exports = HidroWebService;
