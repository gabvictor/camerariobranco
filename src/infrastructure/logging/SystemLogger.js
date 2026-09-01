/**
 * SystemLogger.js
 * Gerenciador centralizado de logs estruturados com anonimização automática de tokens,
 * tradução de eventos para linguagem humana e transmissão SSE em tempo real.
 */

const EventEmitter = require('events');

class SystemLogger extends EventEmitter {
    constructor(maxEntries = 1000) {
        super();
        this.maxEntries = maxEntries;
        this.logs = [];
        this.nextId = 1;
        this._hookConsole();
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
        if (text.includes('ETIMEDOUT') || text.includes('timeout of')) {
            return 'Servidor de imagens da Prefeitura demorou para responder. Aguardando novo ciclo...';
        }
        if (text.includes('ECONNREFUSED') || text.includes('ENOTFOUND')) {
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

    _captureFromConsole(level, args) {
        if (!args || args.length === 0) return;
        
        const first = String(args[0] || '');
        if (first.startsWith('[') && first.includes('] [') && (first.includes('[INFO]') || first.includes('[WARN]') || first.includes('[ERROR]') || first.includes('[STREAM]'))) {
            return;
        }

        // Ignora endpoints de polling interno e arquivos estáticos para manter logs limpos
        if (first.includes('/health') || first.includes('GET /api/sync-info') || first.includes('GET /api/site-config') || 
            first.includes('GET /api/admin/system-resources') || first.includes('GET /api/admin/logs') ||
            first.includes('/css/') || first.includes('/script/') || first.includes('/assets/') || first.includes('/favicon.ico')) {
            return;
        }

        let category = 'SISTEMA';
        if (first.includes('[SCANNER]') || first.includes('ScanScheduler') || first.includes('Scanner') || first.includes('câmeras')) category = 'VARREDURA';
        else if (first.includes('[TIMELAPSE]') || first.includes('Timelapse') || first.includes('snapshot')) category = 'TIMELAPSE';
        else if (first.includes('[FIREBASE]') || first.includes('Firestore') || first.includes('Firebase') || first.includes('banco')) category = 'BANCO DE DADOS';
        else if (first.includes('[STREAM]') || first.includes('MJPEG') || first.includes('transmissão')) category = 'TRANSMISSÃO';
        else if (first.includes('[PROXY]') || first.includes('proxy') || first.includes('Prefeitura')) category = 'PROXY';
        else if (first.includes('[SECURITY]') || first.includes('Auth') || first.includes('Token') || first.includes('Acesso')) category = 'SEGURANÇA';

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
        if (this.logs.length > this.maxEntries) {
            this.logs.length = this.maxEntries;
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
        const { level, category, search, limit = 250, sinceId } = options;

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

        const maxLimit = Math.min(parseInt(limit, 10) || 250, 1000);
        return results.slice(0, maxLimit);
    }

    clear() {
        const count = this.logs.length;
        this.logs = [];
        this.info('SISTEMA', `Histórico de logs limpo pelo administrador (${count} registros removidos).`);
        return true;
    }

    getStats() {
        const counts = { total: this.logs.length, info: 0, warn: 0, error: 0, stream: 0 };
        for (const l of this.logs) {
            if (l.level === 'INFO') counts.info++;
            else if (l.level === 'WARN') counts.warn++;
            else if (l.level === 'ERROR') counts.error++;
            else if (l.level === 'STREAM') counts.stream++;
        }
        return counts;
    }
}

const logger = new SystemLogger();
logger.info('SISTEMA', 'Monitor de logs e proteção de dados inicializado com sucesso.');

module.exports = logger;
