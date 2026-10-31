// Previsão a partir das estações a montante (motor Node). Rodar: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const RioAcreService = require('../src/infrastructure/services/RioAcreService');
const Upstream = require('../src/domain/UpstreamForecast');

const pad = (n) => String(n).padStart(2, '0');
const rb = (ms) => {
    const d = new Date(ms - 5 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
};

const H = 3600000;
const ATRASO = 26;                       // a onda leva 26 h de "Capixaba" até Rio Branco
const CAPIXABA = { codigo: 'CAP', nome: 'Capixaba', atrasoRefH: ATRASO };
const onda = (t, centro, largura = 30, altura = 2.5) => altura * Math.exp(-((((t - centro) / H) / largura) ** 2));

/** 30 dias de leituras a cada 30 min; com `subindo`, uma onda nova começou a montante e ainda não chegou a Rio Branco. */
function series(subindo, { fim = Date.now() - 10 * 60000 } = {}) {
    const ondas = [fim - 22 * 24 * H, fim - 11 * 24 * H];
    if (subindo) ondas.push(fim + 4 * H);
    const montante = (t) => 1.5 + ondas.reduce((a, c) => a + onda(t, c), 0);
    const up = [], rio = [];
    for (let t = fim - 30 * 24 * H; t <= fim; t += 30 * 60000) {
        up.push({ Data_Hora_Medicao: rb(t), Cota_Adotada: Number(montante(t).toFixed(3)), Cota_Adotada_Status: 0 });
        rio.push({ Data_Hora_Medicao: rb(t), Cota_Adotada: Number((montante(t - ATRASO * H) + 0.4).toFixed(3)), Cota_Adotada_Status: 0 });
    }
    return { up, rio };
}

function criar(porCodigo, { montante = [CAPIXABA], erroEm = [] } = {}) {
    const hidro = {
        authService: { hasCredentials: () => true },
        normalizeQuality: (c) => ({ codigo: Number(c), status: Number(c) === 2 ? 'RUIM' : 'OK', confiavel: Number(c) !== 2 }),
        consultarSerieTelemetricaAdotada: async ({ codigosEstacoes }) => {
            if (erroEm.includes(codigosEstacoes)) throw new Error('estação fora do ar');
            return porCodigo[codigosEstacoes];
        }
    };
    return new RioAcreService({ hidroWebService: hidro, estacoesMontante: montante });
}

const silencio = async (fn) => {
    const w = console.warn; console.warn = () => {};
    try { return await fn(); } finally { console.warn = w; }
};

test('onda a montante antecipa a subida em Rio Branco (24 h) e o resto segue a tendência', async () => {
    const { up, rio } = series(true);
    const p = await criar({ '13600002': rio, CAP: up }).getPrevisaoRioAcre();
    assert.equal(p.disponivel, true);
    assert.equal(p.projecoes['24h'].metodo, 'montante');
    assert.equal(p.projecoes['24h'].estacao, 'Capixaba');
    assert.equal(p.projecoes['24h'].tendencia, 'Elevação');
    assert.ok(p.projecoes['24h'].nivel > p.nivelAtual + 0.5);
    assert.equal(p.projecoes['48h'].metodo, 'tendencia');   // Capixaba só alcança ~26 h
    assert.equal(p.projecoes['7d'].metodo, 'tendencia');
    assert.deepEqual(p.montante.map((m) => [m.nome, m.usadaEm]), [['Capixaba', ['24h']]]);
    assert.ok(Math.abs(p.montante[0].atrasoHoras - ATRASO) <= 2);
    assert.match(p.aviso, /Capixaba/);
    assert.match(p.aviso, /199/);
    assert.equal(p.tipo, 'estimativa-de-tendencia');          // o front e o cache aceitam só esse tipo
    assert.equal(p.direcaoPrevisao, 'Elevação');
});

test('sem onda a montante a projeção fica estável, e o retroteste erra menos que repetir o nível de hoje', async () => {
    const { up, rio } = series(false);
    const p24 = (await criar({ '13600002': rio, CAP: up }).getPrevisaoRioAcre()).projecoes['24h'];
    assert.equal(p24.metodo, 'montante');
    assert.equal(p24.tendencia, 'Estabilidade');
    assert.ok(p24.erroTipico < p24.erroPersistencia, `${p24.erroTipico} deveria ser menor que ${p24.erroPersistencia}`);
});

test('estação a montante fora do ar: cai para a tendência sem quebrar a previsão', async () => {
    const { up, rio } = series(true);
    const p = await silencio(() => criar({ '13600002': rio, CAP: up }, { erroEm: ['CAP'] }).getPrevisaoRioAcre());
    assert.equal(p.disponivel, true);
    assert.deepEqual(p.montante, []);
    assert.deepEqual(new Set(Object.values(p.projecoes).map((x) => x.metodo)), new Set(['tendencia']));
    assert.doesNotMatch(p.aviso, /Capixaba/);
});

test('leitura velha a montante é ignorada', async () => {
    const { up, rio } = series(true);
    const velha = up.filter((r) => r !== up[up.length - 1]).slice(0, up.length - 40); // para ~20 h antes do fim
    const p = await criar({ '13600002': rio, CAP: velha }).getPrevisaoRioAcre();
    assert.deepEqual(p.montante, []);
});

test('ajustar acha o atraso certo e rejeita estação que não tem a ver com o rio', () => {
    const { up, rio } = series(false);
    const conv = (arr) => arr.map((i) => ({ timestamp: Date.parse(i.Data_Hora_Medicao.replace(' ', 'T') + '-05:00'), nivelM: i.Cota_Adotada }));
    const rbH = Upstream.horaria(conv(rio));
    const bom = Upstream.ajustar({ atrasoRefH: 30 }, rbH, Upstream.horaria(conv(up))); // referência errada de propósito
    assert.ok(Math.abs(bom.atraso - ATRASO) <= 2, `atraso ${bom.atraso}`);
    assert.equal(bom.usavel, true);
    assert.ok(bom.correlacao > 0.95);

    const ruido = conv(up).map((r, i) => ({ ...r, nivelM: 2 + ((i * 7919) % 100) / 50 })); // ruído sem relação
    const mau = Upstream.ajustar({ atrasoRefH: 26 }, rbH, Upstream.horaria(ruido));
    assert.equal(mau.usavel, false);
});

test('com a lista de estações vazia, tudo é tendência e nenhuma estação é consultada', async () => {
    const { rio } = series(false);
    let chamadas = 0;
    const svc = criar({ '13600002': rio }, { montante: [] });
    const original = svc.hidroWebService.consultarSerieTelemetricaAdotada;
    svc.hidroWebService.consultarSerieTelemetricaAdotada = async (a) => { chamadas++; return original(a); };
    const p = await svc.getPrevisaoRioAcre();
    assert.deepEqual(p.montante, []);
    assert.ok(chamadas <= 3, `${chamadas} chamadas`);           // só Rio Branco (nível, histórico e série de 30 dias)
});
