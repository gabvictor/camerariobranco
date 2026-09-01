const { admin, ADMIN_EMAIL } = require('../config/firebaseAdmin');
const CONFIG = require('../config/appConfig');

const hasValidAdminEmail = Boolean(ADMIN_EMAIL && ADMIN_EMAIL.trim().length > 0);

const isUserAdmin = (email) => {
    if (!hasValidAdminEmail || !email) return false;
    return String(email).toLowerCase().trim() === ADMIN_EMAIL;
};

const parseCookies = (req) => {
    const list = {};
    const rc = req.headers.cookie;
    if (!rc) return list;
    rc.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        if (parts.length >= 2) {
            const key = parts.shift().trim();
            const val = decodeURIComponent(parts.join('=')).trim();
            list[key] = val;
        }
    });
    return list;
};

// ─── Middleware: Verify Admin Token (API Routes & SSE Streams) ────────────────
const verifyAdmin = async (req, res, next) => {
    let idToken = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        idToken = authHeader.split('Bearer ')[1];
    } else if (req.query && req.query.token) {
        idToken = req.query.token;
    } else {
        const cookies = parseCookies(req);
        if (cookies.__session_token) idToken = cookies.__session_token;
    }

    if (!idToken) {
        return res.status(403).json({ message: 'Acesso negado: Token não fornecido.' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        if (isUserAdmin(decodedToken.email)) {
            req.user = decodedToken;
            next();
        } else {
            console.warn(`[SECURITY] Acesso negado para: ${decodedToken.email} em ${req.originalUrl}`);
            res.status(403).json({ message: 'Acesso negado: Permissões insuficientes.' });
        }
    } catch (error) {
        console.error(`[SECURITY] Erro na verificação do token: ${error.message}`);
        res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
};

// ─── Middleware: Verify Optional Admin (para rotas públicas com conteúdo extra) ───
const verifyOptionalAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    req.userIsAdmin = false;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split('Bearer ')[1];
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            if (isUserAdmin(decodedToken.email)) {
                req.userIsAdmin = true;
                req.user = decodedToken;
            }
        } catch { /* Token inválido — ignora silenciosamente */ }
    }
    next();
};

// ─── Middleware: Verify Admin Page Session (Proteção de HTML de Admin no Servidor) ──
const verifyAdminPageSession = async (req, res, next) => {
    const cookies = parseCookies(req);
    const sessionCookie = cookies.__session;

    if (sessionCookie) {
        try {
            const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
            if (isUserAdmin(decodedClaims.email)) {
                req.user = decodedClaims;
                return next();
            }
        } catch {
            // Cookie expirado ou inválido
        }
    }

    // Se não for admin autenticado, redireciona para a página de login
    return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
};

// ─── Middleware: Rate Limiter ───────────────────────────────────────────────────
const createRateLimiter = ({ windowMs = 60 * 1000, max = 60, message = 'Muitas requisições. Aguarde um momento.' } = {}) => {
    const hits = new Map();

    const cleanup = () => {
        const now = Date.now();
        for (const [ip, data] of hits.entries()) {
            if (now - data.startTime > windowMs) hits.delete(ip);
        }
    };
    const timer = setInterval(cleanup, windowMs);
    timer.unref();

    return (req, res, next) => {
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        const now = Date.now();
        const clientData = hits.get(ip) || { count: 0, startTime: now };

        if (now - clientData.startTime > windowMs) {
            clientData.count = 0;
            clientData.startTime = now;
        }

        clientData.count++;
        hits.set(ip, clientData);

        if (clientData.count > max) {
            res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
            return res.status(429).json({ error: message });
        }

        next();
    };
};

// ─── Middleware: Anti-Bot Tarpit Seguro (Sem travar conexões) ───────────────────
const rotasIsca = [
    '/.env', '/.git/config', '/phpmyadmin', '/backup.zip',
    '/config.bak', '/.well-known/security.txt', '/manager/html',
    '/wp-login.php', '/wp-admin'
];

const tarpit = (req, res, next) => {
    const caminho = req.path.toLowerCase();

    if (
        rotasIsca.some(isca => caminho.includes(isca)) ||
        caminho.endsWith('.php') ||
        caminho.startsWith('/wp')
    ) {
        const ip = req.ip || req.headers['x-forwarded-for'];
        console.warn(`[🛑 ARMADILHA] Bot capturado! IP: ${ip} tentou acessar: ${req.path}`);

        const html = `<!DOCTYPE html>
<html lang="pt-br">
<head><meta charset="UTF-8"><title>418 I'm a teapot</title></head>
<body style="background:#111827;color:#f3f4f6;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;overflow:hidden;font-family:sans-serif;text-align:center;">
    <img src="https://http.cat/418" alt="418 I'm a teapot" style="max-width:100%;max-height:70vh;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
</body></html>`;
        return res.status(418).send(html);
    }

    next();
};

// ─── Middleware: Request Logger ─────────────────────────────────────────────────
const requestLogger = (METRICS) => (req, res, next) => {
    METRICS.requestCount++;
    const start = Date.now();
    res.on('finish', () => {
        if (res.statusCode >= 500) METRICS.errorsCount++;
        const duration = Date.now() - start;
        METRICS.totalRequestDurationMs += duration;
        METRICS.lastRequestAt = Date.now();
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    });
    next();
};

module.exports = {
    verifyAdmin,
    verifyOptionalAdmin,
    verifyAdminPageSession,
    createRateLimiter,
    parseCookies,
    isUserAdmin,
    tarpit,
    requestLogger
};
