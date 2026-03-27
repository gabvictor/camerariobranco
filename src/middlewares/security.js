const { admin, ADMIN_EMAIL } = require('../config/firebaseAdmin');

// ─── Middleware: Verify Admin Token ────────────────────────────────────────────
const verifyAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn(`[SECURITY] Acesso sem token: ${req.originalUrl} - IP: ${req.ip}`);
        return res.status(403).json({ message: 'Acesso negado: Token não fornecido.' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        if (decodedToken.email === ADMIN_EMAIL) {
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

// ─── Middleware: Verify Optional Admin (para rotas públicas com conteúdo extra para admins) ───
const verifyOptionalAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    req.userIsAdmin = false;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split('Bearer ')[1];
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            if (decodedToken.email === ADMIN_EMAIL) {
                req.userIsAdmin = true;
            }
        } catch (error) { /* Token inválido — ignora silenciosamente */ }
    }
    next();
};

// ─── Middleware: Anti-Bot Tarpit ───────────────────────────────────────────────
const rotasIsca = [
    '/.env', '/.git/config', '/phpmyadmin', '/backup.zip',
    '/config.bak', '/.well-known/security.txt', '/manager/html'
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

        setTimeout(() => {
            const html = `<!DOCTYPE html>
<html lang="pt-br">
<head><meta charset="UTF-8"><title>${req.path}</title></head>
<body style="background:#111827;color:#f3f4f6;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;overflow:hidden;font-family:sans-serif;text-align:center;">
    <img src="https://http.cat/418" alt="418 I'm a teapot" style="max-width:100%;max-height:70vh;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
</body></html>`;
            res.status(418).send(html);
        }, 180000); // 3 minutos de espera para o bot

        return;
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

module.exports = { verifyAdmin, verifyOptionalAdmin, tarpit, requestLogger };
