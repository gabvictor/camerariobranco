const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const FONT = "'DejaVu Sans','Liberation Sans',Arial,sans-serif";
const W = 832; // 2x do que aparece no e-mail (416 px), para ficar nítido em telas de alta densidade
const H = 440;
const PAD = { l: 62, r: 160, t: 28, b: 62 }; // a margem direita guarda os rótulos das cotas
const INSET = 38;                             // folga nas pontas para a barra do primeiro e do último dia caber
const COLORS = { grid: '#e5e7eb', axis: '#6b7280', range: '#bfdbfe', line: '#2563eb', dot: '#1d4ed8', text: '#111827' };
const COTA_COLORS = { atencao: '#d97706', alerta: '#ea580c', transbordamento: '#dc2626' };

const esc = (v) => String(v ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]));
const fmt = (n, d = 2) => Number(n).toFixed(d).replace('.', ',');

/**
 * RiverChartService — desenha o gráfico dos últimos dias do Rio Acre para o e-mail de alerta.
 *
 * O e-mail não aceita script nem SVG, então o gráfico vira um PNG guardado na mesma pasta das fotos
 * (a rotina de limpeza de `CameraSnapshotService` apaga arquivos `rio-*.png` antigos).
 * Usa os pontos DIÁRIOS do histórico: média do dia (linha) e variação entre mínima e máxima (barra).
 */
class RiverChartService {
    /**
     * @param {object} deps
     * @param {{ getHistoricoRioAcre: Function }} deps.rioService
     * @param {string} deps.baseUrl  endereço público do site
     * @param {string} deps.dir      pasta servida em /uploads/alertas
     */
    constructor({ rioService, baseUrl, dir, days = 7, now, fsp }) {
        this._rio = rioService;
        this._baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this._dir = dir;
        this._days = days;
        this._now = now || (() => Date.now());
        this._fs = fsp || fs.promises;
    }

    /** Resumo em palavras (vai no e-mail em texto simples e no texto alternativo da imagem). */
    static summarize(pontos) {
        if (!pontos || pontos.length < 2) return null;
        const first = pontos[0];
        const last = pontos[pontos.length - 1];
        const max = pontos.reduce((a, p) => (p.max > a.max ? p : a));
        const min = pontos.reduce((a, p) => (p.min < a.min ? p : a));
        const delta = Math.round((last.nivel - first.nivel) * 100) / 100;
        const direcao = delta > 0.05 ? 'subiu' : delta < -0.05 ? 'desceu' : 'ficou estável';
        const variacao = direcao === 'ficou estável' ? '' : ` ${fmt(Math.abs(delta))} m`;
        return {
            dias: pontos.length,
            direcao,
            texto: `Nos últimos ${pontos.length} dias o rio ${direcao}${variacao} (média diária de ${fmt(first.nivel)} m em ${first.data} para ${fmt(last.nivel)} m em ${last.data}). `
                + `Maior nível: ${fmt(max.max)} m em ${max.data}. Menor: ${fmt(min.min)} m em ${min.data}.`
        };
    }

    /** Monta o SVG. Separado do PNG para facilitar o teste. */
    static buildSvg(pontos, cotas = {}) {
        const plotW = W - PAD.l - PAD.r;
        const plotH = H - PAD.t - PAD.b;
        const lows = pontos.map((p) => p.min);
        const highs = pontos.map((p) => p.max);
        let lo = Math.min(...lows);
        let hi = Math.max(...highs);

        // Mostra a cota mais próxima acima do nível (se estiver perto), para dar noção de quanto falta.
        const linhasCota = Object.entries({ atencao: cotas.atencao, alerta: cotas.alerta, transbordamento: cotas.transbordamento })
            .filter(([, v]) => Number.isFinite(v));
        const acima = linhasCota.filter(([, v]) => v >= hi).sort((a, b) => a[1] - b[1])[0];
        const mostradas = linhasCota.filter(([, v]) => v <= hi || (acima && v === acima[1] && v - hi <= 3));
        for (const [, v] of mostradas) hi = Math.max(hi, v);

        const span = Math.max(hi - lo, 0.6);
        lo = Math.max(0, lo - span * 0.12);
        hi = hi + span * 0.12;
        const range = hi - lo;
        const step = range <= 1.5 ? 0.25 : range <= 3 ? 0.5 : range <= 8 ? 1 : 2;
        const y = (v) => PAD.t + plotH - ((v - lo) / range) * plotH;
        const x = (i) => PAD.l + INSET + (pontos.length === 1 ? (plotW - 2 * INSET) / 2 : ((plotW - 2 * INSET) * i) / (pontos.length - 1));

        const parts = [];
        parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

        for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
            parts.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${COLORS.grid}" stroke-width="1"/>`);
            parts.push(`<text x="${PAD.l - 10}" y="${(y(v) + 5).toFixed(1)}" font-family="${FONT}" font-size="15" fill="${COLORS.axis}" text-anchor="end">${fmt(v, step < 1 ? 2 : 1)}</text>`);
        }
        parts.push(`<text x="14" y="${(PAD.t + plotH / 2).toFixed(1)}" font-family="${FONT}" font-size="14" fill="${COLORS.axis}" text-anchor="middle" transform="rotate(-90 14 ${(PAD.t + plotH / 2).toFixed(1)})">metros</text>`);

        for (const [id, v] of mostradas) {
            const c = COTA_COLORS[id];
            const label = id === 'atencao' ? 'atenção' : id === 'alerta' ? 'alerta' : 'transbordo';
            parts.push(`<line x1="${PAD.l}" x2="${W - PAD.r + 8}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${c}" stroke-width="2" stroke-dasharray="8 6"/>`);
            parts.push(`<text x="${W - PAD.r + 14}" y="${(y(v) + 5).toFixed(1)}" font-family="${FONT}" font-size="14" font-weight="bold" fill="${c}">${label} ${fmt(v, 1)}</text>`);
        }

        const barW = Math.min(36, (plotW / pontos.length) * 0.5);
        pontos.forEach((p, i) => {
            const top = y(p.max);
            const height = Math.max(4, y(p.min) - top);
            parts.push(`<rect x="${(x(i) - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="6" fill="${COLORS.range}"/>`);
        });

        const path = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.nivel).toFixed(1)}`).join(' ');
        parts.push(`<path d="${path}" fill="none" stroke="${COLORS.line}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`);

        pontos.forEach((p, i) => {
            const ultimo = i === pontos.length - 1;
            parts.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(p.nivel).toFixed(1)}" r="${ultimo ? 8 : 5}" fill="${ultimo ? COLORS.dot : '#ffffff'}" stroke="${COLORS.dot}" stroke-width="3"/>`);
            if (ultimo) {
                const anchor = 'middle';
                parts.push(`<text x="${x(i).toFixed(1)}" y="${(Math.min(y(p.nivel), y(p.max)) - 16).toFixed(1)}" font-family="${FONT}" font-size="17" font-weight="bold" fill="${COLORS.text}" text-anchor="${anchor}">${fmt(p.nivel)} m</text>`);
            }
            const dia = esc(p.diaSemana || '');
            parts.push(`<text x="${x(i).toFixed(1)}" y="${H - PAD.b + 24}" font-family="${FONT}" font-size="15" font-weight="${p.isHoje ? 'bold' : 'normal'}" fill="${p.isHoje ? COLORS.text : COLORS.axis}" text-anchor="middle">${dia}</text>`);
            parts.push(`<text x="${x(i).toFixed(1)}" y="${H - PAD.b + 44}" font-family="${FONT}" font-size="13" fill="${COLORS.axis}" text-anchor="middle">${esc(p.data)}</text>`);
        });

        return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
    }

    /**
     * @returns {Promise<null | { url: string, file: string, resumo: string, dias: number }>}
     *   null quando não há dados suficientes: o e-mail sai sem gráfico, nunca com um gráfico inventado.
     */
    async render(tag = 'alerta') {
        let historico;
        try {
            historico = await this._rio.getHistoricoRioAcre(this._days);
        } catch (_) {
            return null;
        }
        const pontos = ((historico && historico.pontos) || []).slice(-this._days)
            .filter((p) => Number.isFinite(p.nivel) && Number.isFinite(p.min) && Number.isFinite(p.max));
        const resumo = RiverChartService.summarize(pontos);
        if (!resumo) return null;

        const svg = RiverChartService.buildSvg(pontos, historico.cotasReferencia || {});
        const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

        const stamp = new Date(this._now()).toISOString().replace(/[-:T]/g, '').slice(0, 12);
        const safeTag = String(tag).replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'alerta';
        const file = `rio-grafico-${safeTag}-${stamp}-${crypto.randomBytes(4).toString('hex')}.png`;
        await this._fs.mkdir(this._dir, { recursive: true });
        await this._fs.writeFile(path.join(this._dir, file), png);
        return { url: `${this._baseUrl}/uploads/alertas/${file}`, file, resumo: resumo.texto, dias: resumo.dias };
    }
}

module.exports = RiverChartService;
