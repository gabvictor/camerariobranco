const test = require('node:test');
const assert = require('node:assert/strict');

const VisitorSessionService = require('../src/application/services/VisitorSessionService');

const S = 1000;
const MIN = 60 * S;

function setup(options = {}) {
    const clock = { t: Date.UTC(2026, 9, 31, 15, 0, 0) }; // 31/10/2026 10:00 em Rio Branco
    const repo = {
        sessions: [],
        daily: {},
        addDailyCalls: [],
        failDaily: false,
        purged: [],
        async saveSession(r) { this.sessions.push(r); },
        async addDaily(date, d) {
            if (this.failDaily) throw new Error('banco fora');
            this.addDailyCalls.push({ date, d });
            const cur = this.daily[date] || { sessions: 0, seconds: 0, bounces: 0, logged: 0, withCamera: 0, pageViews: 0, hours: {}, devices: {}, cameraSeconds: {}, cameraSessions: {}, pageSeconds: {}, cameraNames: {}, pagePaths: {} };
            for (const k of ['sessions', 'seconds', 'bounces', 'logged', 'withCamera', 'pageViews']) cur[k] += d[k];
            for (const m of ['hours', 'devices', 'cameraSeconds', 'cameraSessions', 'pageSeconds']) for (const [k, v] of Object.entries(d[m])) cur[m][k] = (cur[m][k] || 0) + v;
            Object.assign(cur.cameraNames, d.cameraNames); Object.assign(cur.pagePaths, d.pagePaths);
            this.daily[date] = cur;
        },
        async getDaily(dates) { return Object.fromEntries(dates.filter((d) => this.daily[d]).map((d) => [d, this.daily[d]])); },
        async listSessions({ sinceMs, limit }) { return this.sessions.filter((s) => s.endedAtMs >= sinceMs).sort((a, b) => b.endedAtMs - a.endedAtMs).slice(0, limit); },
        async purgeOlderThan(ms) { this.purged.push(ms); return 0; }
    };
    const svc = new VisitorSessionService({ repo, now: () => clock.t, options });
    const advance = (ms) => { clock.t += ms; };
    return { svc, repo, clock, advance };
}

const meta = { device: 'Mobile', browser: 'Chrome', os: 'Android', city: 'Rio Branco', region: 'Acre', country: 'Brasil', ipMasked: '200.1.x.x' };

test('mede o tempo na página e grava o perfil depois que a sessão fica parada', async () => {
    const { svc, repo, advance } = setup();
    svc.pageOpened({ sid: 'tab_a', connId: 'c1', path: '/rio', title: 'Rio Acre', meta });
    advance(90 * S);
    svc.pageClosed('c1');
    await svc.sweep();
    assert.equal(repo.sessions.length, 0, 'ainda não passou o tempo de inatividade');

    advance(4 * MIN);
    const r = await svc.sweep();
    assert.equal(r.encerradas, 1);
    const rec = repo.sessions[0];
    assert.equal(rec.durationSec, 90);
    assert.equal(rec.entryPath, '/rio');
    assert.deepEqual(rec.pages.map((p) => [p.path, p.seconds]), [['/rio', 90]]);
    assert.equal(rec.city, 'Rio Branco');
    assert.equal(rec.ipMasked, '200.1.x.x');
});

test('sessão com conexão aberta nunca é encerrada por inatividade', async () => {
    const { svc, repo, advance } = setup();
    svc.pageOpened({ sid: 'tab_a', connId: 'c1', path: '/', title: 'Início', meta });
    advance(30 * MIN);
    const r = await svc.sweep();
    assert.equal(r.encerradas, 0);
    assert.equal(repo.sessions.length, 0);
    assert.equal(svc.live()[0].tempoSegundos, 1800);
});

test('tempo com a aba em segundo plano NÃO conta', async () => {
    const { svc, repo, advance } = setup();
    svc.pageOpened({ sid: 'tab_a', connId: 'c1', path: '/', title: 'Início', meta });
    advance(10 * S);
    svc.setHidden('tab_a', true);
    advance(30 * S);              // 30 s escondida
    svc.setHidden('tab_a', false);
    advance(20 * S);
    svc.pageClosed('c1');
    advance(5 * MIN);
    await svc.sweep();
    const rec = repo.sessions[0];
    assert.equal(rec.durationSec, 30, '10 s + 20 s visíveis');
    assert.equal(rec.pages[0].seconds, 30);
});

test('aba escondida até o fim: descontado até o fechamento', async () => {
    const { svc, repo, advance } = setup();
    svc.pageOpened({ sid: 'tab_a', connId: 'c1', path: '/', title: 'Início', meta });
    advance(25 * S);
    svc.setHidden('tab_a', true);
    advance(10 * MIN);
    svc.pageClosed('c1');
    advance(5 * MIN);
    await svc.sweep();
    assert.equal(repo.sessions[0].durationSec, 25);
});

test('registra quais câmeras foram assistidas e por quanto tempo cada uma', async () => {
    const { svc, repo, advance } = setup();
    svc.pageOpened({ sid: 'tab_a', connId: 'p1', path: '/', title: 'Início', meta });
    svc.cameraOpened({ sid: 'tab_a', connId: 'v1', code: '001334', name: 'Passarela Joaquim Macedo', meta });
    advance(120 * S);
    svc.cameraClosed('v1');
    svc.cameraOpened({ sid: 'tab_a', connId: 'v2', code: '001426', name: 'Ponte Metálica', meta });
    advance(45 * S);
    svc.cameraClosed('v2');
    svc.cameraOpened({ sid: 'tab_a', connId: 'v3', code: '001334', name: 'Passarela Joaquim Macedo', meta });
    advance(30 * S);
    svc.cameraClosed('v3');
    svc.pageClosed('p1');
    advance(5 * MIN);
    await svc.sweep();

    const rec = repo.sessions[0];
    assert.deepEqual(rec.cameras.map((c) => [c.code, c.name, c.seconds, c.views]),
        [['001334', 'Passarela Joaquim Macedo', 150, 2], ['001426', 'Ponte Metálica', 45, 1]]);
    assert.equal(rec.cameraSeconds, 195);
    assert.equal(rec.durationSec, 195, 'página e vídeos ao mesmo tempo contam uma vez só');
});

test('navegar entre páginas soma o tempo e lista cada página', async () => {
    const { svc, repo, advance } = setup();
    svc.pageOpened({ sid: 'tab_a', connId: 'p1', path: '/', title: 'Início', meta });
    advance(40 * S);
    svc.pageClosed('p1');
    advance(2 * S); // troca de página
    svc.pageOpened({ sid: 'tab_a', connId: 'p2', path: '/rio', title: 'Rio', meta });
    advance(100 * S);
    svc.pageClosed('p2');
    advance(5 * MIN);
    await svc.sweep();
    const rec = repo.sessions[0];
    assert.equal(rec.durationSec, 140, 'a troca de 2 s entre páginas não conta');
    assert.equal(rec.entryPath, '/');
    assert.deepEqual(rec.pages.map((p) => p.path), ['/rio', '/'], 'ordenadas por tempo');
});

test('fechar a mesma conexão várias vezes não duplica o tempo', async () => {
    const { svc, repo, advance } = setup();
    svc.pageOpened({ sid: 'tab_a', connId: 'p1', path: '/', title: 'Início', meta });
    advance(30 * S);
    svc.pageClosed('p1'); svc.pageClosed('p1'); svc.pageClosed('p1');
    advance(5 * MIN);
    await svc.sweep();
    assert.equal(repo.sessions[0].pages[0].seconds, 30);
    assert.equal(repo.sessions[0].pages[0].views, 1);
});

test('robôs são ignorados', async () => {
    const { svc, repo, advance } = setup();
    assert.equal(VisitorSessionService.isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
    assert.equal(VisitorSessionService.isBot('Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36'), false);
    assert.equal(VisitorSessionService.isBot(''), true);
    svc.pageOpened({ sid: 'bot', connId: 'c1', path: '/', title: 'x', meta: { bot: true } });
    advance(10 * MIN);
    assert.equal(svc.live().length, 0);
    await svc.sweep();
    assert.equal(repo.sessions.length, 0);
});

test('visitante logado guarda id e apelido, nunca o e-mail', async () => {
    const { svc, repo, advance } = setup();
    svc.pageOpened({ sid: 'tab_a', connId: 'p1', path: '/', title: 'Início', user: { uid: 'u1', name: 'Maria', email: 'maria@x.com' }, meta });
    advance(5 * S);
    svc.pageClosed('p1');
    advance(5 * MIN);
    await svc.sweep();
    const rec = repo.sessions[0];
    assert.equal(rec.isLoggedIn, true, 'logado é sempre relevante, mesmo curto');
    assert.equal(rec.userId, 'u1');
    assert.equal(rec.userName, 'Maria');
    assert.doesNotMatch(JSON.stringify(rec), /maria@x\.com/);
});

test('só guarda perfil detalhado quando vale a pena; o resumo do dia conta todas', async () => {
    const { svc, repo, advance } = setup();
    // 1) saída rápida anônima (5 s, sem câmera): só entra no resumo
    svc.pageOpened({ sid: 'rapida', connId: 'a', path: '/', title: 'x', meta });
    advance(5 * S); svc.pageClosed('a');
    // 2) 12 s assistindo câmera: guarda
    svc.pageOpened({ sid: 'cam', connId: 'b', path: '/camera/1', title: 'x', meta });
    svc.cameraOpened({ sid: 'cam', connId: 'v', code: '001334', name: 'Passarela', meta });
    advance(12 * S); svc.cameraClosed('v'); svc.pageClosed('b');
    // 3) 25 s no site: guarda
    svc.pageOpened({ sid: 'longa', connId: 'c', path: '/', title: 'x', meta });
    advance(25 * S); svc.pageClosed('c');
    advance(5 * MIN);
    await svc.sweep();
    assert.deepEqual(repo.sessions.map((s) => s.sid).sort(), ['cam', 'longa']);
    await svc.flushAll();
    const day = Object.values(repo.daily)[0];
    assert.equal(day.sessions, 3);
    assert.equal(day.bounces, 1);
    assert.equal(day.withCamera, 1);
});

test('limite diário de perfis detalhados protege a cota do banco', async () => {
    const { svc, repo, advance } = setup({ maxDetailedPerDay: 2 });
    for (let i = 0; i < 4; i++) {
        svc.pageOpened({ sid: `s${i}`, connId: `c${i}`, path: '/', title: 'x', meta });
        advance(40 * S); svc.pageClosed(`c${i}`);
    }
    advance(5 * MIN);
    await svc.sweep();
    assert.equal(repo.sessions.length, 2);
    await svc.flushAll();
    assert.equal(Object.values(repo.daily)[0].sessions, 4, 'resumo conta todas');
});

test('resumo do dia é gravado em lote e volta para a fila se o banco falhar', async () => {
    const { svc, repo, advance } = setup({ flushEveryMs: 5 * MIN });
    svc.pageOpened({ sid: 'a', connId: 'c', path: '/rio', title: 'Rio', meta });
    advance(60 * S); svc.pageClosed('c');
    advance(4 * MIN);
    repo.failDaily = true;
    await svc.sweep();
    assert.equal(repo.addDailyCalls.length, 0);

    advance(MIN);
    repo.failDaily = false;
    await svc.sweep();
    assert.equal(repo.addDailyCalls.length, 0, 'só tenta de novo no próximo lote');

    advance(5 * MIN);
    await svc.sweep();
    assert.equal(repo.addDailyCalls.length, 1, 'tentou de novo e gravou');
    assert.equal(repo.addDailyCalls[0].d.sessions, 1);
    assert.equal(repo.addDailyCalls[0].d.seconds, 60);

    await svc.flushAll();
    assert.equal(repo.addDailyCalls.length, 1, 'nada em duplicidade');
});

test('resumo junta o gravado com o que ainda está pendente e calcula as médias', async () => {
    const { svc, repo, advance } = setup();
    // sessão A: 120 s, câmera 100 s
    svc.pageOpened({ sid: 'a', connId: 'c1', path: '/rio', title: 'Rio', meta });
    svc.cameraOpened({ sid: 'a', connId: 'v1', code: '001334', name: 'Passarela', meta });
    advance(100 * S); svc.cameraClosed('v1'); advance(20 * S); svc.pageClosed('c1');
    // sessão B: 8 s (saída rápida)
    svc.pageOpened({ sid: 'b', connId: 'c2', path: '/', title: 'Início', meta });
    advance(8 * S); svc.pageClosed('c2');
    advance(5 * MIN);
    await svc.sweep();     // ainda pendente (lote não venceu)
    const r = await svc.summary(7);
    assert.equal(r.sessoes, 2);
    assert.equal(r.mediaSegundos, 64, '(120 + 8) / 2');
    assert.equal(r.saidaRapidaPct, 50);
    assert.equal(r.comCameraPct, 50);
    assert.equal(r.camerasMaisAssistidas[0].nome, 'Passarela');
    assert.equal(r.camerasMaisAssistidas[0].segundos, 100);
    assert.equal(r.paginasMaisUsadas[0].caminho, '/rio');
    assert.equal(r.porHora.length, 24);
    assert.equal(r.porHora[10].sessoes, 2, 'início às 10h em Rio Branco');
    assert.equal(r.porDia.length, 7);
});

test('ao vivo: mostra tempo, onde está e o que assiste agora', async () => {
    const { svc, advance } = setup();
    svc.pageOpened({ sid: 'tab_abcdef12', connId: 'p', path: '/camera/001334', title: 'Câmera', user: { uid: 'u', name: 'Ana' }, meta });
    svc.cameraOpened({ sid: 'tab_abcdef12', connId: 'v', code: '001334', name: 'Passarela', meta });
    advance(50 * S);
    svc.setHidden('tab_abcdef12', true);
    const [v] = svc.live();
    assert.equal(v.id, 'abcdef12');
    assert.equal(v.usuario.nome, 'Ana');
    assert.equal(v.tempoSegundos, 50);
    assert.equal(v.emSegundoPlano, true);
    assert.deepEqual(v.assistindoAgora.map((c) => [c.codigo, c.nome, c.segundos]), [['001334', 'Passarela', 50]]);
    assert.equal(v.paginaAtual[0].caminho, '/camera/001334');
});

test('desligar o servidor grava as sessões em andamento', async () => {
    const { svc, repo, advance } = setup();
    svc.pageOpened({ sid: 'a', connId: 'c', path: '/rio', title: 'Rio', meta });
    advance(70 * S);
    await svc.flushAll();
    assert.equal(repo.sessions.length, 1);
    assert.equal(repo.sessions[0].durationSec, 70);
    assert.equal(svc.live().length, 0);
});

test('limpeza de perfis antigos usa a retenção configurada, no máximo uma vez por dia', async () => {
    const { svc, repo, clock, advance } = setup({ retentionDays: 30 });
    await svc.sweep();
    assert.equal(repo.purged.length, 1);
    assert.equal(repo.purged[0], clock.t - 30 * 24 * 3600 * 1000);
    advance(3 * 3600 * 1000);
    await svc.sweep();
    assert.equal(repo.purged.length, 1, 'ainda não passou 1 dia');
    advance(22 * 3600 * 1000);
    await svc.sweep();
    assert.equal(repo.purged.length, 2);
});

test('lista de perfis: filtros por câmera, login e tempo mínimo', async () => {
    const { svc, advance } = setup();
    svc.pageOpened({ sid: 'x1', connId: 'a', path: '/', title: 'x', meta });
    advance(40 * S); svc.pageClosed('a');
    svc.pageOpened({ sid: 'x2', connId: 'b', path: '/', title: 'x', user: { uid: 'u', name: 'Ana' }, meta });
    svc.cameraOpened({ sid: 'x2', connId: 'v', code: '001334', name: 'Passarela', meta });
    advance(300 * S); svc.cameraClosed('v'); svc.pageClosed('b');
    advance(5 * MIN);
    await svc.sweep();
    assert.equal((await svc.sessions({})).length, 2);
    assert.equal((await svc.sessions({ onlyCamera: true })).length, 1);
    assert.equal((await svc.sessions({ onlyLogged: true })).length, 1);
    assert.equal((await svc.sessions({ minSeconds: 100 })).length, 1);
    const [first] = await svc.sessions({ onlyCamera: true });
    assert.equal(first.cameras[0].nome, 'Passarela');
    assert.equal(first.usuario.nome, 'Ana');
    assert.equal(first.id, 'x2'.slice(-8));
});

test('não altera o objeto de dados recebido (nada vaza de uma visita para outra)', async () => {
    const { svc, repo, advance } = setup();
    const shared = { device: 'Desktop', browser: 'Firefox', os: 'Linux', city: 'X', region: 'Y', country: 'Z', ipMasked: 'a' };
    svc.pageOpened({ sid: 'um', connId: 'c1', path: '/rio', title: 'Rio', meta: shared });
    assert.equal(shared.entryPath, undefined, 'objeto original intacto');
    svc.pageOpened({ sid: 'dois', connId: 'c2', path: '/', title: 'Início', meta: shared });
    advance(40 * S); svc.pageClosed('c1'); svc.pageClosed('c2');
    advance(5 * MIN);
    await svc.sweep();
    const byId = Object.fromEntries(repo.sessions.map((s) => [s.sid, s.entryPath]));
    assert.deepEqual(byId, { um: '/rio', dois: '/' });
});

test('falha persistente do banco não trava a rotina (antes girava para sempre)', async () => {
    const { svc, repo, advance } = setup({ flushEveryMs: MIN });
    repo.failDaily = true;
    svc.pageOpened({ sid: 'a', connId: 'c', path: '/', title: 'x', meta });
    advance(30 * S); svc.pageClosed('c');
    advance(5 * MIN);
    const r = await Promise.race([svc.sweep(), new Promise((resolve) => setTimeout(() => resolve('TRAVOU'), 2000))]);
    assert.notEqual(r, 'TRAVOU');
});

// ─── Só pessoas logadas ─────────────────────────────────────────────────────
const ana = { uid: 'u_ana', name: 'Ana' };

test('com requireLogin, anônimos e robôs não viram perfil, contagem nem "ao vivo"', async () => {
    const { svc, repo, advance } = setup({ requireLogin: true });
    for (let i = 0; i < 20; i++) svc.pageOpened({ sid: `anon${i}`, connId: `c${i}`, path: '/', title: 'Início', meta });
    svc.cameraOpened({ sid: 'anon0', connId: 'v0', code: '001334', name: 'Passarela', meta });
    svc.pageOpened({ sid: 'bot', connId: 'b', path: '/', title: 'x', user: ana, meta: { bot: true } });
    assert.equal(svc.live().length, 0);
    advance(40 * S);
    for (let i = 0; i < 20; i++) svc.pageClosed(`c${i}`);
    advance(5 * MIN);
    await svc.sweep();
    assert.equal(repo.sessions.length, 0);
    assert.deepEqual(repo.addDailyCalls, []);
});

test('com requireLogin, quem está logado continua sendo medido', async () => {
    const { svc, repo, advance } = setup({ requireLogin: true });
    svc.pageOpened({ sid: 'u_ana', connId: 'c', path: '/rio', title: 'Rio', user: ana, meta });
    assert.equal(svc.live().length, 1);
    advance(60 * S); svc.pageClosed('c');
    advance(5 * MIN);
    await svc.sweep();
    assert.equal(repo.sessions.length, 1);
    assert.equal(repo.sessions[0].userName, 'Ana');
    assert.equal(repo.sessions[0].durationSec, 60);
});

test('a mesma pessoa em várias abas vira uma sessão só, sem somar o tempo duas vezes', async () => {
    const { svc, repo, advance } = setup({ requireLogin: true });
    svc.pageOpened({ sid: 'u_ana', tab: 'tab_aaaaaa', connId: 'a', path: '/', title: 'Início', user: ana, meta });
    advance(30 * S);
    svc.pageOpened({ sid: 'u_ana', tab: 'tab_bbbbbb', connId: 'b', path: '/rio', title: 'Rio', user: ana, meta });
    assert.equal(svc.live().length, 1);
    advance(30 * S);
    svc.pageClosed('a'); svc.pageClosed('b');
    advance(5 * MIN);
    await svc.sweep();
    assert.equal(repo.sessions.length, 1);
    assert.equal(repo.sessions[0].durationSec, 60);      // 60 s de relógio, não 90 s de soma das abas
    assert.deepEqual(repo.sessions[0].pages.map((p) => p.path).sort(), ['/', '/rio']);
});

test('segundo plano só desconta quando TODAS as abas estão escondidas', async () => {
    const { svc, repo, advance } = setup({ requireLogin: true });
    svc.pageOpened({ sid: 'u_ana', tab: 'tab_aaaaaa', connId: 'a', path: '/', title: 'Início', user: ana, meta });
    svc.pageOpened({ sid: 'u_ana', tab: 'tab_bbbbbb', connId: 'b', path: '/rio', title: 'Rio', user: ana, meta });
    advance(20 * S);
    svc.setHidden('tab_aaaaaa', true);                    // uma escondida, a outra à vista
    advance(20 * S);
    svc.setHidden('tab_bbbbbb', true);                    // agora as duas
    advance(20 * S);
    svc.setHidden('tab_bbbbbb', false);                   // uma volta
    advance(20 * S);
    svc.pageClosed('a'); svc.pageClosed('b');
    advance(5 * MIN);
    await svc.sweep();
    assert.equal(repo.sessions[0].durationSec, 60);      // 80 s no total menos os 20 s com tudo escondido
});

test('fechar a aba escondida devolve a contagem para as abas que sobraram', async () => {
    const { svc, repo, advance } = setup({ requireLogin: true });
    svc.pageOpened({ sid: 'u_ana', tab: 'tab_aaaaaa', connId: 'a', path: '/', title: 'Início', user: ana, meta });
    svc.pageOpened({ sid: 'u_ana', tab: 'tab_bbbbbb', connId: 'b', path: '/rio', title: 'Rio', user: ana, meta });
    svc.setHidden('tab_aaaaaa', true);
    advance(30 * S);
    svc.pageClosed('a');                                  // a aba escondida fecha: sobra só a visível
    advance(30 * S);
    svc.pageClosed('b');
    advance(5 * MIN);
    await svc.sweep();
    assert.equal(repo.sessions[0].durationSec, 60);      // nunca esteve tudo escondido
});
