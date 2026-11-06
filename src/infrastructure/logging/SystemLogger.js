/**
 * SystemLogger.js
 * Gerenciador centralizado de logs estruturados com anonimização automática de tokens,
 * tradução de eventos para linguagem humana e transmissão SSE em tempo real.
 */

const EventEmitter = require('events');

class SystemLogger extends EventEmitter {
    constructor(maxEntries = 1000, { hookConsole = true } = {}) {
        super();
        this.maxEntries = maxEntries;
        this.logs = [];
        this.nextId = 1;
        // Contadores mantidos a cada log (evita recontar todas as entradas a cada evento)
        this._counts = { info: 0, warn: 0, error: 0, stream: 0 };
        if (hookConsole) this._hookConsole();
    }

    _countKey(level) {
        return { INFO: 'info', WARN: 'warn', ERROR: 'error', STREAM: 'stream' }[level] || null;
    }

    /**
     * Anonimiza e mascara qualquer token, chave de API, senha ou segredo em textos e objetos.
     */
    sanitize(input) {
        if (!input) return input;

        if (typeof input === 'object') {
            try {
                const jsonStr = JSON.stringify(input, (key, value) => {
                    const k = String(key || '').toLowerCase();
                    if (['token', 'idtoken', 'authorization', 'bearer', 'secret', 'key', 'password', 'private_key', 'privatekey'].includes(k)) {
                        return '***[DADO-SENSÍVEL-PROTEGIDO]***';
                    }
                    return value;
                });
                return JSON.parse(this._sanitizeString(jsonStr));
            } catch (_) {
                return '[Objeto Protegido]';
            }
        }

        return this._sanitizeString(String(input));
    }

    _sanitizeString(str) {
        if (!str || typeof str !== 'string') return '';

        return str
            // Mascara tokens JWT (Bearer eyJ... ou apenas eyJ...)
            .replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, 'Bearer ***[TOKEN-PROTEGIDO]***')
            .replace(/eyJ[A-Za-z0-9-_=]{10,}\.[A-Za-z0-9-_=]{10,}\.?[A-Za-z0-9-_.+/=]*/g, 'eyJ***[TOKEN-ANONIMIZADO]***')
            // Mascara tokens em query parameters (?token=..., &token=..., &apiKey=...)
            .replace(/([?&](?:token|key|apiKey|secret|auth)=)[^&\s]+/gi, '$1***[PROTEGIDO]***')
            // Mascara credenciais privadas do Firebase
            .replace(/-----BEGIN PRIVATE KEY-----[^-]+-----END PRIVATE KEY-----/gi, '***[CHAVE-PRIVADA-PROTEGIDA]***');
    }

    /**
     * Transforma mensagens técnicas brutas em explicações claras e amigáveis em Português.
     */
    _humanizeMessage(msg, category) {
        let text = this.sanitize(msg);

        // Tradução amigável de eventos comuns
        if (text.includes('CamRB Logger inicializado')) {
            return 'Sistema de monitoramento e logs iniciado com sucesso.';
        }
        if (text.includes('Scanner initialized') || text.includes('Varredura')) {
            return text.replace(/Scanner initialized/i, 'Módulo de verificação de câmeras iniciado');
        }
        // Estas duas traduções valem só para a Prefeitura. Timeout da ANA, do e-mail etc. ficam com o texto original,
        // senão o log diria que "o servidor da Prefeitura demorou" quando quem demorou foi outro serviço.
        const aboutOtherService = ['RIO ACRE', 'E-MAIL', 'ALERTAS', 'ADMIN'].includes(category);
        if (!aboutOtherService && (text.includes('ETIMEDOUT') || text.includes('timeout of'))) {
            return 'Servidor de imagens da Prefeitura demorou para responder. Aguardando novo ciclo...';
        }
        if (!aboutOtherService && (text.includes('ECONNREFUSED') || text.includes('ENOTFOUND'))) {
            return 'Servidor da Prefeitura temporariamente indisponível. Tentando reconexão...';
        }
        if (text.includes('Acesso sem token')) {
            return 'Tentativa de acesso não autorizado a área restrita bloqueada pela segurança.';
        }
        if (text.includes('Acesso negado para:')) {
            return 'Tentativa de acesso de usuário sem permissão administrativa bloqueada.';
        }
        if (text.includes('Token inválido ou expirado')) {
            return 'Sessão de usuário expirada ou token inválido. Reautenticação necessária.';
        }

        return text;
    }

    _hookConsole() {
        if (this._hooked) return;
        this._hooked = true;

        const origLog = console.log;
        const origWarn = console.warn;
        const origError = console.error;
        const origInfo = console.info;

        const self = this;

        console.log = function(...args) {
            origLog.apply(console, args);
            self._captureFromConsole('INFO', args);
        };

        console.info = function(...args) {
            origInfo.apply(console, args);
            self._captureFromConsole('INFO', args);
        };

        console.warn = function(...args) {
            origWarn.apply(console, args);
            self._captureFromConsole('WARN', args);
        };

        console.error = function(...args) {
            origError.apply(console, args);
            self._captureFromConsole('ERROR', args);
        };
    }

    /**
     * Interpreta a linha do logger de requisições. Devolve null se não for uma requisição.
     * Requisições de leitura que deram certo (GET/HEAD < 400) são rotina e não entram no histórico:
     * antes elas lotavam o buffer e empurravam para fora o que importa (erros, logins, ações do admin).
     */
    _parseRequestLine(first) {
        const m = /^\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s+(\S+)\s+→\s+(\d{3})\s+\((\d+)ms\)/.exec(first);
        if (!m) return null;

        const method = m[1];
        const path = m[2].split('?')[0]; // sem query string: pode conter dados pessoais
        const status = Number(m[3]);
        const ms = Number(m[4]);
        const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

        let level = 'INFO';
        if (status >= 500) level = 'ERROR';
        else if (status >= 400) level = 'WARN';
        else if (isRead && ms >= 3000) level = 'WARN'; // leitura lenta

        // Imagem de câmera recusada pelo bloqueio (451): é o esperado enquanto o aviso estiver no ar, não um problema
        if (status === 451) return { skip: true };
        // Rotina que deu certo: não guarda
        if (isRead && status < 400 && level === 'INFO') return { skip: true };
        // 404 de leitura fora da API costuma ser robô procurando página: não guarda
        if (isRead && status === 404 && !path.startsWith('/api/')) return { skip: true };

        let category = 'REQUISIÇÃO';
        if (path.startsWith('/api/admin') || path.startsWith('/admin') || path === '/dashboard') category = 'ADMIN';
        else if (path.startsWith('/api/auth')) category = 'SEGURANÇA';
        else if (path.startsWith('/api/alertas') || path.startsWith('/alertas')) category = 'ALERTAS';

        const slow = level === 'WARN' && status < 400 ? ' (lenta)' : '';
        return {
            level,
            category,
            message: `${method} ${path} → ${status} em ${ms} ms${slow}`,
            meta: { method, path, status, ms }
        };
    }

    _captureFromConsole(level, args) {
        if (!args || args.length === 0) return;
        
        const first = String(args[0] || '');
        if (first.startsWith('[') && first.includes('] [') && (first.includes('[INFO]') || first.includes('[WARN]') || first.includes('[ERROR]') || first.includes('[STREAM]'))) {
            return;
        }

        // Linhas do tipo "[2026-10-31T10:00:00.000Z] GET /rota → 200 (12ms)": viram entradas estruturadas
        const request = this._parseRequestLine(first);
        if (request) {
            if (request.skip) return;
            this._add(request.level, request.category, request.message, request.meta, false);
            return;
        }

        // Ignora endpoints de polling interno, stream contínuo e arquivos estáticos para manter logs limpos e economizar RAM
        if (first.includes('/health') || first.includes('GET /api/sync-info') || first.includes('GET /api/site-config') || 
            first.includes('GET /api/admin/system-resources') || first.includes('GET /api/admin/logs') ||
            first.includes('/stream/camera') || first.includes('/proxy/camera') || first.includes('/api/presence/') ||
            first.includes('/css/') || first.includes('/script/') || first.includes('/assets/') || first.includes('/favicon.ico')) {
            return;
        }

        // Etiqueta explícita ([TIMELAPSE], [RIO_ALERT]...) manda mais que uma palavra solta como "câmeras"
        const TAGS = [
            ['[RIO_ALERT]', 'ALERTAS'], ['[EMAIL_VERIFICATION]', 'E-MAIL'], ['[MAIL', 'E-MAIL'],
            ['[HidroWebAuth]', 'RIO ACRE'], ['[RioAcreService]', 'RIO ACRE'], ['[VISITANTES]', 'VISITANTES'],
            ['[SCANNER]', 'VARREDURA'], ['[TIMELAPSE]', 'TIMELAPSE'], ['[FIREBASE]', 'BANCO DE DADOS'],
            ['[STREAM]', 'TRANSMISSÃO'], ['[PROXY]', 'PROXY'], ['[SECURITY]', 'SEGURANÇA'], ['ARMADILHA', 'SEGURANÇA']
        ];
        const tagged = TAGS.find(([tag]) => first.includes(tag));

        let category = 'SISTEMA';
        if (tagged) category = tagged[1];
        else if (first.includes('ScanScheduler') || first.includes('Scanner') || first.includes('câmeras')) category = 'VARREDURA';
        else if (first.includes('Timelapse') || first.includes('snapshot')) category = 'TIMELAPSE';
        else if (first.includes('Firestore') || first.includes('Firebase') || first.includes('banco')) category = 'BANCO DE DADOS';
        else if (first.includes('MJPEG') || first.includes('transmissão')) category = 'TRANSMISSÃO';
        else if (first.includes('proxy') || first.includes('Prefeitura')) category = 'PROXY';
        else if (first.includes('Auth') || first.includes('Token') || first.includes('Acesso')) category = 'SEGURANÇA';

        const rawMsg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        this._add(level, category, rawMsg, null, false);
    }

    _add(level, category, message, meta = null, printToConsole = true) {
        const sanitizedCategory = String(category || 'SISTEMA').toUpperCase();
        const humanMessage = this._humanizeMessage(message, sanitizedCategory);
        const sanitizedMeta = meta ? this.sanitize(meta) : null;

        const now = new Date();
        const entry = {
            id: this.nextId++,
            timestamp: now.toISOString(),
            timeFormatted: now.toLocaleTimeString('pt-BR', { hour12: false }),
            dateFormatted: now.toLocaleDateString('pt-BR'),
            level: level.toUpperCase(),
            category: sanitizedCategory,
            message: humanMessage,
            meta: sanitizedMeta
        };

        this.logs.unshift(entry); // Mais recentes primeiro
        const addedKey = this._countKey(entry.level);
        if (addedKey) this._counts[addedKey]++;
        while (this.logs.length > this.maxEntries) {
            const removed = this.logs.pop();
            const removedKey = this._countKey(removed.level);
            if (removedKey) this._counts[removedKey]--;
        }

        if (printToConsole) {
            const prefix = `[${entry.timeFormatted}] [${entry.level}] [${entry.category}]`;
            const metaStr = sanitizedMeta ? ` | ${JSON.stringify(sanitizedMeta)}` : '';
            if (level === 'ERROR') {
                process.stderr.write(`${prefix} ${entry.message}${metaStr}\n`);
            } else {
                process.stdout.write(`${prefix} ${entry.message}${metaStr}\n`);
            }
        }

        // Transmite para clientes conectados via SSE
        this.emit('log', entry);

        return entry;
    }

    info(category, message, meta = null) {
        return this._add('INFO', category, message, meta, true);
    }

    warn(category, message, meta = null) {
        return this._add('WARN', category, message, meta, true);
    }

    error(category, message, meta = null) {
        return this._add('ERROR', category, message, meta, true);
    }

    stream(action, message, meta = null) {
        return this._add('STREAM', 'TRANSMISSÃO', message, meta, true);
    }

    timelapse(message, meta = null) {
        return this._add('INFO', 'TIMELAPSE', message, meta, true);
    }

    security(message, meta = null) {
        return this._add('WARN', 'SEGURANÇA', message, meta, true);
    }

    getLogs(options = {}) {
        let results = [...this.logs];
        const { level, category, search, limit = this.maxEntries, sinceId } = options;

        if (sinceId) {
            const numId = parseInt(sinceId, 10);
            results = results.filter(l => l.id > numId);
        }

        if (level && level !== 'ALL') {
            results = results.filter(l => l.level === level.toUpperCase());
        }

        if (category && category !== 'ALL') {
            results = results.filter(l => l.category === category.toUpperCase());
        }

        if (search) {
            const q = search.toLowerCase();
            results = results.filter(l => 
                l.message.toLowerCase().includes(q) ||
                l.category.toLowerCase().includes(q) ||
                (l.meta && JSON.stringify(l.meta).toLowerCase().includes(q))
            );
        }

        const maxLimit = Math.min(parseInt(limit, 10) || this.maxEntries, this.maxEntries);
        return results.slice(0, maxLimit);
    }

    clear() {
        const count = this.logs.length;
        this.logs = [];
        this._counts = { info: 0, warn: 0, error: 0, stream: 0 };
        this.info('SISTEMA', `Histórico de logs limpo pelo administrador (${count} registros removidos).`);
        return true;
    }

    getStats() {
        return { total: this.logs.length, ...this._counts, max: this.maxEntries };
    }
}

const logger = new SystemLogger();
logger.info('SISTEMA', 'Monitor de logs e proteção de dados inicializado com sucesso.');

module.exports = logger;
module.exports.SystemLogger = SystemLogger;
