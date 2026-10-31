/**
 * UpstreamForecast — estima o nível de Rio Branco a partir do que já foi medido nas estações a montante.
 *
 * É a mesma lógica de `rio_service.py` (ver comentários lá). Funções puras, sem rede:
 *  - `horaria`: média por hora cheia;
 *  - `ajustar`: descobre o atraso e a inclinação entre a estação a montante e Rio Branco (últimos 30 dias);
 *  - `estimar`: projeta Rio Branco em N horas e mede o erro desse mesmo método no passado (retroteste).
 *
 * O nível previsto é: nível de Rio Branco agora + inclinação × (nível a montante daqui a N-atraso h − nível a
 * montante há `atraso` h). Só serve para horizontes N <= atraso, pois o que vale para depois ainda não aconteceu.
 */

const HOUR = 3600000;

// Estações telemétricas da ANA no Rio Acre, a montante de Rio Branco (códigos conferidos no inventário da HidroWeb
// em 31/10/2026). `atrasoRefH` é o tempo de viagem da onda até Rio Branco medido em 03-31/10/2026 (correlação 0,97
// em Capixaba e Xapuri); é só o ponto de partida: com dados variados o atraso é reajustado.
const ESTACOES_MONTANTE = [
    { codigo: '13568000', nome: 'Capixaba', atrasoRefH: 26 },
    { codigo: '13550000', nome: 'Xapuri', atrasoRefH: 62 },
    { codigo: '13445000', nome: 'Ponte Brasil-Peru', atrasoRefH: 122 }
];
const ATRASO_MIN_H = 6;
const ATRASO_MAX_H = 168;
const CORRELACAO_MIN = 0.8;     // abaixo disso a estação não explica o nível de Rio Branco: não é usada
const FRESCOR_MAX_H = 6;        // leitura de montante mais velha que isso é ignorada
const AMOSTRAS_MIN = 150;

const hourKey = (ts) => Math.floor(ts / HOUR) * HOUR;

/** Média por hora cheia: Map(início da hora em ms → nível). */
function horaria(readings) {
    const acc = new Map();
    for (const r of readings) {
        const k = hourKey(r.timestamp);
        const e = acc.get(k) || { soma: 0, n: 0 };
        e.soma += r.nivelM;
        e.n += 1;
        acc.set(k, e);
    }
    return new Map([...acc].map(([k, e]) => [k, e.soma / e.n]));
}

/** Nível na hora de `ts`, suavizado com as horas vizinhas. */
function em(horariaMap, ts) {
    const base = hourKey(ts);
    const vals = [base - HOUR, base, base + HOUR].filter((k) => horariaMap.has(k)).map((k) => horariaMap.get(k));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function correlacao(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
    }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

function ajustar(est, rbH, upH) {
    const valores = [...upH.values()];
    if (!valores.length) return null;
    const pares = (lag) => {
        const xs = [], ys = [];
        for (const [k, v] of upH) {
            const y = rbH.get(k + lag * HOUR);
            if (y !== undefined) { xs.push(v); ys.push(y); }
        }
        return [xs, ys];
    };
    const ref = est.atrasoRefH;
    const amplitude = Math.max(...valores) - Math.min(...valores);
    const variada = amplitude >= 0.5;       // sem variação não dá para medir atraso: fica o de referência
    let atraso = ref;
    let refinado = false;
    if (variada) {
        let melhor = null;
        for (let lag = Math.max(ATRASO_MIN_H, ref - 24); lag <= Math.min(ATRASO_MAX_H, ref + 24); lag++) {
            const [xs, ys] = pares(lag);
            if (xs.length >= AMOSTRAS_MIN) {
                const c = correlacao(xs, ys);
                if (!melhor || c > melhor.c) melhor = { c, lag };
            }
        }
        if (melhor && melhor.c >= 0.9) { atraso = melhor.lag; refinado = true; }
    }
    const [xs, ys] = pares(atraso);
    if (xs.length < AMOSTRAS_MIN) return null;
    const corr = correlacao(xs, ys);
    let inclinacao = 1;
    if (variada && corr >= 0.9) {
        const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
        const my = ys.reduce((a, b) => a + b, 0) / ys.length;
        const v = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
        const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
        inclinacao = v ? Math.min(1.5, Math.max(0.5, cov / v)) : 1;
    }
    return {
        atraso, inclinacao, correlacao: Number(corr.toFixed(3)),
        calibrada: Boolean(variada && refinado),
        usavel: !variada || corr >= CORRELACAO_MIN
    };
}

function estimar(aj, rbH, upH, agoraMs, horas) {
    if (aj.atraso < horas) return null;     // a onda ainda nem chegou à estação: não há o que ler
    const prever = (t0) => {
        const rb0 = em(rbH, t0);
        const alvoUp = em(upH, t0 + (horas - aj.atraso) * HOUR);
        const baseUp = em(upH, t0 - aj.atraso * HOUR);
        if (rb0 === null || alvoUp === null || baseUp === null) return null;
        return [rb0, rb0 + aj.inclinacao * (alvoUp - baseUp)];
    };

    // Retroteste: o mesmo método em cada hora do passado, comparado com o que de fato aconteceu.
    const ultimaRb = Math.max(...rbH.keys());
    const erros = [], errosPersist = [];
    for (const t0 of [...rbH.keys()].sort((a, b) => a - b)) {
        if (t0 + horas * HOUR > ultimaRb) continue;
        const real = em(rbH, t0 + horas * HOUR);
        const pr = prever(t0);
        if (real !== null && pr) {
            erros.push(pr[1] - real);
            errosPersist.push(pr[0] - real);
        }
    }
    if (erros.length < 48) return null;
    const rms = Math.sqrt(erros.reduce((a, e) => a + e * e, 0) / erros.length);
    const mae = erros.reduce((a, e) => a + Math.abs(e), 0) / erros.length;
    const maePersist = errosPersist.reduce((a, e) => a + Math.abs(e), 0) / errosPersist.length;

    const pr = prever(hourKey(agoraMs));
    if (!pr) return null;
    return { nivel: Math.max(0, pr[1]), rb0: pr[0], rms, mae, maePersistencia: maePersist, amostras: erros.length };
}

module.exports = { ESTACOES_MONTANTE, FRESCOR_MAX_H, HOUR, horaria, em, correlacao, ajustar, estimar };
