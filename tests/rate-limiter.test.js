const test = require('node:test');
const assert = require('node:assert/strict');

// security.js carrega o Firebase Admin; aqui ele é substituído por um dublê (sem credenciais).
const firebasePath = require.resolve('../src/config/firebaseAdmin');
require.cache[firebasePath] = {
    id: firebasePath, filename: firebasePath, loaded: true,
    exports: { admin: { auth: () => ({}) }, ADMIN_EMAIL: 'admin@exemplo.com' }
};

const { createRateLimiter } = require('../src/middlewares/security');

// Simula uma requisição que chega pelo túnel: a conexão vem do gateway do Docker.
const viaTunnel = (visitor) => ({
    socket: { remoteAddress: '172.19.0.1' },
    headers: visitor ? { 'cf-connecting-ip': visitor } : {}
});

function hit(limiter, req) {
    let status = 200;
    const res = { setHeader() {}, status(code) { status = code; return this; }, json() { return this; } };
    let passed = false;
    limiter(req, res, () => { passed = true; });
    return passed ? 200 : status;
}

test('limitador: visitantes diferentes atrás do túnel têm contagens separadas', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 3 });
    for (let i = 0; i < 3; i++) assert.equal(hit(limiter, viaTunnel('200.1.1.1')), 200);
    assert.equal(hit(limiter, viaTunnel('200.1.1.1')), 429, 'o 4º do mesmo visitante é bloqueado');
    assert.equal(hit(limiter, viaTunnel('200.2.2.2')), 200, 'outro visitante não é afetado');
    assert.equal(hit(limiter, viaTunnel('200.3.3.3')), 200);
});

test('limitador: forjar X-Forwarded-For não dá fôlego extra', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
    const forged = (xff) => ({ socket: { remoteAddress: '172.19.0.1' }, headers: { 'cf-connecting-ip': '200.9.9.9', 'x-forwarded-for': xff } });
    assert.equal(hit(limiter, forged('1.1.1.1')), 200);
    assert.equal(hit(limiter, forged('2.2.2.2')), 200);
    assert.equal(hit(limiter, forged('3.3.3.3')), 429);
});

test('limitador: conexão direta da internet não escapa forjando o cabeçalho do Cloudflare', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
    const direct = (fake) => ({ socket: { remoteAddress: '201.55.66.77' }, headers: { 'cf-connecting-ip': fake } });
    assert.equal(hit(limiter, direct('1.1.1.1')), 200);
    assert.equal(hit(limiter, direct('2.2.2.2')), 200);
    assert.equal(hit(limiter, direct('3.3.3.3')), 429);
});

test('limitador: sem cabeçalho (rede local) continua funcionando', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
    assert.equal(hit(limiter, viaTunnel(null)), 200);
    assert.equal(hit(limiter, viaTunnel(null)), 429);
});

test.after(() => { delete require.cache[firebasePath]; });
