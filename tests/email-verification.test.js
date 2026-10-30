const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Dublês ─────────────────────────────────────────────────────────────────

class FakeRef {
    constructor(db, path) { this.db = db; this.path = path; }
    async update(data) {
        if (!this.db.docs.has(this.path)) throw new Error('NOT_FOUND');
        this.db.docs.set(this.path, { ...this.db.docs.get(this.path), ...data });
    }
}

class FakeDb {
    constructor() { this.docs = new Map(); }
    collection(name) { return { doc: (id) => new FakeRef(this, `${name}/${id}`) }; }
    async runTransaction(fn) {
        const writes = [];
        const t = {
            get: async (ref) => ({
                exists: this.docs.has(ref.path),
                data: () => structuredClone(this.docs.get(ref.path))
            }),
            set: (ref, data) => writes.push(() => this.docs.set(ref.path, structuredClone(data))),
            update: (ref, data) => writes.push(() => this.docs.set(ref.path, { ...this.docs.get(ref.path), ...data })),
            delete: (ref) => writes.push(() => this.docs.delete(ref.path))
        };
        await fn(t); // se lançar erro, nada é gravado (igual ao Firestore)
        writes.forEach(w => w());
    }
}

const makeAdmin = (users) => ({
    auth: () => ({
        getUser: async (uid) => users[uid],
        updateUser: async (uid, patch) => Object.assign(users[uid], patch)
    })
});

const makeMail = () => ({
    configured: true,
    fail: false,
    sent: [],
    isConfigured() { return this.configured; },
    async sendVerificationCode(to, code, opts) {
        if (this.fail) throw new Error('SMTP down');
        this.sent.push({ to, code, opts });
    }
});

const EmailVerificationService = require('../src/application/services/EmailVerificationService');
const { VerificationError } = EmailVerificationService;

const setup = (overrides = {}) => {
    const clock = { t: 1_700_000_000_000 };
    const db = new FakeDb();
    const users = { u1: { uid: 'u1', email: 'ana@exemplo.com', emailVerified: false, displayName: 'Ana' } };
    const mail = makeMail();
    const service = new EmailVerificationService({
        db, admin: makeAdmin(users), mailService: mail, now: () => clock.t, ...overrides
    });
    return { clock, db, users, mail, service };
};

const rejectsWith = async (promise, code, status) => {
    await assert.rejects(promise, (err) => {
        assert.ok(err instanceof VerificationError, `esperava VerificationError, veio: ${err}`);
        assert.equal(err.code, code);
        if (status) assert.equal(err.status, status);
        return true;
    });
};

// ─── Serviço ────────────────────────────────────────────────────────────────

test('envia código de 6 dígitos e guarda só o hash (nunca o código)', async () => {
    const { service, mail, db } = setup();
    const result = await service.sendCode({ uid: 'u1' });

    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0].to, 'ana@exemplo.com');
    assert.match(mail.sent[0].code, /^\d{6}$/);
    assert.equal(result.cooldownSeconds, 60);

    const stored = JSON.stringify(db.docs.get('emailVerifications/u1'));
    assert.ok(!stored.includes(mail.sent[0].code), 'o código não pode estar salvo em texto puro');
});

test('código correto verifica o e-mail e consome o código', async () => {
    const { service, mail, users, db } = setup();
    await service.sendCode({ uid: 'u1' });

    const out = await service.verifyCode({ uid: 'u1', code: mail.sent[0].code });
    assert.deepEqual(out, { verified: true });
    assert.equal(users.u1.emailVerified, true);
    assert.equal(db.docs.has('emailVerifications/u1'), false);
});

test('código errado conta tentativa e informa quantas restam', async () => {
    const { service, mail } = setup();
    await service.sendCode({ uid: 'u1' });
    const wrong = mail.sent[0].code === '000000' ? '111111' : '000000';

    await assert.rejects(service.verifyCode({ uid: 'u1', code: wrong }), (err) => {
        assert.equal(err.code, 'INVALID_CODE');
        assert.equal(err.extra.remainingAttempts, 4);
        return true;
    });
});

test('após 5 erros o código é invalidado, mesmo que o certo seja digitado depois', async () => {
    const { service, mail, users } = setup();
    await service.sendCode({ uid: 'u1' });
    const right = mail.sent[0].code;
    const wrong = right === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i++) {
        await rejectsWith(service.verifyCode({ uid: 'u1', code: wrong }), 'INVALID_CODE', 400);
    }
    await rejectsWith(service.verifyCode({ uid: 'u1', code: wrong }), 'TOO_MANY_ATTEMPTS', 429);
    await rejectsWith(service.verifyCode({ uid: 'u1', code: right }), 'NO_CODE', 400);
    assert.equal(users.u1.emailVerified, false);
});

test('código expira depois de 10 minutos', async () => {
    const { service, mail, clock, users } = setup();
    await service.sendCode({ uid: 'u1' });
    clock.t += 10 * 60 * 1000 + 1;

    await rejectsWith(service.verifyCode({ uid: 'u1', code: mail.sent[0].code }), 'EXPIRED', 400);
    assert.equal(users.u1.emailVerified, false);
});

test('reenvio respeita o intervalo de 60s e o novo código invalida o anterior', async () => {
    const { service, mail, clock } = setup();
    await service.sendCode({ uid: 'u1' });

    clock.t += 30 * 1000;
    await assert.rejects(service.sendCode({ uid: 'u1' }), (err) => {
        assert.equal(err.code, 'RESEND_COOLDOWN');
        assert.equal(err.status, 429);
        assert.equal(err.extra.retryAfter, 30);
        return true;
    });
    assert.equal(mail.sent.length, 1);

    clock.t += 31 * 1000;
    await service.sendCode({ uid: 'u1' });
    assert.equal(mail.sent.length, 2);

    const [first, second] = mail.sent.map(m => m.code);
    if (first !== second) {
        await rejectsWith(service.verifyCode({ uid: 'u1', code: first }), 'INVALID_CODE');
    }
    assert.deepEqual(await service.verifyCode({ uid: 'u1', code: second }), { verified: true });
});

test('limite de 5 envios por hora', async () => {
    const { service, clock } = setup();
    for (let i = 0; i < 5; i++) {
        await service.sendCode({ uid: 'u1' });
        clock.t += 61 * 1000;
    }
    await rejectsWith(service.sendCode({ uid: 'u1' }), 'TOO_MANY_SENDS', 429);

    clock.t += 60 * 60 * 1000;
    await service.sendCode({ uid: 'u1' }); // janela de 1h passou
});

test('falha no SMTP devolve 502 e libera novo pedido imediato', async () => {
    const { service, mail } = setup();
    mail.fail = true;
    await rejectsWith(service.sendCode({ uid: 'u1' }), 'MAIL_SEND_FAILED', 502);

    mail.fail = false;
    await service.sendCode({ uid: 'u1' }); // sem esperar o cooldown
    assert.equal(mail.sent.length, 1);
});

test('sem SMTP configurado devolve 503 e não envia nada', async () => {
    const { service, mail } = setup();
    mail.configured = false;
    await rejectsWith(service.sendCode({ uid: 'u1' }), 'MAIL_NOT_CONFIGURED', 503);
    assert.equal(mail.sent.length, 0);
});

test('conta já verificada não recebe código', async () => {
    const { service, mail, users } = setup();
    users.u1.emailVerified = true;
    assert.deepEqual(await service.sendCode({ uid: 'u1' }), { alreadyVerified: true });
    assert.equal(mail.sent.length, 0);
});

test('formato inválido é recusado antes de consultar o banco', async () => {
    const { service } = setup();
    for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined]) {
        await rejectsWith(service.verifyCode({ uid: 'u1', code: bad }), 'INVALID_FORMAT', 400);
    }
});

test('verificar sem ter pedido código retorna NO_CODE', async () => {
    const { service } = setup();
    await rejectsWith(service.verifyCode({ uid: 'u1', code: '123456' }), 'NO_CODE', 400);
});

// ─── Middleware ─────────────────────────────────────────────────────────────

test('verifyAuth exige e-mail verificado; verifyAuthAllowUnverified não', async () => {
    const adminPath = require.resolve('../src/config/firebaseAdmin');
    const tokens = {
        verified: { uid: 'a', email: 'a@x.com', email_verified: true },
        unverified: { uid: 'b', email: 'b@x.com', email_verified: false }
    };
    require.cache[adminPath] = {
        id: adminPath, filename: adminPath, loaded: true,
        exports: {
            admin: {
                auth: () => ({
                    verifyIdToken: async (t) => {
                        if (!tokens[t]) throw new Error('bad token');
                        return tokens[t];
                    }
                })
            },
            db: null,
            ADMIN_EMAIL: ''
        }
    };
    const securityPath = require.resolve('../src/middlewares/security');
    delete require.cache[securityPath];
    const { verifyAuth, verifyAuthAllowUnverified } = require(securityPath);

    const run = async (mw, token) => {
        const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, query: {} };
        const res = {
            statusCode: 200, body: null,
            status(c) { this.statusCode = c; return this; },
            json(b) { this.body = b; return this; }
        };
        let nextCalled = false;
        await mw(req, res, () => { nextCalled = true; });
        return { req, res, nextCalled };
    };

    const ok = await run(verifyAuth, 'verified');
    assert.equal(ok.nextCalled, true);

    const blocked = await run(verifyAuth, 'unverified');
    assert.equal(blocked.nextCalled, false);
    assert.equal(blocked.res.statusCode, 403);
    assert.equal(blocked.res.body.code, 'EMAIL_NOT_VERIFIED');

    const allowed = await run(verifyAuthAllowUnverified, 'unverified');
    assert.equal(allowed.nextCalled, true);

    const noToken = await run(verifyAuth, null);
    assert.equal(noToken.res.statusCode, 401);

    const badToken = await run(verifyAuth, 'nope');
    assert.equal(badToken.res.statusCode, 401);
});

// ─── MailService ────────────────────────────────────────────────────────────

test('MailService: configuração e conteúdo do e-mail (com escape do nome)', async () => {
    const MailService = require('../src/infrastructure/services/MailService');

    assert.equal(new MailService({}).isConfigured(), false);
    await assert.rejects(new MailService({}).sendVerificationCode('a@x.com', '123456'), { code: 'MAIL_NOT_CONFIGURED' });

    const svc = new MailService({ SMTP_HOST: 'smtp.x.com', SMTP_USER: 'no-reply@x.com', SMTP_PASS: 'segredo' });
    assert.equal(svc.isConfigured(), true);

    const sent = [];
    svc._transporter = { sendMail: async (m) => { sent.push(m); } };
    await svc.sendVerificationCode('ana@x.com', '482913', { name: '<script>alert(1)</script>' });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ana@x.com');
    assert.equal(sent[0].from, 'CamRB <no-reply@x.com>');
    assert.ok(sent[0].subject.includes('482913'));
    assert.ok(sent[0].text.includes('482913'));
    assert.ok(sent[0].html.includes('482913'));
    assert.ok(!sent[0].html.includes('<script>'), 'nome deve ser escapado no HTML');
});

// ─── MailService: Resend / console ──────────────────────────────────────────

const fakeFetch = (status, body) => {
    const calls = [];
    const impl = async (url, init) => {
        calls.push({ url, init, payload: JSON.parse(init.body) });
        return { ok: status >= 200 && status < 300, status, json: async () => body };
    };
    impl.calls = calls;
    return impl;
};

test('MailService: escolhe o driver automaticamente (resend > smtp > nenhum)', () => {
    const MailService = require('../src/infrastructure/services/MailService');

    assert.equal(new MailService({}).driver, 'none');
    assert.equal(new MailService({ RESEND_API_KEY: 're_x' }).driver, 'resend');
    assert.equal(new MailService({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }).driver, 'smtp');
    assert.equal(new MailService({ RESEND_API_KEY: 're_x', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }).driver, 'resend');
    assert.equal(new MailService({ SMTP_HOST: 'h', SMTP_USER: 'u' }).isConfigured(), false); // sem senha
});

test('MailService/resend: chama a API com Bearer, from padrão de teste e corpo correto', async () => {
    const MailService = require('../src/infrastructure/services/MailService');
    const f = fakeFetch(200, { id: 'abc' });
    const svc = new MailService({ RESEND_API_KEY: 're_segredo' }, { fetchImpl: f });

    assert.equal(svc.isConfigured(), true);
    await svc.sendVerificationCode('ana@x.com', '654321', { name: 'Ana' });

    assert.equal(f.calls.length, 1);
    const { url, init, payload } = f.calls[0];
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer re_segredo');
    assert.equal(payload.from, 'CamRB <onboarding@resend.dev>');
    assert.deepEqual(payload.to, ['ana@x.com']);
    assert.ok(payload.subject.includes('654321'));
    assert.ok(payload.html.includes('654321') && payload.text.includes('654321'));
});

test('MailService/resend: MAIL_FROM do domínio próprio é respeitado', async () => {
    const MailService = require('../src/infrastructure/services/MailService');
    const f = fakeFetch(200, { id: 'abc' });
    const svc = new MailService({ RESEND_API_KEY: 're_x', MAIL_FROM: 'CamRB <no-reply@camerasriobranco.com.br>' }, { fetchImpl: f });
    await svc.sendVerificationCode('ana@x.com', '111222');
    assert.equal(f.calls[0].payload.from, 'CamRB <no-reply@camerasriobranco.com.br>');
});

test('MailService/resend: 403 e 401 geram erro com dica útil para o log', async () => {
    const MailService = require('../src/infrastructure/services/MailService');

    const forbidden = new MailService({ RESEND_API_KEY: 're_x' }, { fetchImpl: fakeFetch(403, { message: 'You can only send testing emails to your own email address' }) });
    await assert.rejects(forbidden.sendVerificationCode('outra@x.com', '123456'), (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /domínio/i);
        return true;
    });

    const unauthorized = new MailService({ RESEND_API_KEY: 're_x' }, { fetchImpl: fakeFetch(401, { message: 'API key is invalid' }) });
    await assert.rejects(unauthorized.sendVerificationCode('a@x.com', '123456'), (err) => {
        assert.equal(err.status, 401);
        assert.match(err.message, /RESEND_API_KEY/);
        return true;
    });
});

test('MailService/console: só funciona com SITE_BASE_URL local e imprime o código no log', async () => {
    const MailService = require('../src/infrastructure/services/MailService');

    // produção (ou sem SITE_BASE_URL): recusa o modo console
    const prod = new MailService({ MAIL_DRIVER: 'console', SITE_BASE_URL: 'https://camerasriobranco.com.br' });
    assert.equal(prod.driver, 'none');
    assert.equal(prod.isConfigured(), false);
    assert.match(prod.disabledReason, /localhost/);
    assert.equal(new MailService({ MAIL_DRIVER: 'console' }).isConfigured(), false);

    // local: aceita e escreve o código no console
    const local = new MailService({ MAIL_DRIVER: 'console', SITE_BASE_URL: 'http://localhost:3001' });
    assert.equal(local.driver, 'console');
    assert.equal(local.isConfigured(), true);

    const lines = [];
    const original = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
        await local.sendVerificationCode('ana@x.com', '987654');
    } finally {
        console.log = original;
    }
    assert.ok(lines.some(l => l.includes('987654') && l.includes('ana@x.com')));
});

test('MailService: console + serviço de verificação funcionam juntos (fluxo local sem provedor)', async () => {
    const MailService = require('../src/infrastructure/services/MailService');
    const mail = new MailService({ MAIL_DRIVER: 'console', SITE_BASE_URL: 'http://127.0.0.1:3001' });

    let captured = '';
    const original = console.log;
    console.log = (...a) => { const m = a.join(' ').match(/Código de verificação para .*: (\d{6})/); if (m) captured = m[1]; };
    const { service, users } = setup({ mailService: mail });
    try {
        await service.sendCode({ uid: 'u1' });
    } finally {
        console.log = original;
    }
    assert.match(captured, /^\d{6}$/);
    assert.deepEqual(await service.verifyCode({ uid: 'u1', code: captured }), { verified: true });
    assert.equal(users.u1.emailVerified, true);
});
