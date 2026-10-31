const test = require('node:test');
const assert = require('node:assert/strict');

const CameraSnapshotService = require('../src/infrastructure/services/CameraSnapshotService');
const RioAlertService = require('../src/application/services/RioAlertService');

// ─── Dublês ─────────────────────────────────────────────────────────────────
const jpeg = (kb) => Buffer.alloc(kb * 1024, 7);

function makeFs() {
    const files = new Map(); // nome -> { data, mtimeMs }
    return {
        files,
        async mkdir() {},
        async writeFile(full, data) { files.set(full.split(/[\\/]/).pop(), { data, mtimeMs: Date.now() }); },
        async readdir() { return [...files.keys()]; },
        async stat(full) { return files.get(full.split(/[\\/]/).pop()); },
        async unlink(full) { files.delete(full.split(/[\\/]/).pop()); }
    };
}

function makeHttp(responses) {
    const calls = [];
    return {
        calls,
        async get(url) {
            calls.push(url);
            const code = new URL(url).searchParams.get('code');
            const r = responses[code];
            if (r instanceof Error) throw r;
            if (!r) throw new Error('sem resposta');
            return { data: r.data, headers: { 'content-type': r.type || 'image/jpeg' } };
        }
    };
}

const repoWith = (list) => ({ getCached: () => list });
const BASE = 'https://exemplo.test';

function makeSvc({ cams, responses, codes = ['001334', '001426'], now = () => Date.UTC(2026, 9, 31, 15, 30) }) {
    const fsp = makeFs();
    const http = makeHttp(responses);
    const svc = new CameraSnapshotService({ http, cameraRepo: repoWith(cams), codes, baseUrl: BASE, dir: '/x/uploads/alertas', minKb: 25, now, fsp });
    return { svc, fsp, http };
}

const cam = (codigo, nome, status) => ({ codigo, nome, status });

// ─── Seleção das câmeras ────────────────────────────────────────────────────
test('as duas câmeras online: as duas entram, na ordem configurada', async () => {
    const { svc, fsp } = makeSvc({
        cams: [cam('001334', 'Passarela Joaquim Macedo', 'online'), cam('001426', 'Ponte Metálica', 'online')],
        responses: { '001334': { data: jpeg(80) }, '001426': { data: jpeg(90) } }
    });
    const r = await svc.capture('ev1');
    assert.deepEqual(r.images.map((i) => i.code), ['001334', '001426']);
    assert.deepEqual(r.images.map((i) => i.name), ['Passarela Joaquim Macedo', 'Ponte Metálica']);
    assert.equal(r.skipped.length, 0);
    assert.equal(fsp.files.size, 2);
    r.images.forEach((i) => assert.match(i.url, /^https:\/\/exemplo\.test\/uploads\/alertas\/rio-ev1-\d{6}-\d{12}-[a-f0-9]{8}\.jpg$/));
});

test('só uma online: entra só ela, e a offline nem é consultada', async () => {
    const { svc, http } = makeSvc({
        cams: [cam('001334', 'Passarela Joaquim Macedo', 'online'), cam('001426', 'Ponte Metálica', 'offline')],
        responses: { '001334': { data: jpeg(80) }, '001426': { data: jpeg(80) } }
    });
    const r = await svc.capture();
    assert.deepEqual(r.images.map((i) => i.code), ['001334']);
    assert.deepEqual(r.skipped, [{ code: '001426', name: 'Ponte Metálica', reason: 'offline' }]);
    assert.equal(http.calls.length, 1, 'não gasta requisição com câmera offline');
    assert.ok(http.calls[0].includes('code=001334'));
});

test('as duas offline: nenhuma imagem (o e-mail sai sem fotos)', async () => {
    const { svc, fsp } = makeSvc({
        cams: [cam('001334', 'A', 'offline'), cam('001426', 'B', 'offline')],
        responses: {}
    });
    const r = await svc.capture();
    assert.equal(r.images.length, 0);
    assert.equal(r.skipped.length, 2);
    assert.equal(fsp.files.size, 0);
});

test('"online" no cadastro mas a imagem veio vazia/errada: também fica de fora', async () => {
    const { svc } = makeSvc({
        cams: [cam('001334', 'A', 'online'), cam('001426', 'B', 'online')],
        responses: { '001334': { data: jpeg(3) }, '001426': { data: Buffer.alloc(20500, 1) } }
    });
    const r = await svc.capture();
    assert.equal(r.images.length, 0, 'muito pequena e a imagem padrão de "fora do ar" são descartadas');
    assert.deepEqual(r.skipped.map((s) => s.reason), ['sem imagem', 'sem imagem']);
});

test('erro de rede, tipo inesperado e imagem enorme não derrubam a captura', async () => {
    const { svc } = makeSvc({
        cams: [cam('001334', 'A', 'online'), cam('001426', 'B', 'online'), cam('009999', 'C', 'online')],
        codes: ['001334', '001426', '009999'],
        responses: { '001334': new Error('timeout'), '001426': { data: jpeg(80), type: 'text/html' }, '009999': { data: jpeg(2000) } }
    });
    const r = await svc.capture();
    assert.equal(r.images.length, 0);
    assert.deepEqual(r.skipped.map((s) => s.reason), ['falha ao obter', 'sem imagem', 'imagem grande demais']);
});

test('uma falha não impede a outra câmera', async () => {
    const { svc } = makeSvc({
        cams: [cam('001334', 'A', 'online'), cam('001426', 'B', 'online')],
        responses: { '001334': new Error('boom'), '001426': { data: jpeg(60) } }
    });
    const r = await svc.capture();
    assert.deepEqual(r.images.map((i) => i.code), ['001426']);
});

test('câmera fora do cadastro: tenta buscar mesmo assim e usa um nome genérico', async () => {
    const { svc } = makeSvc({ cams: [], responses: { '001334': { data: jpeg(60) } }, codes: ['001334'] });
    const r = await svc.capture();
    assert.equal(r.images[0].name, 'Câmera 001334');
});

// ─── Limpeza ────────────────────────────────────────────────────────────────
test('cleanup apaga só fotos antigas criadas por este serviço', async () => {
    const DAY = 24 * 3600 * 1000;
    const now = Date.now();
    const fsp = makeFs();
    fsp.files.set('rio-ev1-001334-202601011200-aaaaaaaa.jpg', { data: 1, mtimeMs: now - 40 * DAY });
    fsp.files.set('rio-ev2-001334-202610301200-bbbbbbbb.jpg', { data: 1, mtimeMs: now - 2 * DAY });
    fsp.files.set('logo-do-patrocinador.webp', { data: 1, mtimeMs: now - 400 * DAY }); // não é nosso
    const svc = new CameraSnapshotService({ http: makeHttp({}), cameraRepo: repoWith([]), codes: [], baseUrl: BASE, dir: '/x', now: () => now, fsp });
    assert.equal(await svc.cleanup(30), 1);
    assert.deepEqual([...fsp.files.keys()].sort(), ['logo-do-patrocinador.webp', 'rio-ev2-001334-202610301200-bbbbbbbb.jpg']);
});

test('cleanup com a pasta ainda inexistente não quebra', async () => {
    const svc = new CameraSnapshotService({ http: makeHttp({}), cameraRepo: repoWith([]), codes: [], baseUrl: BASE, dir: '/nada',
        fsp: { readdir: async () => { throw new Error('ENOENT'); } } });
    assert.equal(await svc.cleanup(), 0);
});

// ─── Integração com o e-mail de alerta ──────────────────────────────────────
function alertSetup({ cameras }) {
    const subs = new Map();
    let state = null;
    const repo = {
        async getSubscriber(id) { return subs.has(id) ? { id, ...subs.get(id) } : null; },
        async saveSubscriber({ id, ...d }) { subs.set(id, d); },
        async listActiveSubscribers() { return [...subs].filter(([, v]) => v.status === 'active').map(([id, v]) => ({ id, ...v })); },
        async listPendingSubscribers() { return []; },
        async deleteSubscriber() {},
        async countByStatus() { return { ativos: subs.size, pendentes: 0, cancelados: 0 }; },
        async markNotified(id, eventId) { subs.get(id).lastEventId = eventId; },
        async getState() { return state ? JSON.parse(JSON.stringify(state)) : null; },
        async saveState(s) { state = JSON.parse(JSON.stringify(s)); }
    };
    const sent = [];
    const mail = { isConfigured: () => true, async sendMessage(to, m) { sent.push({ to, ...m }); } };
    const rio = {
        cotaAtencao: 12.5, cotaAlerta: 13.5, cotaTransbordamento: 14,
        metros: 10,
        async getNivelRioAcre() { return { nivel: { metros: this.metros, dataLeitura: '31/10/2026, 10:15', qualidade: { confiavel: true } }, fonte: 'ANA', frescor: { desatualizado: false } }; }
    };
    const service = new RioAlertService({ repo, mailService: mail, rioService: rio, cameras, tokenSecret: 's', baseUrl: BASE, sleep: async () => {} });
    const addSub = (email) => subs.set(service._idFor(email), { email, status: 'active', niveis: ['alerta'], createdAt: Date.now() });
    return { service, rio, sent, addSub };
}

const fakeCameras = (images, skipped = []) => {
    const calls = [];
    return { calls, async capture(tag) { calls.push(tag); return { images, skipped }; }, async cleanup() { return 0; } };
};
const img = (code, name) => ({ code, name, url: `${BASE}/uploads/alertas/rio-${code}.jpg`, takenAt: Date.UTC(2026, 9, 31, 15, 30), file: `rio-${code}.jpg` });

test('alerta real leva as fotos das câmeras online, e a foto vai uma vez só para todos', async () => {
    const cameras = fakeCameras([img('001334', 'Passarela Joaquim Macedo'), img('001426', 'Ponte Metálica')]);
    const ctx = alertSetup({ cameras });
    ['a@x.com', 'b@x.com', 'c@x.com'].forEach(ctx.addSub);

    await ctx.service.evaluate();
    ctx.rio.metros = 13.8;
    await ctx.service.evaluate(); await ctx.service.evaluate();

    assert.equal(ctx.sent.length, 3);
    assert.equal(cameras.calls.length, 1, 'capturou uma única vez para o evento inteiro');
    for (const m of ctx.sent) {
        assert.match(m.html, /Como está o rio agora/);
        assert.match(m.html, /<img src="https:\/\/exemplo\.test\/uploads\/alertas\/rio-001334\.jpg"/);
        assert.match(m.html, /<img src="https:\/\/exemplo\.test\/uploads\/alertas\/rio-001426\.jpg"/);
        assert.match(m.html, /Passarela Joaquim Macedo/);
        assert.match(m.text, /Passarela Joaquim Macedo: https:\/\/exemplo\.test\/camera\/001334/);
        assert.doesNotMatch(m.subject, /TESTE/);
    }
});

test('só uma câmera online: o e-mail traz só ela', async () => {
    const ctx = alertSetup({ cameras: fakeCameras([img('001334', 'Passarela Joaquim Macedo')], [{ code: '001426', name: 'Ponte Metálica', reason: 'offline' }]) });
    ctx.addSub('a@x.com');
    await ctx.service.evaluate();
    ctx.rio.metros = 13.8;
    await ctx.service.evaluate(); await ctx.service.evaluate();
    const m = ctx.sent[0];
    assert.match(m.html, /rio-001334\.jpg/);
    assert.doesNotMatch(m.html, /001426/);
    assert.doesNotMatch(m.html, /Ponte Metálica/, 'câmera offline nunca aparece');
    assert.equal((m.html.match(/<img /g) || []).length, 1);
});

test('nenhuma câmera online: e-mail sai normal, sem bloco de fotos', async () => {
    const ctx = alertSetup({ cameras: fakeCameras([], [{ code: '001334', name: 'A', reason: 'offline' }, { code: '001426', name: 'B', reason: 'offline' }]) });
    ctx.addSub('a@x.com');
    await ctx.service.evaluate();
    ctx.rio.metros = 13.8;
    await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(ctx.sent.length, 1);
    assert.doesNotMatch(ctx.sent[0].html, /<img /);
    assert.doesNotMatch(ctx.sent[0].html, /Como está o rio agora/);
});

test('falha ao tirar as fotos não impede o alerta', async () => {
    const cameras = { async capture() { throw new Error('rede caiu'); } };
    const ctx = alertSetup({ cameras });
    ctx.addSub('a@x.com');
    await ctx.service.evaluate();
    ctx.rio.metros = 13.8;
    await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(ctx.sent.length, 1, 'o aviso de cheia sai mesmo sem foto');
    assert.doesNotMatch(ctx.sent[0].html, /<img /);
});

test('sem inscritos, nenhuma foto é tirada (não cria arquivo à toa)', async () => {
    const cameras = fakeCameras([img('001334', 'A')]);
    const ctx = alertSetup({ cameras });
    await ctx.service.evaluate();
    ctx.rio.metros = 13.8;
    await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(cameras.calls.length, 0);
});

test('prévia e e-mail de teste mostram as fotos e dizem quais câmeras entraram ou ficaram de fora', async () => {
    const cameras = fakeCameras([img('001334', 'Passarela Joaquim Macedo')], [{ code: '001426', name: 'Ponte Metálica', reason: 'offline' }]);
    const ctx = alertSetup({ cameras });

    const p = await ctx.service.previewAlert({ level: 'alerta', metros: 13.7 });
    assert.match(p.html, /rio-001334\.jpg/);
    assert.deepEqual(p.camerasIncluidas, [{ codigo: '001334', nome: 'Passarela Joaquim Macedo' }]);
    assert.deepEqual(p.camerasIgnoradas, [{ codigo: '001426', nome: 'Ponte Metálica', motivo: 'offline' }]);

    const t = await ctx.service.sendTestAlert({ to: 'prof@escola.com', level: 'alerta', metros: 13.7 });
    assert.equal(t.camerasIncluidas.length, 1);
    assert.match(ctx.sent[0].html, /rio-001334\.jpg/);
    assert.match(ctx.sent[0].subject, /^\[TESTE\]/);
    assert.equal(cameras.calls.length, 1, 'prévia + teste seguidos reaproveitam as mesmas fotos por 1 minuto');
});

// ─── Regressão: o status vem do CACHE DA VARREDURA, não do cadastro ─────────
// O cadastro do Firestore (cameraRepo.getCached) NÃO tem campo `status`. Uma versão anterior tratava "sem status"
// como offline e nunca colocava foto nenhuma no e-mail de alerta real.
const CameraCache = require('../src/application/services/CameraCache');

test('cadastro sem status (formato real do Firestore) não é tratado como offline', async () => {
    const { svc, http } = makeSvc({
        cams: [{ codigo: '001334', nome: 'De Olho no Rio' }, { codigo: '001426', nome: 'Régua' }], // sem `status`
        responses: { '001334': { data: jpeg(80) }, '001426': { data: jpeg(80) } }
    });
    const r = await svc.capture();
    assert.equal(r.images.length, 2, 'status desconhecido: tenta buscar a foto');
    assert.equal(http.calls.length, 2);
});

test('com o cache real da varredura: só a câmera online entra e a offline nem é consultada', async () => {
    const cache = new CameraCache();
    cache.update(
        [{ codigo: '001334', status: 'online' }, { codigo: '001426', status: 'offline' }],
        [{ codigo: '001334', nome: 'De Olho no Rio' }, { codigo: '001426', nome: 'Régua' }]
    );
    const fsp = makeFs();
    const http = makeHttp({ '001334': { data: jpeg(80) }, '001426': { data: jpeg(80) } });
    // o cadastro aqui não tem status, igual ao de verdade; quem manda é o cache
    const svc = new CameraSnapshotService({ http, cameraCache: cache, cameraRepo: repoWith([{ codigo: '001426', nome: 'Régua' }]),
        codes: ['001334', '001426'], baseUrl: BASE, dir: '/x', minKb: 25, fsp });
    const r = await svc.capture();
    assert.deepEqual(r.images.map((i) => [i.code, i.name]), [['001334', 'De Olho no Rio']]);
    assert.deepEqual(r.skipped, [{ code: '001426', name: 'Régua', reason: 'offline' }]);
    assert.equal(http.calls.length, 1);
});

test('o cache vale mais que o cadastro quando os dois conhecem a câmera', async () => {
    const cache = new CameraCache();
    cache.update([{ codigo: '001334', status: 'offline' }], [{ codigo: '001334', nome: 'De Olho no Rio' }]);
    const svc = new CameraSnapshotService({ http: makeHttp({ '001334': { data: jpeg(80) } }), cameraCache: cache,
        cameraRepo: repoWith([{ codigo: '001334', nome: 'Nome antigo', status: 'online' }]), codes: ['001334'], baseUrl: BASE, dir: '/x', fsp: makeFs() });
    const r = await svc.capture();
    assert.equal(r.images.length, 0);
    assert.equal(r.skipped[0].reason, 'offline');
});

test('o servidor entrega o cache da varredura ao serviço de fotos (guarda contra o erro de ligação)', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
    const block = src.slice(src.indexOf('new CameraSnapshotService({'), src.indexOf('new CameraSnapshotService({') + 400);
    assert.match(block, /\bcameraCache\b/, 'server.js precisa passar cameraCache para o CameraSnapshotService');
});
