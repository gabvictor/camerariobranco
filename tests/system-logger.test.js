const test = require('node:test');
const assert = require('node:assert/strict');

const defaultLogger = require('../src/infrastructure/logging/SystemLogger');
const { SystemLogger } = defaultLogger;

const make = (max = 1000) => new SystemLogger(max, { hookConsole: false });
const req = (logger, line) => logger._captureFromConsole('INFO', [line]);
const iso = '2026-10-31T10:00:00.000Z';

test('limite padrão do histórico é 1000 entradas', () => {
    assert.equal(defaultLogger.maxEntries, 1000);
    assert.equal(new SystemLogger(undefined, { hookConsole: false }).maxEntries, 1000);
});

test('histórico respeita o limite e os contadores acompanham o que foi descartado', () => {
    const logger = make(5);
    for (let i = 0; i < 4; i++) logger._add('INFO', 'SISTEMA', `info ${i}`, null, false);
    for (let i = 0; i < 4; i++) logger._add('ERROR', 'SISTEMA', `erro ${i}`, null, false);
    const stats = logger.getStats();
    assert.equal(stats.total, 5);
    assert.equal(stats.info + stats.warn + stats.error + stats.stream, 5, 'contadores somam o total retido');
    const recount = { info: 0, error: 0 };
    logger.logs.forEach((l) => { recount[l.level.toLowerCase()]++; });
    assert.equal(stats.info, recount.info);
    assert.equal(stats.error, recount.error);
    assert.equal(logger.logs[0].message, 'erro 3', 'mais recente primeiro');
});

test('com 1000 entradas, todas voltam no getLogs padrão (antes o padrão cortava em 250)', () => {
    const logger = make(1000);
    for (let i = 0; i < 1200; i++) logger._add('INFO', 'SISTEMA', `m ${i}`, null, false);
    assert.equal(logger.getLogs().length, 1000);
    assert.equal(logger.getLogs({ limit: 50 }).length, 50);
    assert.equal(logger.getLogs({ limit: 99999 }).length, 1000, 'teto = tamanho do histórico');
    assert.equal(logger.getStats().total, 1000);
});

test('requisição de leitura que deu certo é rotina e não entra no histórico', () => {
    const logger = make();
    req(logger, `[${iso}] GET /status-cameras → 304 (3ms)`);
    req(logger, `[${iso}] GET /rio → 200 (40ms)`);
    req(logger, `[${iso}] HEAD / → 200 (2ms)`);
    req(logger, `[${iso}] GET /manifest.json → 304 (1ms)`);
    req(logger, `[${iso}] GET /api/auth/me → 200 (8ms)`);
    assert.equal(logger.getStats().total, 0);
});

test('404 de leitura fora da API (robô procurando página) é ignorado, mas 404 da API fica', () => {
    const logger = make();
    req(logger, `[${iso}] GET /wp-admin/setup.php → 404 (1ms)`);
    assert.equal(logger.getStats().total, 0);
    req(logger, `[${iso}] GET /api/rota-que-nao-existe → 404 (1ms)`);
    assert.equal(logger.getStats().total, 1);
    assert.equal(logger.logs[0].level, 'WARN');
});

test('ações (POST/PUT/DELETE) entram, com categoria e dados estruturados', () => {
    const logger = make();
    req(logger, `[${iso}] POST /api/admin/alertas/teste → 200 (120ms)`);
    req(logger, `[${iso}] POST /api/alertas/inscrever → 200 (250ms)`);
    req(logger, `[${iso}] POST /api/auth/session-login → 200 (90ms)`);
    req(logger, `[${iso}] DELETE /api/comment/abc → 200 (30ms)`);
    const byPath = Object.fromEntries(logger.logs.map((l) => [l.meta.path, l]));
    assert.equal(byPath['/api/admin/alertas/teste'].category, 'ADMIN');
    assert.equal(byPath['/api/alertas/inscrever'].category, 'ALERTAS');
    assert.equal(byPath['/api/auth/session-login'].category, 'SEGURANÇA');
    assert.equal(byPath['/api/comment/abc'].category, 'REQUISIÇÃO');
    assert.deepEqual(byPath['/api/admin/alertas/teste'].meta, { method: 'POST', path: '/api/admin/alertas/teste', status: 200, ms: 120 });
    assert.equal(byPath['/api/admin/alertas/teste'].level, 'INFO');
});

test('o nível acompanha o status: 5xx erro, 4xx aviso, leitura lenta aviso', () => {
    const logger = make();
    req(logger, `[${iso}] GET /api/camera/1 → 500 (30ms)`);
    req(logger, `[${iso}] POST /api/admin/x → 403 (3ms)`);
    req(logger, `[${iso}] GET /rio → 200 (4500ms)`);
    const levels = Object.fromEntries(logger.logs.map((l) => [l.meta.path, l.level]));
    assert.equal(levels['/api/camera/1'], 'ERROR');
    assert.equal(levels['/api/admin/x'], 'WARN');
    assert.equal(levels['/rio'], 'WARN');
    assert.match(logger.logs.find((l) => l.meta.path === '/rio').message, /lenta/);
});

test('query string (pode ter dados pessoais ou token) não vai para o histórico', () => {
    const logger = make();
    req(logger, `[${iso}] POST /api/alertas/inscrever?email=maria@x.com&token=abc123 → 200 (10ms)`);
    const entry = logger.logs[0];
    assert.equal(entry.meta.path, '/api/alertas/inscrever');
    assert.doesNotMatch(JSON.stringify(entry), /maria@x\.com|abc123/);
});

test('novas categorias para alertas, e-mail, rio e armadilha de bots', () => {
    const logger = make();
    logger._captureFromConsole('INFO', ['[RIO_ALERT] Evento x: 3 enviado(s)']);
    logger._captureFromConsole('ERROR', ['[EMAIL_VERIFICATION] Falha ao enviar e-mail: x']);
    logger._captureFromConsole('WARN', ['[RioAcreService] Falha em HidroWebService: timeout']);
    logger._captureFromConsole('WARN', ['[🛑 ARMADILHA] Bot capturado! IP: 1.2.3.4 tentou acessar: /wp-login.php']);
    const cats = logger.logs.map((l) => l.category).reverse();
    assert.deepEqual(cats, ['ALERTAS', 'E-MAIL', 'RIO ACRE', 'SEGURANÇA']);
});

test('clear zera o histórico e as contagens', () => {
    const logger = make();
    for (let i = 0; i < 10; i++) logger._add('ERROR', 'SISTEMA', 'x', null, false);
    logger.clear();
    const stats = logger.getStats();
    assert.equal(stats.error, 0);
    assert.equal(stats.total, 1, 'só a linha informando que o histórico foi limpo');
});

test('filtros por nível, categoria e busca continuam funcionando', () => {
    const logger = make();
    logger._add('ERROR', 'ALERTAS', 'falha ao enviar', null, false);
    logger._add('INFO', 'ADMIN', 'login do admin', { x: 1 }, false);
    assert.equal(logger.getLogs({ level: 'ERROR' }).length, 1);
    assert.equal(logger.getLogs({ category: 'admin' }).length, 1);
    assert.equal(logger.getLogs({ search: 'FALHA' }).length, 1);
});

test('tokens continuam mascarados', () => {
    const logger = make();
    logger._add('INFO', 'SISTEMA', 'chamada com Bearer eyJabcdefghijklmnop.qrstuvwxyz123456.abc', null, false);
    assert.doesNotMatch(logger.logs[0].message, /qrstuvwxyz123456/);
});

test('etiqueta explícita manda mais que palavra solta (um [TIMELAPSE] que cita "câmeras" é TIMELAPSE)', () => {
    const logger = make();
    logger._captureFromConsole('INFO', ['[TIMELAPSE] Capturando frames de 38 câmeras online...']);
    logger._captureFromConsole('INFO', ['✔ Varredura concluída em 9.80s. 38 câmeras online de 701']);
    const cats = logger.logs.map((l) => l.category).reverse();
    assert.deepEqual(cats, ['TIMELAPSE', 'VARREDURA']);
});

test('timeout da ANA não é traduzido como "Prefeitura demorou"', () => {
    const logger = make();
    logger._captureFromConsole('WARN', ['[RioAcreService] Falha em HidroWebService: timeout of 20000ms exceeded']);
    logger._captureFromConsole('ERROR', ['[EMAIL_VERIFICATION] Falha ao enviar: ETIMEDOUT']);
    const [email, ana] = logger.logs;
    assert.equal(ana.category, 'RIO ACRE');
    assert.match(ana.message, /HidroWebService.*timeout of 20000ms/);
    assert.doesNotMatch(ana.message, /Prefeitura/);
    assert.equal(email.category, 'E-MAIL');
    assert.doesNotMatch(email.message, /Prefeitura/);
});

test('timeout vindo da Prefeitura continua com a mensagem amigável', () => {
    const logger = make();
    logger._captureFromConsole('ERROR', ['[PROXY] Erro ao buscar imagem: timeout of 6000ms exceeded']);
    assert.match(logger.logs[0].message, /Prefeitura demorou/);
});
