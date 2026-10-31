const test = require('node:test');
const assert = require('node:assert/strict');

const RioAlertService = require('../src/application/services/RioAlertService');
const { AlertError } = RioAlertService;

// ─── Dublês ─────────────────────────────────────────────────────────────────
function makeRepo() {
    const subs = new Map();
    let state = null;
    return {
        subs,
        get state() { return state; },
        async getSubscriber(id) { return subs.has(id) ? { id, ...subs.get(id) } : null; },
        async saveSubscriber({ id, ...data }) { subs.set(id, data); },
        async countByStatus() { const c = { ativos: 0, pendentes: 0, cancelados: 0 }; for (const v of subs.values()) { if (v.status === 'active') c.ativos++; else if (v.status === 'pending') c.pendentes++; else if (v.status === 'unsubscribed') c.cancelados++; } return c; },
        async listPendingSubscribers() { return [...subs].filter(([, v]) => v.status === 'pending').map(([id, v]) => ({ id, ...v })); },
        async deleteSubscriber(id) { subs.delete(id); },
        async listActiveSubscribers() { return [...subs].filter(([, v]) => v.status === 'active').map(([id, v]) => ({ id, ...v })); },
        async markNotified(id, eventId) { subs.get(id).lastEventId = eventId; },
        async getState() { return state ? JSON.parse(JSON.stringify(state)) : null; },
        async saveState(s) { state = JSON.parse(JSON.stringify(s)); }
    };
}

function makeMail({ configured = true, failFor = [] } = {}) {
    return {
        sent: [],
        isConfigured: () => configured,
        async sendMessage(to, message) {
            if (failFor.includes(to)) throw new Error('boom');
            this.sent.push({ to, ...message });
        }
    };
}

function makeRio(initial = 10) {
    const rio = {
        cotaAtencao: 12.5, cotaAlerta: 13.5, cotaTransbordamento: 14.0,
        metros: initial, desatualizado: false, confiavel: true,
        async getNivelRioAcre() {
            return {
                nivel: { metros: rio.metros, dataLeitura: '30/10/2026, 19:45', qualidade: { confiavel: rio.confiavel } },
                fonte: 'HidroWebService (ANA)',
                frescor: { desatualizado: rio.desatualizado, fusoSuspeito: false }
            };
        }
    };
    return rio;
}

function setup({ rioStart = 10, mailOpts, options } = {}) {
    const repo = makeRepo();
    const mail = makeMail(mailOpts);
    const rio = makeRio(rioStart);
    const service = new RioAlertService({
        repo, mailService: mail, rioService: rio,
        tokenSecret: 'segredo-de-teste', baseUrl: 'https://exemplo.test',
        sleep: async () => {}, options
    });
    return { repo, mail, rio, service };
}

const tokenFromLink = (text, param) => new URL(text.match(/https?:\/\/\S+/g).find((u) => u.includes(param))).searchParams;

async function subscribeAndConfirm(ctx, email, niveis) {
    await ctx.service.subscribe({ email, niveis, consent: true });
    const msg = ctx.mail.sent.at(-1);
    const q = tokenFromLink(msg.text, '/api/alertas/confirmar');
    assert.equal(await ctx.service.confirm(q.get('id'), q.get('t')), true);
    return q.get('id');
}

// ─── Inscrição ──────────────────────────────────────────────────────────────
test('subscribe: exige consentimento explícito e e-mail válido', async () => {
    const { service, mail } = setup();
    await assert.rejects(service.subscribe({ email: 'a@b.com', consent: false }), (e) => e.code === 'CONSENT_REQUIRED');
    await assert.rejects(service.subscribe({ email: 'a@b.com' }), (e) => e.code === 'CONSENT_REQUIRED');
    await assert.rejects(service.subscribe({ email: 'nao-e-email', consent: true }), (e) => e.code === 'INVALID_EMAIL');
    assert.equal(mail.sent.length, 0);
});

test('subscribe: fica PENDENTE e não recebe alerta antes de confirmar', async () => {
    const ctx = setup({ rioStart: 13 });
    await ctx.service.subscribe({ email: 'Ana@Exemplo.com', niveis: ['alerta'], consent: true });
    const [sub] = [...ctx.repo.subs.values()];
    assert.equal(sub.status, 'pending');
    assert.equal(sub.email, 'ana@exemplo.com');
    assert.equal(sub.consentVersion, RioAlertService.CONSENT_VERSION);
    assert.equal(ctx.mail.sent.length, 1);
    assert.match(ctx.mail.sent[0].subject, /Confirme/);

    await ctx.service.evaluate(); // inicializa
    ctx.rio.metros = 13.6;
    await ctx.service.evaluate();
    await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 1, 'só o e-mail de confirmação foi enviado');
});

test('subscribe: níveis inválidos são descartados; vazio usa o padrão (alerta + transbordamento)', async () => {
    const ctx = setup();
    await ctx.service.subscribe({ email: 'a@b.com', niveis: ['xpto'], consent: true });
    assert.deepEqual([...ctx.repo.subs.values()][0].niveis, ['alerta', 'transbordamento']);
});

test('subscribe: sem provedor de e-mail devolve 503 e não grava nada', async () => {
    const ctx = setup({ mailOpts: { configured: false } });
    await assert.rejects(ctx.service.subscribe({ email: 'a@b.com', consent: true }), (e) => e instanceof AlertError && e.status === 503);
    assert.equal(ctx.repo.subs.size, 0);
});

test('subscribe: quem já está ativo não é alterado nem recebe novo e-mail (resposta igual)', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'a@b.com', ['atencao']);
    ctx.mail.sent.length = 0;
    const res = await ctx.service.subscribe({ email: 'a@b.com', niveis: ['transbordamento'], consent: true });
    assert.deepEqual(res, { ok: true });
    assert.equal(ctx.mail.sent.length, 0);
    assert.deepEqual([...ctx.repo.subs.values()][0].niveis, ['atencao']);
});

test('subscribe: reenvio dentro do intervalo mínimo é ignorado (anti-spam)', async () => {
    const ctx = setup();
    await ctx.service.subscribe({ email: 'a@b.com', consent: true });
    await ctx.service.subscribe({ email: 'a@b.com', consent: true });
    assert.equal(ctx.mail.sent.length, 1);
});

// ─── Confirmar / cancelar ───────────────────────────────────────────────────
test('confirm: token adulterado ou de outro inscrito é recusado', async () => {
    const ctx = setup();
    await ctx.service.subscribe({ email: 'a@b.com', consent: true });
    const q = tokenFromLink(ctx.mail.sent[0].text, '/api/alertas/confirmar');
    assert.equal(await ctx.service.confirm(q.get('id'), 'x'.repeat(40)), false);
    assert.equal(await ctx.service.confirm('0'.repeat(32), q.get('t')), false);
    assert.equal([...ctx.repo.subs.values()][0].status, 'pending');
});

test('unsubscribe: cancela, é idempotente e o link antigo de confirmação não reativa', async () => {
    const ctx = setup();
    const id = await subscribeAndConfirm(ctx, 'a@b.com');
    const confirmQ = tokenFromLink(ctx.mail.sent[0].text, '/api/alertas/confirmar');
    const unsubToken = ctx.service.unsubscribePostUrl(id).match(/t=([a-f0-9]+)/)[1];

    assert.equal(await ctx.service.unsubscribe(id, 'x'.repeat(40)), false);
    assert.equal(await ctx.service.unsubscribe(id, unsubToken), true);
    assert.equal(await ctx.service.unsubscribe(id, unsubToken), true);
    assert.equal(ctx.repo.subs.get(id).status, 'unsubscribed');
    assert.equal(await ctx.service.confirm(confirmQ.get('id'), confirmQ.get('t')), false);
    assert.equal(ctx.repo.subs.get(id).status, 'unsubscribed');
});

// ─── Disparo ────────────────────────────────────────────────────────────────
test('evaluate: primeira execução só registra o nível, sem enviar (mesmo com rio já alto)', async () => {
    const ctx = setup({ rioStart: 14.2 });
    await subscribeAndConfirm(ctx, 'a@b.com');
    ctx.mail.sent.length = 0;
    const r = await ctx.service.evaluate();
    assert.equal(r.initialized, 'transbordamento');
    assert.equal(ctx.mail.sent.length, 0);
});

test('evaluate: alerta só após 2 leituras seguidas acima da cota, uma única vez', async () => {
    const ctx = setup({ rioStart: 10 });
    await subscribeAndConfirm(ctx, 'a@b.com', ['alerta']);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate(); // inicializa

    ctx.rio.metros = 13.6;
    await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 0, 'uma leitura isolada (pico) não alerta');
    await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 1);
    assert.match(ctx.mail.sent[0].subject, /alerta/i);

    await ctx.service.evaluate();
    await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 1, 'não repete enquanto o rio fica acima da cota');
});

test('evaluate: pico de uma leitura que volta ao normal não alerta', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'a@b.com', ['alerta']);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate();
    ctx.rio.metros = 13.7; await ctx.service.evaluate();
    ctx.rio.metros = 10; await ctx.service.evaluate();
    ctx.rio.metros = 13.7; await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 0);
});

test('evaluate: respeita o nível escolhido por cada inscrito', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'so-transbordo@b.com', ['transbordamento']);
    await subscribeAndConfirm(ctx, 'alerta@b.com', ['alerta']);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate();
    ctx.rio.metros = 13.6;
    await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.deepEqual(ctx.mail.sent.map((m) => m.to), ['alerta@b.com']);

    ctx.rio.metros = 14.1;
    await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.filter((m) => m.to === 'alerta@b.com').length, 1, 'quem só quer alerta não recebe o de transbordamento');
    assert.ok(ctx.mail.sent.some((m) => m.to === 'so-transbordo@b.com' && /transbordamento/i.test(m.subject)));
});

test('evaluate: histerese — oscilar perto da cota não repete; só rearma depois de cair 15 cm', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'a@b.com', ['alerta']);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate();
    ctx.rio.metros = 13.6; await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 1);

    ctx.rio.metros = 13.45; await ctx.service.evaluate(); // abaixo da cota, mas dentro da histerese
    ctx.rio.metros = 13.6; await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 1, 'oscilação não gera novo e-mail');

    ctx.rio.metros = 13.0; await ctx.service.evaluate(); // caiu bem abaixo: rearma
    ctx.rio.metros = 13.6; await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 2, 'nova subida depois de rearmar alerta de novo');
});

test('evaluate: leitura velha, não confiável ou sem dado não dispara', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'a@b.com', ['alerta']);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate();
    ctx.rio.metros = 14.5;

    ctx.rio.desatualizado = true;
    assert.equal((await ctx.service.evaluate()).skipped, 'leitura-desatualizada');
    ctx.rio.desatualizado = false; ctx.rio.confiavel = false;
    assert.equal((await ctx.service.evaluate()).skipped, 'leitura-nao-confiavel');
    ctx.rio.getNivelRioAcre = async () => { throw new Error('sem fonte'); };
    assert.equal((await ctx.service.evaluate()).skipped, 'sem-leitura');
    assert.equal(ctx.mail.sent.length, 0);
});

test('evaluate: inscrito pendente ou cancelado nunca recebe', async () => {
    const ctx = setup();
    const id = await subscribeAndConfirm(ctx, 'sai@b.com', ['alerta']);
    await ctx.service.subscribe({ email: 'pendente@b.com', niveis: ['alerta'], consent: true });
    const t = ctx.service.unsubscribePostUrl(id).match(/t=([a-f0-9]+)/)[1];
    await ctx.service.unsubscribe(id, t);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate();
    ctx.rio.metros = 13.8; await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 0);
});

test('evaluate: e-mail de alerta traz link de cancelar e cabeçalhos List-Unsubscribe de um clique', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'a@b.com', ['alerta']);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate();
    ctx.rio.metros = 13.8; await ctx.service.evaluate(); await ctx.service.evaluate();
    const m = ctx.mail.sent[0];
    assert.match(m.text, /\/alertas\/cancelar\?id=[a-f0-9]{32}&t=[a-f0-9]{40}/);
    assert.match(m.html, /Deixar de receber/);
    assert.match(m.headers['List-Unsubscribe'], /^<https:\/\/exemplo\.test\/api\/alertas\/cancelar\?id=/);
    assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.match(m.text, /13,80 m/);
});

test('evaluate: limite diário corta o envio e o restante sai no ciclo seguinte (sem duplicar)', async () => {
    const ctx = setup({ options: { maxEmailsPerDay: 2 } });
    for (const e of ['a@b.com', 'b@b.com', 'c@b.com']) await subscribeAndConfirm(ctx, e, ['alerta']);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate();
    ctx.rio.metros = 13.8;
    await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 2, 'parou no limite');
    await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 2, 'mesmo dia: continua no limite');

    // novo dia: o evento pendente continua e entrega só ao que faltava
    const realNow = Date.now;
    Date.now = () => realNow() + 24 * 3600 * 1000;
    try {
        const svc = new RioAlertService({
            repo: ctx.repo, mailService: ctx.mail, rioService: ctx.rio, tokenSecret: 'segredo-de-teste',
            baseUrl: 'https://exemplo.test', sleep: async () => {}, options: { maxEmailsPerDay: 2 }
        });
        await svc.evaluate();
    } finally { Date.now = realNow; }
    assert.equal(ctx.mail.sent.length, 3);
    assert.equal(new Set(ctx.mail.sent.map((m) => m.to)).size, 3, 'ninguém recebeu duas vezes');
});

test('evaluate: falha de envio para um inscrito não impede os demais e é tentada de novo', async () => {
    const ctx = setup({ mailOpts: { failFor: [] } });
    await subscribeAndConfirm(ctx, 'ruim@b.com', ['alerta']);
    await subscribeAndConfirm(ctx, 'bom@b.com', ['alerta']);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate();
    ctx.mail.failFor = ['ruim@b.com'];
    const orig = ctx.mail.sendMessage.bind(ctx.mail);
    ctx.mail.sendMessage = async (to, m) => { if (to === 'ruim@b.com') throw new Error('boom'); return orig(to, m); };
    ctx.rio.metros = 13.8;
    await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.deepEqual(ctx.mail.sent.map((m) => m.to), ['bom@b.com']);
    ctx.mail.sendMessage = orig;
    await ctx.service.evaluate();
    assert.deepEqual(ctx.mail.sent.map((m) => m.to).sort(), ['bom@b.com', 'ruim@b.com']);
});

// ─── Remetentes separados (conta x alertas) ─────────────────────────────────
const MailService = require('../src/infrastructure/services/MailService');

function resendWith(keyFileConfig, env = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };
    return { calls, mail: new MailService({ SITE_BASE_URL: 'https://x.test', ...env }, { fetchImpl, keyFileConfig }) };
}
const msg = { subject: 's', text: 't', html: '<p>t</p>' };

test('MailService: código de login sai pelo remetente de conta; alertas pelo remetente de alertas', async () => {
    const { mail, calls } = resendWith({
        apiKey: 're_x', from: 'CamRB Conta <no-reply@d.test>', fromAlertas: 'CamRB Alertas <alertas@d.test>'
    });
    await mail.sendVerificationCode('a@b.com', '123456');
    await mail.sendMessage('a@b.com', msg, { channel: 'alertas' });
    await mail.sendMessage('a@b.com', msg);
    assert.equal(calls[0].from, 'CamRB Conta <no-reply@d.test>');
    assert.equal(calls[1].from, 'CamRB Alertas <alertas@d.test>');
    assert.equal(calls[2].from, 'CamRB Conta <no-reply@d.test>', 'sem canal usa o remetente de conta');
});

test('MailService: sem remetente de alertas, os alertas usam o mesmo remetente da conta', async () => {
    const { mail, calls } = resendWith({ apiKey: 're_x', from: 'CamRB <no-reply@d.test>' });
    await mail.sendMessage('a@b.com', msg, { channel: 'alertas' });
    assert.equal(calls[0].from, 'CamRB <no-reply@d.test>');
});

test('MailService: o serviceAccountKey.json tem prioridade sobre o .env (chave e remetentes)', async () => {
    const { mail, calls } = resendWith(
        { apiKey: 're_arquivo', from: 'A <a@d.test>', fromAlertas: 'B <b@d.test>' },
        { RESEND_API_KEY: 're_env', MAIL_FROM: 'X <x@d.test>', MAIL_FROM_ALERTAS: 'Y <y@d.test>' }
    );
    await mail.sendMessage('a@b.com', msg, { channel: 'alertas' });
    assert.equal(calls[0].from, 'B <b@d.test>');
    assert.equal(mail._resendKey, 're_arquivo');
});

test('MailService: .env só preenche o que o arquivo não tiver', async () => {
    const { mail, calls } = resendWith({ apiKey: '', from: '' }, { RESEND_API_KEY: 're_env', MAIL_FROM: 'X <x@d.test>', MAIL_FROM_ALERTAS: 'Y <y@d.test>' });
    await mail.sendMessage('a@b.com', msg, { channel: 'alertas' });
    assert.equal(calls[0].from, 'Y <y@d.test>');
});

test('RioAlertService: confirmação da inscrição e alertas pedem o canal "alertas"', async () => {
    const ctx = setup();
    const channels = [];
    ctx.mail.sendMessage = async (to, m, opts = {}) => { channels.push(opts.channel); ctx.mail.sent.push({ to, ...m }); };
    await subscribeAndConfirm(ctx, 'a@b.com', ['alerta']);
    await ctx.service.evaluate();
    ctx.rio.metros = 13.8; await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(channels.length, 2);
    assert.deepEqual([...new Set(channels)], ['alertas']);
});

// ─── Limpeza de inscrições pendentes ────────────────────────────────────────
test('purgeStalePending: apaga só pendentes antigas; mantém recentes, ativas e canceladas', async () => {
    const DAY = 24 * 3600 * 1000;
    let clock = Date.now();
    const repo = makeRepo();
    const service = new RioAlertService({
        repo, mailService: makeMail(), rioService: makeRio(), tokenSecret: 's', sleep: async () => {}, now: () => clock
    });
    const put = (id, status, ageDays) => repo.subs.set(id, { email: `${id}@x.com`, status, confirmSentAt: clock - ageDays * DAY, createdAt: clock - ageDays * DAY });
    put('pendente-velha', 'pending', 8);
    put('pendente-recente', 'pending', 2);
    put('ativa-velha', 'active', 60);
    put('cancelada-velha', 'unsubscribed', 60);

    const res = await service.purgeStalePending();
    assert.equal(res.removed, 1);
    assert.deepEqual([...repo.subs.keys()].sort(), ['ativa-velha', 'cancelada-velha', 'pendente-recente']);

    clock += 6 * DAY; // a "recente" agora passa de 7 dias
    assert.equal((await service.purgeStalePending()).removed, 1);
    assert.deepEqual([...repo.subs.keys()].sort(), ['ativa-velha', 'cancelada-velha']);
});

test('purgeStalePending: nova tentativa de inscrição renova o prazo da pendente', async () => {
    const DAY = 24 * 3600 * 1000;
    let clock = 1_700_000_000_000;
    const repo = makeRepo();
    const service = new RioAlertService({
        repo, mailService: makeMail(), rioService: makeRio(), tokenSecret: 's', sleep: async () => {}, now: () => clock
    });
    await service.subscribe({ email: 'a@b.com', consent: true });
    clock += 6 * DAY;
    await service.subscribe({ email: 'a@b.com', consent: true }); // reenvio (fora do cooldown) renova
    clock += 3 * DAY; // 9 dias desde a 1ª, 3 desde a renovação
    assert.equal((await service.purgeStalePending()).removed, 0);
    clock += 5 * DAY;
    assert.equal((await service.purgeStalePending()).removed, 1);
});

// ─── Painel admin: prévia, e-mail de teste, simulador e resumo ──────────────
test('previewAlert: gera o e-mail com a marca de TESTE e sem enviar nada', async () => {
    const ctx = setup();
    const p = await ctx.service.previewAlert({ level: 'transbordamento', metros: 14.35 });
    assert.match(p.assunto, /^\[TESTE\] /);
    assert.match(p.assunto, /transbordamento/i);
    assert.match(p.html, /E-mail de teste/);
    assert.match(p.texto, /^\[E-MAIL DE TESTE\]/);
    assert.match(p.texto, /14,35 m/);
    assert.equal(p.metros, 14.35);
    assert.equal(ctx.mail.sent.length, 0);
});

test('previewAlert: nível e metros têm padrão e validação', async () => {
    const ctx = setup();
    assert.equal((await ctx.service.previewAlert({})).nivel, 'alerta');
    assert.equal((await ctx.service.previewAlert({ level: 'atencao' })).metros, 12.6, 'padrão = cota + 10 cm');
    assert.equal((await ctx.service.previewAlert({ level: 'alerta', metros: '13,8' })).metros, 13.8, 'aceita vírgula');
    await assert.rejects(ctx.service.previewAlert({ level: 'xpto' }), (e) => e.code === 'INVALID_LEVEL');
    await assert.rejects(ctx.service.previewAlert({ metros: 99 }), (e) => e.code === 'INVALID_METERS');
    await assert.rejects(ctx.service.previewAlert({ metros: 'abc' }), (e) => e.code === 'INVALID_METERS');
});

test('alerta real NÃO leva a marca de teste', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'a@b.com', ['alerta']);
    ctx.mail.sent.length = 0;
    await ctx.service.evaluate();
    ctx.rio.metros = 13.8; await ctx.service.evaluate(); await ctx.service.evaluate();
    assert.equal(ctx.mail.sent.length, 1);
    assert.doesNotMatch(ctx.mail.sent[0].subject, /TESTE/);
    assert.doesNotMatch(ctx.mail.sent[0].html, /E-mail de teste/);
    assert.doesNotMatch(ctx.mail.sent[0].text, /E-MAIL DE TESTE/);
});

test('sendTestAlert: envia UM e-mail só para o destino, pelo remetente de alertas, sem tocar inscritos nem estado', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'inscrito@b.com', ['alerta']);
    ctx.mail.sent.length = 0;
    const channels = [];
    const orig = ctx.mail.sendMessage.bind(ctx.mail);
    ctx.mail.sendMessage = async (to, m, opts = {}) => { channels.push(opts.channel); return orig(to, m, opts); };
    const before = JSON.stringify([...ctx.repo.subs]);

    const r = await ctx.service.sendTestAlert({ to: ' Professor@Escola.com ', level: 'alerta', metros: 13.9 });

    assert.equal(r.ok, true);
    assert.equal(ctx.mail.sent.length, 1);
    assert.equal(ctx.mail.sent[0].to, 'professor@escola.com');
    assert.match(ctx.mail.sent[0].subject, /^\[TESTE\] /);
    assert.deepEqual(channels, ['alertas']);
    assert.equal(JSON.stringify([...ctx.repo.subs]), before, 'inscritos intactos');
    assert.equal(ctx.repo.state, null, 'estado do disparador intacto');
    assert.equal(r.restantesHoje, 19);
});

test('sendTestAlert: valida e-mail, e-mail não configurado, falha do provedor e limite diário', async () => {
    const ctx = setup();
    await assert.rejects(ctx.service.sendTestAlert({ to: 'nao-e-email' }), (e) => e.code === 'INVALID_EMAIL');
    await assert.rejects(ctx.service.sendTestAlert({ to: 'a@b.com', level: 'xpto' }), (e) => e.code === 'INVALID_LEVEL');

    const semMail = setup({ mailOpts: { configured: false } });
    await assert.rejects(semMail.service.sendTestAlert({ to: 'a@b.com' }), (e) => e.status === 503);

    const falha = setup({ mailOpts: { failFor: ['ruim@b.com'] } });
    await assert.rejects(falha.service.sendTestAlert({ to: 'ruim@b.com' }), (e) => e.status === 502);
    assert.equal(falha.service._tests?.count ?? 0, 0, 'falha não conta no limite');

    const limite = setup({ options: { maxTestsPerDay: 2 } });
    await limite.service.sendTestAlert({ to: 'a@b.com' });
    await limite.service.sendTestAlert({ to: 'a@b.com' });
    await assert.rejects(limite.service.sendTestAlert({ to: 'a@b.com' }), (e) => e.status === 429 && e.code === 'TEST_LIMIT');
    assert.equal(limite.mail.sent.length, 2);
});

test('simulate: decide a seco, sem enviar e sem alterar o estado', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'so-alerta@b.com', ['alerta']);
    await subscribeAndConfirm(ctx, 'so-transb@b.com', ['transbordamento']);
    await subscribeAndConfirm(ctx, 'ambos@b.com', ['alerta', 'transbordamento']);
    await ctx.service.subscribe({ email: 'pendente@b.com', niveis: ['alerta'], consent: true }); // não conta
    ctx.mail.sent.length = 0;
    const subsBefore = JSON.stringify([...ctx.repo.subs]);

    const alto = await ctx.service.simulate({ metros: 14.2 });
    assert.equal(alto.faixaSimulada, 'transbordamento');
    assert.equal(alto.dispararia, true, 'sem estado prévio, sobe de "normal"');
    assert.equal(alto.destinatarios, 2, 'só quem escolheu transbordamento');
    assert.equal(alto.inscritosAtivos, 3);

    const medio = await ctx.service.simulate({ metros: 13.6 });
    assert.equal(medio.faixaSimulada, 'alerta');
    assert.equal(medio.destinatarios, 2);

    const baixo = await ctx.service.simulate({ metros: 11 });
    assert.equal(baixo.faixaSimulada, 'normal');
    assert.equal(baixo.dispararia, false);
    assert.equal(baixo.destinatarios, 0);
    assert.ok(baixo.passos.length >= 3);

    assert.equal(ctx.mail.sent.length, 0, 'nada enviado');
    assert.equal(ctx.repo.state, null, 'estado intacto');
    assert.equal(JSON.stringify([...ctx.repo.subs]), subsBefore, 'inscritos intactos');
});

test('simulate: respeita a faixa já registrada e valida o nível', async () => {
    const ctx = setup();
    await ctx.repo.saveState({ level: 'alerta', candidate: null, event: null, sent: { date: '', count: 0 } });
    const mesma = await ctx.service.simulate({ metros: 13.7 });
    assert.equal(mesma.faixaRegistrada, 'alerta');
    assert.equal(mesma.dispararia, false, 'já está nessa faixa');
    const sobe = await ctx.service.simulate({ metros: 14.1 });
    assert.equal(sobe.dispararia, true);
    await assert.rejects(ctx.service.simulate({ metros: -3 }), (e) => e.code === 'INVALID_METERS');
    await assert.rejects(ctx.service.simulate({ metros: 'x' }), (e) => e.code === 'INVALID_METERS');
});

test('adminSummary: junta inscritos, estado, nível real e configuração', async () => {
    const ctx = setup();
    await subscribeAndConfirm(ctx, 'a@b.com', ['alerta']);
    await ctx.service.subscribe({ email: 'p@b.com', consent: true });
    const s = await ctx.service.adminSummary();
    assert.deepEqual(s.inscritos, { ativos: 1, pendentes: 1, cancelados: 0 });
    assert.equal(s.cotas.length, 3);
    assert.equal(s.nivelReal.metros, 10);
    assert.equal(s.config.emailConfigurado, true);
    assert.equal(s.config.maxEmailsPorDia, 80);
    assert.equal(s.estado, null);
    assert.equal(JSON.stringify(s).includes('re_'), false, 'sem chaves no resumo');
});
