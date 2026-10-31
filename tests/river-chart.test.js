const test = require('node:test');
const assert = require('node:assert/strict');

const RiverChartService = require('../src/infrastructure/services/RiverChartService');
const RioAlertService = require('../src/application/services/RioAlertService');

// ─── Dublês ─────────────────────────────────────────────────────────────────
const dia = (data, diaSemana, nivel, min, max, isHoje = false) => ({ data, dataCompleta: `${data}/2026`, diaSemana, nivel, min, max, isHoje });

const SEMANA = [
    dia('24/10', 'Sáb', 2.1, 2.0, 2.2),
    dia('25/10', 'Dom', 2.4, 2.1, 2.9),
    dia('26/10', 'Seg', 3.6, 2.9, 4.3),
    dia('27/10', 'Ter', 4.1, 3.5, 4.4),
    dia('28/10', 'Qua', 3.5, 3.0, 4.0),
    dia('29/10', 'Qui', 2.8, 2.5, 3.2),
    dia('30/10', 'Sex', 2.2, 2.0, 2.6, true)
];
const COTAS = { atencao: 12.5, alerta: 13.5, transbordamento: 14 };

function makeFs() {
    const files = new Map();
    return {
        files,
        async mkdir() {},
        async writeFile(full, data) { files.set(full.split(/[\\/]/).pop(), data); }
    };
}

const rioCom = (pontos, erro) => ({
    async getHistoricoRioAcre(dias) {
        if (erro) throw erro;
        return { pontos: pontos.slice(-dias), cotasReferencia: COTAS };
    }
});

// ─── Resumo e SVG ───────────────────────────────────────────────────────────
test('o resumo diz se o rio subiu, desceu ou ficou estável e cita extremos reais', () => {
    const r = RiverChartService.summarize(SEMANA);
    assert.equal(r.direcao, 'subiu');               // média diária 2,10 → 2,20 m: +10 cm, acima da margem de 5 cm
    assert.match(r.texto, /subiu 0,10 m/);
    const parado = RiverChartService.summarize([dia('01/10', 'Qua', 2.00, 1.9, 2.1), dia('02/10', 'Qui', 2.03, 1.9, 2.2)]);
    assert.equal(parado.direcao, 'ficou estável');
    assert.match(r.texto, /Maior nível: 4,40 m em 27\/10/);
    assert.match(r.texto, /Menor: 2,00 m em 24\/10/);

    const sobe = RiverChartService.summarize([dia('01/10', 'Qua', 2, 1.9, 2.1), dia('02/10', 'Qui', 3, 2.5, 3.2)]);
    assert.equal(sobe.direcao, 'subiu');
    assert.match(sobe.texto, /subiu 1,00 m/);
    assert.equal(RiverChartService.summarize([dia('01/10', 'Qua', 2, 1.9, 2.1)]), null); // um dia só não vira gráfico
});

test('o SVG tem uma barra e um ponto por dia, e só mostra a cota quando ela está por perto', () => {
    const svg = RiverChartService.buildSvg(SEMANA, COTAS);
    assert.equal((svg.match(/<circle/g) || []).length, 7);
    assert.equal((svg.match(/rx="6"/g) || []).length, 7);
    assert.ok(!svg.includes('transbordamento'), 'rio em ~4 m não precisa de linha de cota a 14 m');
    assert.match(svg, />2,20 m</);                   // rótulo do nível mais recente

    const cheia = SEMANA.map((p) => ({ ...p, nivel: p.nivel + 9.5, min: p.min + 9.5, max: p.max + 9.5 }));
    const svgCheia = RiverChartService.buildSvg(cheia, COTAS);
    assert.match(svgCheia, /atenção 12,5</);       // rio a ~13,9 m: mostra as cotas ao alcance
    assert.match(svgCheia, /alerta 13,5</);
});

test('textos vindos de fora são escapados no SVG', () => {
    const svg = RiverChartService.buildSvg([dia('01/10', '<b>', 2, 1.9, 2.1), dia('02/10', 'Qui', 3, 2.5, 3.2)], {});
    assert.ok(!svg.includes('<b>'));
    assert.ok(svg.includes('&lt;b&gt;'));
});

// ─── PNG e arquivo ──────────────────────────────────────────────────────────
test('render grava um PNG de verdade e devolve o endereço público', async () => {
    const fsp = makeFs();
    const svc = new RiverChartService({ rioService: rioCom(SEMANA), baseUrl: 'https://exemplo.com/', dir: '/tmp/x', fsp, now: () => Date.UTC(2026, 9, 30, 15, 0) });
    const out = await svc.render('ev1');
    assert.match(out.url, /^https:\/\/exemplo\.com\/uploads\/alertas\/rio-grafico-ev1-\d{12}-[0-9a-f]{8}\.png$/);
    assert.equal(out.dias, 7);
    const png = fsp.files.get(out.file);
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);   // assinatura PNG
    assert.match(out.file, /^rio-.+\.png$/);                                // a rotina de limpeza das fotos apaga este arquivo também
});

test('sem dados do rio não há gráfico (nada inventado)', async () => {
    const semDados = new RiverChartService({ rioService: rioCom([], new Error('ANA fora do ar')), baseUrl: 'https://e.com', dir: '/x', fsp: makeFs() });
    assert.equal(await semDados.render(), null);
    const pouco = new RiverChartService({ rioService: rioCom([SEMANA[0]]), baseUrl: 'https://e.com', dir: '/x', fsp: makeFs() });
    assert.equal(await pouco.render(), null);
});

// ─── No e-mail de alerta ────────────────────────────────────────────────────
function makeAlertService(chart) {
    return new RioAlertService({
        repo: { async getState() { return {}; }, async listActiveSubscribers() { return []; } },
        mailService: { isConfigured: () => true, async sendMessage() {} },
        rioService: { cotaAtencao: 12.5, cotaAlerta: 13.5, cotaTransbordamento: 14, async getNivelRioAcre() { return {}; } },
        chart,
        tokenSecret: 'segredo'
    });
}
const EVENTO = { id: 'teste', level: 'alerta', metros: 13.6, dataLeitura: '30/10/2026 10:00', fonte: 'ANA' };

test('o e-mail de alerta mostra o gráfico com texto alternativo e resumo em texto simples', async () => {
    const svc = makeAlertService(null);
    const chart = { url: 'https://e.com/uploads/alertas/rio-grafico-x.png', resumo: 'Nos últimos 7 dias o rio subiu 2,00 m.', dias: 7 };
    const msg = svc._buildAlertMessage({ id: 's1', email: 'a@b.com' }, EVENTO, { chart });
    assert.match(msg.html, /<img src="https:\/\/e\.com\/uploads\/alertas\/rio-grafico-x\.png" alt="Nos últimos 7 dias o rio subiu 2,00 m\."/);
    assert.match(msg.html, /Como o rio andou nos últimos 7 dias/);
    assert.match(msg.text, /Como o rio andou nos últimos dias:\nNos últimos 7 dias o rio subiu 2,00 m\./);

    const sem = svc._buildAlertMessage({ id: 's1', email: 'a@b.com' }, EVENTO, {});
    assert.ok(!sem.html.includes('Como o rio andou'));
    assert.ok(!sem.text.includes('Como o rio andou'));
});

test('a prévia do painel inclui o gráfico e falha no gráfico não derruba o e-mail', async () => {
    const chart = { async render() { return { url: 'https://e.com/g.png', resumo: 'Resumo.', dias: 7 }; } };
    const prev = await makeAlertService(chart).previewAlert({ level: 'alerta', metros: 13.6 });
    assert.match(prev.html, /https:\/\/e\.com\/g\.png/);
    assert.deepEqual(prev.grafico, { url: 'https://e.com/g.png', resumo: 'Resumo.' });

    const quebrado = { async render() { throw new Error('sharp falhou'); } };
    const orig = console.error; console.error = () => {};
    try {
        const prev2 = await makeAlertService(quebrado).previewAlert({ level: 'alerta', metros: 13.6 });
        assert.ok(prev2.html.includes('13,60 m'));
        assert.equal(prev2.grafico, null);
    } finally { console.error = orig; }
});
