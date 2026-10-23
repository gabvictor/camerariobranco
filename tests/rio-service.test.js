// Testes offline do RioAcreService (Node). Rodar: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const RioAcreService = require('../src/infrastructure/services/RioAcreService');
const { DadosIndisponiveisError } = RioAcreService;

const pad = (n) => String(n).padStart(2, '0');
// Gera "YYYY-MM-DD HH:mm:ss" no relógio de Rio Branco (UTC-5) para um instante em ms
const rb = (ms) => {
    const d = new Date(ms - 5 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
};
const serie = ({ horas = 30, inicio = 1.6, taxaH = 0, idadeMin = 10, status = 0 } = {}) => {
    const fim = Date.now() - idadeMin * 60000;
    const itens = [];
    for (let t = fim - horas * 3600000; t <= fim; t += 15 * 60000) {
        const h = (t - (fim - horas * 3600000)) / 3600000;
        itens.push({ Data_Hora_Medicao: rb(t), Cota_Adotada: Number((inicio + taxaH * h).toFixed(3)), Cota_Adotada_Status: status });
    }
    return itens;
};

function criar({ hw, legacy, credenciais = true } = {}) {
    const calls = { hw: 0, legacy: 0 };
    const hidro = {
        authService: { hasCredentials: () => credenciais },
        normalizeQuality: (c) => ({ 0: { codigo: 0, status: 'OK', confiavel: true }, 1: { codigo: 1, status: 'SUSPEITO', confiavel: false }, 2: { codigo: 2, status: 'RUIM', confiavel: false } }[Number(c)] || { codigo: -1, status: 'DESCONHECIDO', confiavel: true }),
        consultarSerieTelemetricaAdotada: async () => { calls.hw++; if (hw instanceof Error) throw hw; return hw; }
    };
    const svc = new RioAcreService({ hidroWebService: hidro });
    svc._readingsFromLegacy = async () => { calls.legacy++; if (legacy instanceof Error) throw legacy; return { readings: svc._cleanReadings(svc._parseHidroWebReadings(legacy)), fonte: 'WebService Legado (ANA)' }; };
    return { svc, calls };
}

test('HidroWeb tem prioridade e o legado nem é chamado', async () => {
    const { svc, calls } = criar({ hw: serie(), legacy: serie({ inicio: 5 }) });
    const n = await svc.getNivelRioAcre();
    assert.equal(n.fonte, 'HidroWebService (ANA)');
    assert.deepEqual(calls, { hw: 1, legacy: 0 });
    assert.equal(n.estado, 'ok');
});

test('cai para o legado quando a HidroWeb falha; pula HidroWeb sem credenciais', async () => {
    let r = criar({ hw: new Error('401'), legacy: serie() });
    assert.equal((await r.svc.getNivelRioAcre()).fonte, 'WebService Legado (ANA)');
    r = criar({ hw: serie(), legacy: serie(), credenciais: false });
    await r.svc.getNivelRioAcre();
    assert.equal(r.calls.hw, 0);
});

test('tudo falha sem cache: erro explícito, nunca valor inventado', async () => {
    const { svc } = criar({ hw: new Error('a'), legacy: new Error('b') });
    await assert.rejects(() => svc.getNivelRioAcre(), DadosIndisponiveisError);
    await assert.rejects(() => svc.getHistoricoRioAcre(7), DadosIndisponiveisError);
    await assert.rejects(() => svc.getPrevisaoRioAcre(), DadosIndisponiveisError);
});

test('tudo falha com cache: devolve a leitura REAL anterior marcada como desatualizada', async () => {
    const r = criar({ hw: serie(), legacy: new Error('x') });
    const ok = await r.svc.getNivelRioAcre();
    r.svc._lastFetchTime = 0; // expira o cache
    r.svc.hidroWebService.consultarSerieTelemetricaAdotada = async () => { throw new Error('caiu'); };
    const velho = await r.svc.getNivelRioAcre();
    assert.equal(velho.nivel.metros, ok.nivel.metros);
    assert.equal(velho.estado, 'desatualizado');
    assert.equal(velho.frescor.falhaAoAtualizar, true);
});

test('leitura antiga é marcada como desatualizada', async () => {
    const { svc } = criar({ hw: serie({ idadeMin: 300 }) });
    const n = await svc.getNivelRioAcre();
    assert.equal(n.frescor.desatualizado, true);
    assert.match(n.frescor.mensagem, /5 h/);
});

test('descarta qualidade RUIM; chuva ausente vira null (não "0,0 mm"); cm viram m', async () => {
    const itens = [
        { Data_Hora_Medicao: rb(Date.now() - 20 * 60000), Cota_Adotada: 176, Cota_Adotada_Status: 0 },
        { Data_Hora_Medicao: rb(Date.now() - 5 * 60000), Cota_Adotada: 9.99, Cota_Adotada_Status: 2 }
    ];
    const { svc } = criar({ hw: itens });
    const n = await svc.getNivelRioAcre();
    assert.equal(n.nivel.metros, 1.76);
    assert.equal(n.chuva, null);
});

test('datas sem fuso usam ANA_DATA_UTC_OFFSET (padrão -05:00)', () => {
    const { svc } = criar({});
    assert.equal(svc._parseDateToLocal('2026-10-23 14:00:00').toISOString(), '2026-10-23T19:00:00.000Z');
    assert.equal(svc._parseDateToLocal('2026-10-23T14:00:00.0Z').toISOString(), '2026-10-23T14:00:00.000Z');
    svc.dataUtcOffset = '-03:00';
    assert.equal(svc._parseDateToLocal('23/10/2026 14:00').toISOString(), '2026-10-23T17:00:00.000Z');
    assert.equal(svc._parseDateToLocal('lixo'), null);
});

test('XML legado fora de ordem: usa a leitura mais recente', () => {
    const { svc } = criar({});
    const xml = `<a><DadosHidrometereologicos><DataHora>2026-10-23 08:00:00</DataHora><Nivel>1,70</Nivel></DadosHidrometereologicos>
      <DadosHidrometereologicos><DataHora>2026-10-23 12:00:00</DataHora><Nivel>176</Nivel></DadosHidrometereologicos>
      <DadosHidrometereologicos><DataHora>2026-10-23 10:00:00</DataHora><Nivel></Nivel></DadosHidrometereologicos></a>`;
    const rs = svc._cleanReadings(svc._parseLegacyXml(xml));
    assert.equal(rs.length, 2);
    assert.equal(svc._buildNivel(rs, 'x').nivel.metros, 1.76);
});

test('histórico: estrutura esperada pelo front-end', async () => {
    const { svc } = criar({ hw: serie({ horas: 72, taxaH: 0.01 }) });
    const h = await svc.getHistoricoRioAcre(30);
    assert.ok(h.leituras24h.length <= 25 && h.pontos.length >= 3);
    for (const k of ['estatisticas', 'estatisticas24h', 'cotasReferencia', 'frescor', 'fonte']) assert.ok(k in h, k);
    for (const k of ['data', 'diaSemana', 'nivel', 'min', 'max', 'variacaoDia', 'status', 'isHoje']) assert.ok(k in h.pontos[0], k);
});

test('previsão: alta gera "Elevação"; sem % de risco nem afirmações sobre montante', async () => {
    const { svc } = criar({ hw: serie({ taxaH: 0.02 }) });
    const p = await svc.getPrevisaoRioAcre();
    assert.equal(p.disponivel, true);
    assert.equal(p.direcaoPrevisao, 'Elevação');
    assert.ok(p.projecoes['24h'].nivel > p.nivelAtual);
    const txt = (p.riscoInundacao + p.diagnostico + p.aviso).toLowerCase();
    assert.ok(!p.riscoInundacao.includes('%'));
    assert.ok(!txt.includes('probabilidade') && !txt.includes('nula'));
    assert.ok(txt.includes('199'));
});

test('previsão indisponível com dado velho ou escasso', async () => {
    let p = await criar({ hw: serie({ idadeMin: 360 }) }).svc.getPrevisaoRioAcre();
    assert.equal(p.disponivel, false);
    p = await criar({ hw: serie({ horas: 2 }) }).svc.getPrevisaoRioAcre();
    assert.equal(p.disponivel, false);
});
