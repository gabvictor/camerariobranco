/**
 * SystemLogger.js
 * Gerenciador centralizado de logs estruturados, interceptor de console e streaming SSE em tempo real.
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
        
        // Evita loop se já vier formatado do próprio SystemLogger
        const first = String(args[0] || '');
        if (first.startsWith('[') && first.includes('] [') && (first.includes('[INFO]') || first.includes('[WARN]') || first.includes('[ERROR]') || first.includes('[STREAM]'))) {
            return;
        }

        // Ignora ruídos e polling repetitivo
        if (first.includes('/health') || first.includes('GET /api/sync-info') || first.includes('GET /api/site-config') || first.includes('GET /api/admin/system-resources') || first.includes('GET /api/admin/logs')) {
            return;
        }

        let category = 'SYSTEM';
        if (first.includes('[SCANNER]') || first.includes('ScanScheduler') || first.includes('Scanner')) category = 'SCANNER';
        else if (first.includes('[TIMELAPSE]') || first.includes('Timelapse')) category = 'TIMELAPSE';
        else if (first.includes('[FIREBASE]') || first.includes('Firestore') || first.includes('Firebase')) category = 'DATABASE';
        else if (first.includes('[STREAM]') || first.includes('MJPEG')) category = 'STREAM';
        else if (first.includes('[PROXY]') || first.includes('proxy')) category = 'PROXY';
        else if (first.includes('[SECURITY]') || first.includes('Auth')) category = 'SECURITY';

        const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        this._add(level, category, message, null, false);
    }

    _add(level, category, message, meta = null, printToConsole = true) {
        const now = new Date();
        const entry = {
            id: this.nextId++,
            timestamp: now.toISOString(),
            timeFormatted: now.toLocaleTimeString('pt-BR', { hour12: false }),
            dateFormatted: now.toLocaleDateString('pt-BR'),
            level: level.toUpperCase(),
            category: category.toUpperCase(),
            message: String(message || ''),
            meta: meta ? (typeof meta === 'object' ? meta : { value: meta }) : null
        };

        this.logs.unshift(entry); // Mais recentes primeiro
        if (this.logs.length > this.maxEntries) {
            this.logs.length = this.maxEntries;
        }

        if (printToConsole) {
            const prefix = `[${entry.timeFormatted}] [${entry.level}] [${entry.category}]`;
            const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
            if (level === 'ERROR') {
                process.stderr.write(`${prefix} ${entry.message}${metaStr}\n`);
            } else {
                process.stdout.write(`${prefix} ${entry.message}${metaStr}\n`);
            }
        }

        // Emite para conexões SSE em tempo real
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

    stream(category, message, meta = null) {
        return this._add('STREAM', category, message, meta, true);
    }

    timelapse(message, meta = null) {
        return this._add('INFO', 'TIMELAPSE', message, meta, true);
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
        this.info('SYSTEM', `Buffer de logs limpo pelo administrador (${count} entradas removidas).`);
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
// Log inicial do sistema
logger.info('SYSTEM', 'CamRB Logger inicializado com sucesso.');

module.exports = logger;
