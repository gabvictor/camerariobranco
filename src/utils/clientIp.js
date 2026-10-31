const net = require('net');

/**
 * IP real do visitante.
 *
 * O site roda atrás de um Cloudflare Tunnel: a conexão TCP chega do próprio servidor/Docker
 * (ex.: 172.19.0.1), então `req.ip` é igual para todo mundo. O Cloudflare informa o IP verdadeiro
 * em `CF-Connecting-IP` (e substitui qualquer valor enviado pelo cliente).
 *
 * Regra: só confiamos nesse cabeçalho quando a conexão TCP vem de um endereço privado/local
 * (o túnel). Se alguém falar direto com o servidor pela internet, o cabeçalho é ignorado, para
 * ninguém escapar dos limites de tentativas inventando um IP.
 */

const stripMapped = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '');

const isPrivateIp = (value) => {
    const ip = stripMapped(value);
    const version = net.isIP(ip);
    if (version === 4) {
        const [a, b] = ip.split('.').map(Number);
        return a === 0 || a === 10 || a === 127
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 100 && b >= 64 && b <= 127); // CGNAT / Tailscale
    }
    if (version === 6) {
        const lower = ip.toLowerCase();
        return lower === '::1' || lower === '::' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
    }
    return false;
};

/**
 * @param {import('http').IncomingMessage & { ip?: string }} req
 * @returns {string}
 */
function getClientIp(req) {
    const peer = stripMapped(req?.socket?.remoteAddress || req?.ip || '') || '127.0.0.1';

    if (isPrivateIp(peer)) {
        const raw = req?.headers?.['cf-connecting-ip'];
        const cf = stripMapped(Array.isArray(raw) ? raw[0] : raw);
        if (cf && net.isIP(cf)) return cf;
    }
    return peer;
}

module.exports = { getClientIp, isPrivateIp };
