const path = require('path');
const { execFile } = require('child_process');
const axios = require('axios');
const HidroWebService = require('./HidroWebService');
const { formatRioBrancoDateTime, getRioBrancoDateStr } = require('../../utils/dateUtils');

/**
 * Configuração da estação telemétrica de Rio Branco (ANA / SGB-CPRM).
 */
const RIO_ACRE_STATION = {
    codigo: '13600002',
    estcodigo: '95967480',
    nome: 'Rio Branco - Ponte Metálica',
    rio: 'Rio Acre',
    municipio: 'Rio Branco',
    estado: 'AC',
    responsavel: 'ANA',
    operadora: 'SGB-CPRM'
};

// Valores de REFERÊNCIA (não alimentam a estimativa de tendência). Mesmas fontes/avisos do rio_service.py:
// cheia recorde 18,40 m em 04/03/2015 (Portal Amazônia); seca 1,23 m em 21/09/2024 (conferir com o SGB);
// médias mensais aproximadas, sem fonte oficial citada.
const RECORDE_CHEIA = { nivel: 18.40, data: '04/03/2015' };
const RECORDE_SECA = { nivel: 1.23, data: '21/09/2024' };
const CLIMATOLOGIA = {
    1: [9.50, 'Início da Cheia'], 2: [11.80, 'Pico de Cheias'], 3: [12.20, 'Pico de Cheias'],
    4: [9.80, 'Início da Descida'], 5: [6.50, 'Transição p/ Seca'], 6: [3.80, 'Estiagem'],
    7: [2.50, 'Seca Típica'], 8: [1.80, 'Seca Severa'], 9: [1.60, 'Mínima do Ano'],
    10: [1.95, 'Transição p/ Chuvas'], 11: [4.20, 'Elevação das Águas'], 12: [7.10, 'Inverno Amazônico']
};
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const RB_OFFSET_MS = 5 * 3600 * 1000; // Acre = UTC-5 o ano todo
const AMORTECIMENTO = { 24: 0.8, 48: 0.6, 168: 0.3 }; // empíricos, sem calibração estatística

/** Nenhuma fonte respondeu e não há cache: não existe leitura real para mostrar. */
class DadosIndisponiveisError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DadosIndisponiveisError';
    }
}

const toNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? n : null;
};
const fmt = (n, d = 2) => Number(n).toFixed(d).replace('.', ',');

/**
 * @service RioAcreService
 * Telemetria do Rio Acre. Ordem das fontes: HidroWebService (com qualidade) → WebService legado XML →
 * cache antigo (sempre marcado como desatualizado) → erro DadosIndisponiveisError.
 * NUNCA inventa leitura.
 */
class RioAcreService {
    constructor(options = {}) {
        this.station = RIO_ACRE_STATION;
        this.stationCode = this.station.codigo;
        this.estCodigo = this.station.estcodigo;
        this.cotaAtencao = 12.50;       // m (relatório SAH/SGB)
        this.cotaAlerta = 13.50;        // m
        this.cotaTransbordamento = 14.00; // m
        this.cotaSecaHistorica = RECORDE_SECA.nivel;

        this.hidroWebService = options.hidroWebService || new HidroWebService();
        this.enableLegacyFallback = process.env.HIDROWEB_LEGACY_FALLBACK !== 'false';
        // O motor Python deixou de ser o caminho principal: agora é opt-in (RIO_PYTHON_ENGINE=true).
        this.enablePythonEngine = process.env.RIO_PYTHON_ENGINE === 'true';

        // Fuso em que a ANA publica as datas sem indicação de fuso (padrão: hora local de Rio Branco).
        const off = process.env.ANA_DATA_UTC_OFFSET;
        this.dataUtcOffset = /^[+-]\d{2}:\d{2}$/.test(off || '') ? off : '-05:00';
        this.staleMinutes = Number(process.env.RIO_STALE_MINUTES) || 120;

        this._cache = null;
        this._lastFetchTime = 0;
        this._cacheTtlMs = 10 * 60 * 1000;
        this._cacheTtlFallbackMs = 60 * 1000;
        this._cacheTtlCurrentMs = this._cacheTtlMs;

        this._historicoCache = {};
        this._previsaoCache = null;
        this._lastPrevisaoFetchTime = 0;
    }

    // ─── Motor Python (opcional) ────────────────────────────────────────────────────
    _fetchFromPython(action = 'nivel', dias = 30) {
        return new Promise((resolve, reject) => {
            const scriptPath = path.resolve(process.cwd(), 'rio_service.py');
            const args = [scriptPath, '--action', action, '--dias', String(dias)];
            const pythonBin = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
            execFile(pythonBin, args, { timeout: 25000 }, (error, stdout, stderr) => {
                if (error) return reject(new Error(`Erro Python: ${error.message} ${stdout || stderr || ''}`.trim()));
                try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error('Saída do Python não é JSON válido')); }
            });
        });
    }

    getLastCachedNivel() {
        return this._cache ? this._comFrescor(this._cache, false) : null;
    }

    // ─── Frescor ────────────────────────────────────────────────────────────────────
    _comFrescor(data, falhaAoAtualizar) {
        const ts = data?.nivel?.timestamp ?? data?.ultimaLeituraTimestamp ?? null;
        let idade = ts ? (Date.now() - ts) / 60000 : Infinity;
        const fusoSuspeito = idade < -5; // leitura "no futuro" → fuso da ANA provavelmente errado
        idade = Math.max(idade, 0);
        const desatualizado = Boolean(falhaAoAtualizar || idade > this.staleMinutes);
        const humano = (min) => {
            min = Math.round(min);
            if (!Number.isFinite(min)) return 'tempo indeterminado';
            if (min < 60) return `${min} min`;
            const h = Math.floor(min / 60);
            if (h < 48) return min % 60 ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${h} h`;
            return `${Math.floor(h / 24)} dias`;
        };
        const mensagem = fusoSuspeito
            ? 'A data da leitura está no futuro; confira ANA_DATA_UTC_OFFSET.'
            : desatualizado
                ? `Última leitura há ${humano(idade)}. A estação ou a conexão com a ANA pode estar com problema; não trate este valor como atual.`
                : `Leitura há ${humano(idade)}.`;
        return {
            ...data,
            estado: desatualizado ? 'desatualizado' : 'ok',
            frescor: {
                idadeMinutos: Number.isFinite(idade) ? Math.round(idade) : null,
                desatualizado,
                limiteMinutos: this.staleMinutes,
                falhaAoAtualizar: Boolean(falhaAoAtualizar),
                fusoSuspeito,
                mensagem
            }
        };
    }

    // ─── Nível atual ────────────────────────────────────────────────────────────────
    _fontes(action, dias) {
        const fontes = [];
        if (this.enablePythonEngine) fontes.push(['Python', () => this._fetchFromPython(action, dias)]);
        if (this.hidroWebService.authService.hasCredentials()) {
            fontes.push(['HidroWebService', () => this._readingsFromHidroWeb(dias)]);
        }
        if (this.enableLegacyFallback) fontes.push(['WebService Legado', () => this._readingsFromLegacy(dias)]);
        return fontes;
    }

    async getNivelRioAcre() {
        const now = Date.now();
        if (this._cache && now - this._lastFetchTime < this._cacheTtlCurrentMs) {
            return this._comFrescor(this._cache, false);
        }
        const erros = [];
        const fontes = this._fontes('nivel', 2);
        for (const [idx, [nome, buscar]] of fontes.entries()) {
            try {
                const r = await buscar();
                const data = Array.isArray(r.readings) ? this._buildNivel(r.readings, r.fonte) : r; // r = JSON do Python
                if (data && data.nivel) {
                    this._cache = data;
                    this._lastFetchTime = now;
                    // Dado vindo de fonte reserva (ex.: legado, sem qualidade) vale pouco: tenta a principal de novo logo.
                    this._cacheTtlCurrentMs = idx === 0 ? this._cacheTtlMs : this._cacheTtlFallbackMs;
                    return this._comFrescor(data, false);
                }
                throw new Error('sem leitura válida');
            } catch (err) {
                erros.push(`${nome}: ${err.message}`);
                console.warn(`[RioAcreService] Falha em ${nome}:`, err.message);
            }
        }
        if (this._cache) return this._comFrescor(this._cache, true); // dado real, porém velho
        throw new DadosIndisponiveisError(erros.join('; ') || 'nenhuma fonte configurada');
    }

    // ─── Histórico ──────────────────────────────────────────────────────────────────
    async getHistoricoRioAcre(dias = 30) {
        const diasParam = Math.max(1, Math.min(365, Number(dias) || 30));
        const now = Date.now();
        const cached = this._historicoCache[diasParam];
        if (cached && now - cached.at < 30 * 60 * 1000) return this._comFrescor(cached.data, false);

        const erros = [];
        for (const [nome, buscar] of this._fontes('historico', diasParam)) {
            try {
                const r = await buscar();
                const data = Array.isArray(r.readings)
                    ? this._aggregateHistoricalReadings(r.readings, diasParam, r.fonte)
                    : r;
                if (data && data.pontos && data.pontos.length) {
                    this._historicoCache[diasParam] = { at: now, data };
                    return this._comFrescor(data, false);
                }
                throw new Error('sem pontos válidos');
            } catch (err) {
                erros.push(`${nome}: ${err.message}`);
                console.warn(`[RioAcreService] Histórico — falha em ${nome}:`, err.message);
            }
        }
        if (cached) return this._comFrescor(cached.data, true);
        throw new DadosIndisponiveisError(erros.join('; ') || 'nenhuma fonte configurada');
    }

    // ─── Estimativa de tendência (NÃO é previsão oficial) ───────────────────────────
    async getPrevisaoRioAcre() {
        const now = Date.now();
        if (this._previsaoCache && now - this._lastPrevisaoFetchTime < 5 * 60 * 1000) return this._previsaoCache;

        if (this.enablePythonEngine) {
            try {
                const py = await this._fetchFromPython('previsao');
                if (py && py.tipo === 'estimativa-de-tendencia') {
                    this._previsaoCache = py;
                    this._lastPrevisaoFetchTime = now;
                    return py;
                }
            } catch (err) {
                console.warn('[RioAcreService] Previsão via Python falhou:', err.message);
            }
        }

        const nivel = await this.getNivelRioAcre(); // lança DadosIndisponiveisError se não há dado real
        let hist = null;
        try { hist = await this.getHistoricoRioAcre(2); } catch (_) { /* segue sem histórico */ }
        const result = this._calcularPrevisao(nivel, hist);
        this._previsaoCache = result;
        this._lastPrevisaoFetchTime = now;
        return result;
    }

    _situacao(n) {
        if (n >= this.cotaTransbordamento) return { riscoInundacao: 'Acima da cota de transbordamento (14,00 m)', statusRisco: 'Transbordamento', corRisco: 'red' };
        if (n >= this.cotaAlerta) return { riscoInundacao: 'Acima da cota de alerta (13,50 m)', statusRisco: 'Alerta', corRisco: 'orange' };
        if (n >= this.cotaAtencao) return { riscoInundacao: 'Acima da cota de atenção (12,50 m)', statusRisco: 'Atenção', corRisco: 'amber' };
        return { riscoInundacao: `${fmt(this.cotaAlerta - n)} m abaixo da cota de alerta`, statusRisco: 'Abaixo das cotas de atenção', corRisco: 'emerald' };
    }

    _calcularPrevisao(nivelData, hist) {
        const nivelAtual = nivelData.nivel.metros;
        const rb = new Date(Date.now() - RB_OFFSET_MS);
        const mes = rb.getUTCMonth() + 1;
        const [mediaMes, tipoMes] = CLIMATOLOGIA[mes];
        const diffMedia = Number((nivelAtual - mediaMes).toFixed(2));
        const frescor = nivelData.frescor;

        const base = {
            tipo: 'estimativa-de-tendencia',
            estado: nivelData.estado,
            timestamp: Date.now(),
            dataReferencia: nivelData.nivel.dataLeitura,
            mesReferencia: MESES[mes - 1],
            nivelAtual,
            frescor,
            aviso: 'Extrapolação simples da tendência das últimas 24 h. Não considera chuva prevista nem o nível a montante e NÃO substitui os alertas do SGB/CPRM e da Defesa Civil (199).',
            comparativoHistorico: {
                mediaMes,
                diferencaMedia: `${diffMedia > 0 ? '+' : ''}${diffMedia.toFixed(2).replace('.', ',')} m`,
                recordeCheia: RECORDE_CHEIA,
                recordeSeca: RECORDE_SECA,
                aviso: 'Médias mensais aproximadas, sem fonte oficial citada: use apenas como referência.'
            },
            climatologiaAnual: MESES.map((nome, i) => ({ mes: nome.slice(0, 3), nome, media: CLIMATOLOGIA[i + 1][0], tipo: CLIMATOLOGIA[i + 1][1] })),
            ...this._situacao(nivelAtual)
        };

        const pts = (hist?.leituras24h || []).filter((p) => typeof p.timestamp === 'number');
        const spanH = pts.length > 1 ? (pts[pts.length - 1].timestamp - pts[0].timestamp) / 3600000 : 0;
        if (frescor.desatualizado || pts.length < 6 || spanH < 5) {
            const motivo = frescor.desatualizado ? 'a última leitura está desatualizada' : 'há poucas leituras recentes para estimar a tendência';
            return {
                ...base,
                disponivel: false,
                motivo,
                direcaoPrevisao: 'Indisponível', iconeDirecao: 'minus', corDirecao: 'slate',
                projecoes: {},
                diagnostico: `Estimativa indisponível: ${motivo}. Cota atual: ${fmt(nivelAtual)} m.`
            };
        }

        // Regressão linear (mínimos quadrados) sobre as médias horárias das últimas 24 h.
        const t0 = pts[0].timestamp;
        const xs = pts.map((p) => (p.timestamp - t0) / 3600000);
        const ys = pts.map((p) => p.nivel);
        const n = pts.length;
        const mx = xs.reduce((a, b) => a + b, 0) / n;
        const my = ys.reduce((a, b) => a + b, 0) / n;
        const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
        const slope = sxx ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx : 0; // m/h
        const std = Math.sqrt(xs.reduce((a, x, i) => a + (ys[i] - (my + slope * (x - mx))) ** 2, 0) / Math.max(n - 2, 1));

        const projetar = (horas) => {
            const delta = Number((slope * horas * AMORTECIMENTO[horas]).toFixed(2));
            const alvo = Number(Math.max(0, nivelAtual + delta).toFixed(2));
            const faixa = Math.max(0.04, 2 * std) * Math.sqrt(horas / 24);
            return {
                nivel: alvo,
                delta: `${delta > 0 ? '+' : ''}${delta.toFixed(2).replace('.', ',')} m`,
                min: Number(Math.max(0, alvo - faixa).toFixed(2)),
                max: Number((alvo + faixa).toFixed(2)),
                tendencia: delta > 0.03 ? 'Elevação' : delta < -0.03 ? 'Queda' : 'Estabilidade'
            };
        };
        const p24 = projetar(24), p48 = projetar(48), p7d = projetar(168);
        p7d.tendencia += ' (baixa confiança)';
        const [icone, cor] = ({ 'Elevação': ['trending-up', 'amber'], 'Queda': ['trending-down', 'blue'] })[p24.tendencia] || ['minus', 'emerald'];
        const delta24 = Number((nivelAtual - ys[0]).toFixed(2));

        return {
            ...base,
            disponivel: true,
            direcaoPrevisao: p24.tendencia, iconeDirecao: icone, corDirecao: cor,
            projecoes: { '24h': p24, '48h': p48, '7d': p7d },
            diagnostico: `Cota atual de ${fmt(nivelAtual)} m, ${fmt(Math.abs(diffMedia))} m ${diffMedia > 0 ? 'acima' : 'abaixo'} da média de referência de ${MESES[mes - 1]} (${fmt(mediaMes)} m, período de ${tipoMes.toLowerCase()}). Variação medida nas últimas 24 h: ${delta24 > 0 ? '+' : ''}${fmt(delta24)} m. As projeções acima são extrapolação dessa tendência e perdem confiança com o tempo; para alertas oficiais consulte o SGB/CPRM e a Defesa Civil (199).`
        };
    }

    // ─── Fontes de dados ────────────────────────────────────────────────────────────
    async _readingsFromHidroWeb(dias) {
        const range = dias <= 2 ? 'DIAS_2' : dias <= 7 ? 'DIAS_7' : dias <= 14 ? 'DIAS_14' : dias <= 21 ? 'DIAS_21' : 'DIAS_30';
        const items = await this.hidroWebService.consultarSerieTelemetricaAdotada({
            codigosEstacoes: this.station.codigo, tipoFiltroData: 'DATA_LEITURA', rangeIntervalo: range
        });
        const readings = this._cleanReadings(this._parseHidroWebReadings(items || []));
        if (!readings.length) throw new Error('nenhuma leitura com cota válida');
        return { readings, fonte: 'HidroWebService (ANA)' };
    }

    async _readingsFromLegacy(dias) {
        const hoje = Date.now();
        const dp = (ms) => {
            const [y, m, d] = getRioBrancoDateStr(ms).split('-');
            return `${d}/${m}/${y}`;
        };
        const query = `?codEstacao=${this.station.codigo}&dataInicio=${dp(hoje - dias * 86400000)}&dataFim=${dp(hoje)}`;
        const bases = (process.env.ANA_LEGACY_URLS || 'https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos,http://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos')
            .split(',').map((u) => u.trim()).filter(Boolean);
        let ultimoErro = null;
        for (const base of bases) {
            try {
                const resp = await axios.get(base + query, {
                    timeout: dias > 2 ? 25000 : 12000,
                    headers: { 'User-Agent': 'CamRB-RioBranco-Monitoring/3.0', Accept: 'application/xml, text/xml, */*' }
                });
                const xml = String(resp.data || '');
                if (xml.includes('<ErrorTable>')) throw new Error('WebService legado retornou ErrorTable');
                const readings = this._cleanReadings(this._parseLegacyXml(xml));
                if (!readings.length) throw new Error('XML legado sem leituras válidas');
                return { readings, fonte: 'WebService Legado (ANA)' };
            } catch (err) {
                ultimoErro = err;
            }
        }
        throw ultimoErro || new Error('sem URL legada configurada');
    }

    _parseLegacyXml(xml) {
        const readings = [];
        for (const b of xml.matchAll(/<DadosHidrometereologicos[^>]*>([\s\S]*?)<\/DadosHidrometereologicos>/g)) {
            const tag = (name) => (b[1].match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i')) || [])[1];
            const r = this._makeReading({
                dataStr: tag('DataHora'), rawCota: tag('Nivel') || tag('Cota'),
                rawVazao: tag('Vazao'), rawChuva: tag('Chuva')
            });
            if (r) readings.push(r);
        }
        return readings;
    }

    _parseHidroWebReadings(items) {
        const readings = [];
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const pick = (...keys) => { for (const k of keys) if (item[k] !== undefined && item[k] !== null) return item[k]; return undefined; };
            const r = this._makeReading({
                dataStr: pick('Data_Hora_Medicao', 'DataHoraMedicao', 'Data_Hora', 'DataHora', 'Data_Leitura', 'DataHoraLeitura', 'Data_Medicao', 'data_hora_medicao', 'data_hora'),
                rawCota: pick('Cota_Adotada', 'Cota', 'Nivel', 'Nivel_Adotado', 'Cota_Bruta', 'Nivel_Bruto', 'cota_adotada', 'cota'),
                rawChuva: pick('Chuva_Adotada', 'Chuva', 'Chuva_Bruta', 'chuva_adotada', 'chuva'),
                rawVazao: pick('Vazao_Adotada', 'Vazao', 'Vazao_Bruta', 'vazao_adotada', 'vazao'),
                statusCota: pick('Cota_Adotada_Status', 'Status_Cota', 'Qualidade_Cota', 'StatusCota', 'cota_adotada_status'),
                statusChuva: pick('Chuva_Adotada_Status', 'Status_Chuva', 'Qualidade_Chuva', 'StatusChuva', 'chuva_adotada_status'),
                statusVazao: pick('Vazao_Adotada_Status', 'Status_Vazao', 'Qualidade_Vazao', 'StatusVazao', 'vazao_adotada_status'),
                atualizacaoStr: pick('Data_Atualizacao', 'Data_Hora_Atualizacao', 'DataUltimaAtualizacao', 'data_hora_atualizacao', 'data_atualizacao')
            });
            if (r) readings.push(r);
        }
        return readings;
    }

    _makeReading({ dataStr, rawCota, rawVazao, rawChuva, statusCota, statusChuva, statusVazao, atualizacaoStr }) {
        const nivel = toNum(rawCota);
        const dateObj = this._parseDateToLocal(dataStr);
        if (nivel === null || nivel <= 0 || !dateObj) return null;
        const nivelM = nivel > 30 ? nivel / 100 : nivel; // alguns registros vêm em cm
        const upd = atualizacaoStr ? this._parseDateToLocal(atualizacaoStr) : null;
        return {
            timestamp: dateObj.getTime(),
            dateObj,
            dayKey: getRioBrancoDateStr(dateObj),
            nivelM: Number(nivelM.toFixed(2)),
            nivelCm: Math.round(nivelM * 100),
            dataLeituraFormatada: formatRioBrancoDateTime(dateObj, { second: undefined }),
            dataAtualizacaoFormatada: upd ? formatRioBrancoDateTime(upd, { second: undefined }) : null,
            vazao: toNum(rawVazao),
            chuva: toNum(rawChuva),
            qualidadeCota: this.hidroWebService.normalizeQuality(statusCota),
            qualidadeChuva: this.hidroWebService.normalizeQuality(statusChuva),
            qualidadeVazao: this.hidroWebService.normalizeQuality(statusVazao)
        };
    }

    /** Ordena (mais antiga → mais recente), remove duplicatas e descarta leituras de qualidade RUIM. */
    _cleanReadings(readings) {
        const byTs = new Map();
        for (const r of readings) {
            if (r.qualidadeCota?.status === 'RUIM') continue;
            byTs.set(r.timestamp, r);
        }
        return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
    }

    /** Interpreta datas da ANA; sem fuso explícito usa ANA_DATA_UTC_OFFSET (padrão -05:00). */
    _parseDateToLocal(dateStr) {
        if (!dateStr) return null;
        const str = String(dateStr).trim().replace(/(\d{2}:\d{2}:\d{2})\.\d+/, '$1');
        const off = this.dataUtcOffset;
        let iso = null;
        if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?$/.test(str)) {
            iso = str.replace(' ', 'T');
            if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += (iso.length === 16 ? ':00' : '') + off;
        } else if (/^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2}(:\d{2})?)?$/.test(str)) {
            const [dp, tp = '00:00:00'] = str.split(' ');
            const [d, m, y] = dp.split('/');
            iso = `${y}-${m}-${d}T${tp.length === 5 ? tp + ':00' : tp}${off}`;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            iso = `${str}T00:00:00${off}`;
        }
        if (!iso) return null;
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    // ─── Montagem das respostas ─────────────────────────────────────────────────────
    _buildNivel(readings, fonte) {
        const latest = readings[readings.length - 1];
        // Tendência: compara com a leitura mais próxima de 1 h antes (exige ≥ 30 min de histórico).
        let ref = null;
        for (let i = readings.length - 1; i >= 0; i--) {
            if (readings[i].timestamp <= latest.timestamp - 3600000) { ref = readings[i]; break; }
        }
        if (!ref && latest.timestamp - readings[0].timestamp >= 1800000) ref = readings[0];
        let tendencia = 'Estável', tendenciaIcon = 'minus', tendenciaSinal = '=';
        if (ref) {
            const diff = latest.nivelM - ref.nivelM;
            if (diff >= 0.02) { tendencia = 'Subindo'; tendenciaIcon = 'trending-up'; tendenciaSinal = '+'; }
            else if (diff <= -0.02) { tendencia = 'Descendo'; tendenciaIcon = 'trending-down'; tendenciaSinal = '-'; }
        }
        return this._formatRioData({
            nivelM: latest.nivelM, nivelCm: latest.nivelCm,
            dataLeitura: latest.dataLeituraFormatada, dataAtualizacao: latest.dataAtualizacaoFormatada,
            leituraTimestamp: latest.timestamp,
            vazao: latest.vazao, chuva: latest.chuva,
            qualidadeCota: latest.qualidadeCota, qualidadeChuva: latest.qualidadeChuva, qualidadeVazao: latest.qualidadeVazao,
            tendencia, tendenciaIcon, tendenciaSinal, fonte
        });
    }

    _formatRioData({ nivelM, nivelCm, dataLeitura, dataAtualizacao = null, leituraTimestamp = null, vazao = null, chuva = null,
        qualidadeCota = null, qualidadeChuva = null, qualidadeVazao = null,
        tendencia = 'Estável', tendenciaIcon = 'minus', tendenciaSinal = '=', fonte = 'HidroWebService (ANA)' }) {
        return {
            estacao: { ...this.station },
            nivel: {
                metros: Number(nivelM.toFixed(2)),
                centimetros: Math.round(nivelCm),
                formatado: `${fmt(nivelM)} m`,
                dataLeitura,
                timestamp: leituraTimestamp,
                dataAtualizacao,
                qualidade: qualidadeCota
            },
            vazao: vazao !== null && vazao !== undefined ? `${fmt(vazao, 1)} m³/s` : null,
            vazaoQualidade: qualidadeVazao,
            chuva: chuva !== null && chuva !== undefined ? `${fmt(chuva, 1)} mm` : null,
            chuvaQualidade: qualidadeChuva,
            chuvaReferencia: 'última leitura',
            tendencia: { status: tendencia, icon: tendenciaIcon, sinal: tendenciaSinal },
            cotas: {
                secaHistorica: `${fmt(this.cotaSecaHistorica)} m`,
                atencao: `${fmt(this.cotaAtencao)} m`,
                alerta: `${fmt(this.cotaAlerta)} m`,
                transbordamento: `${fmt(this.cotaTransbordamento)} m`,
                percentualAlerta: Math.min(Math.round((nivelM / this.cotaAlerta) * 100), 100)
            },
            status: this._calculateStatusInfo(nivelM),
            fonte,
            timestamp: Date.now()
        };
    }

    _aggregateHistoricalReadings(readings, dias = 30, fonte = 'HidroWebService (ANA)') {
        const latest = readings[readings.length - 1];
        const rbParts = (ts) => {
            const d = new Date(ts - RB_OFFSET_MS); // "relógio" de Rio Branco lido em UTC
            const p2 = (n) => String(n).padStart(2, '0');
            return { y: d.getUTCFullYear(), mo: p2(d.getUTCMonth() + 1), d: p2(d.getUTCDate()), h: p2(d.getUTCHours()) };
        };

        // 24 h: janela de 24 horas terminando na última leitura, agregada por hora.
        const janela = readings.filter((r) => r.timestamp > latest.timestamp - 24 * 3600000);
        const porHora = new Map();
        for (const r of janela) {
            const p = rbParts(r.timestamp);
            const k = `${p.y}-${p.mo}-${p.d} ${p.h}`;
            if (!porHora.has(k)) porHora.set(k, { vals: [], ts: Date.UTC(p.y, Number(p.mo) - 1, Number(p.d), Number(p.h)) + RB_OFFSET_MS });
            porHora.get(k).vals.push(r.nivelM);
        }
        const leituras24h = [...porHora.keys()].sort().map((k) => {
            const { vals, ts } = porHora.get(k);
            const [dia, h] = k.split(' ');
            const [y, mo, d] = dia.split('-');
            return {
                dataHora: `${d}/${mo} ${h}:00`, hora: `${h}:00`, dataCompleta: `${d}/${mo}/${y} às ${h}:00`,
                timestamp: ts,
                nivel: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)),
                min: Number(Math.min(...vals).toFixed(2)), max: Number(Math.max(...vals).toFixed(2))
            };
        });
        const niveis24 = janela.map((r) => r.nivelM);
        const ini24 = leituras24h[0].nivel, fim24 = leituras24h[leituras24h.length - 1].nivel;
        const var24 = Number((fim24 - ini24).toFixed(2));
        const estatisticas24h = {
            maiorNivel: { metros: Math.max(...niveis24) },
            menorNivel: { metros: Math.min(...niveis24) },
            mediaPeriodo: Number((leituras24h.reduce((a, l) => a + l.nivel, 0) / leituras24h.length).toFixed(2)),
            variacaoPeriodo: var24,
            variacaoPercentual: ini24 > 0 ? Number(((var24 / ini24) * 100).toFixed(1)) : 0
        };

        // Diário
        const porDia = new Map();
        for (const r of readings) {
            if (!porDia.has(r.dayKey)) porDia.set(r.dayKey, []);
            porDia.get(r.dayKey).push(r);
        }
        const hoje = getRioBrancoDateStr(new Date());
        const ontem = getRioBrancoDateStr(new Date(Date.now() - 86400000));
        const pontos = [];
        let anterior = null;
        for (const dia of [...porDia.keys()].sort().slice(-dias)) {
            const lista = porDia.get(dia);
            const vals = lista.map((x) => x.nivelM);
            const media = vals.reduce((a, b) => a + b, 0) / vals.length;
            const [y, m, d] = dia.split('-');
            const ref = new Date(`${y}-${m}-${d}T12:00:00-05:00`);
            const curto = ref.toLocaleDateString('pt-BR', { timeZone: 'America/Rio_Branco', weekday: 'short' });
            const variacaoDia = anterior !== null ? Number((media - anterior).toFixed(2)) : 0;
            pontos.push({
                data: `${d}/${m}`, dataCompleta: `${d}/${m}/${y}`,
                diaSemana: (curto.charAt(0).toUpperCase() + curto.slice(1)).replace('.', ''),
                diaSemanaCompleto: ref.toLocaleDateString('pt-BR', { timeZone: 'America/Rio_Branco', weekday: 'long' }),
                isHoje: dia === hoje, isOntem: dia === ontem,
                nivel: Number(media.toFixed(2)), min: Number(Math.min(...vals).toFixed(2)), max: Number(Math.max(...vals).toFixed(2)),
                variacaoDia,
                variacaoDiaPct: anterior ? Number(((variacaoDia / anterior) * 100).toFixed(1)) : 0,
                status: this._calculateStatusInfo(media), pontosLeitura: lista.length
            });
            anterior = media;
        }
        const maior = pontos.reduce((a, p) => (p.max > a.max ? p : a));
        const menor = pontos.reduce((a, p) => (p.min < a.min ? p : a));
        const inicial = pontos[0].nivel, final = pontos[pontos.length - 1].nivel;
        const varPeriodo = Number((final - inicial).toFixed(2));
        return {
            periodoDias: dias,
            diasDisponiveis: pontos.length,
            fonte,
            cotasReferencia: { secaHistorica: this.cotaSecaHistorica, atencao: this.cotaAtencao, alerta: this.cotaAlerta, transbordamento: this.cotaTransbordamento },
            estatisticas: {
                maiorNivel: { metros: maior.max, data: maior.dataCompleta },
                menorNivel: { metros: menor.min, data: menor.dataCompleta },
                mediaPeriodo: Number((pontos.reduce((a, p) => a + p.nivel, 0) / pontos.length).toFixed(2)),
                variacaoPeriodo: varPeriodo,
                variacaoPercentual: inicial > 0 ? Number(((varPeriodo / inicial) * 100).toFixed(1)) : 0
            },
            estatisticas24h,
            leituras24h,
            pontos,
            ultimaLeituraTimestamp: latest.timestamp,
            timestamp: Date.now()
        };
    }

    _calculateStatusInfo(n) {
        const mk = (tipo, color, bg, badge) => ({ tipo, color, statusBg: bg, badgeBg: badge });
        if (n >= this.cotaTransbordamento) return mk('Transbordamento', 'red', 'bg-red-600', 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800');
        if (n >= this.cotaAlerta) return mk('Alerta', 'amber', 'bg-amber-500', 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800');
        if (n < 1.50) return mk('Seca Severa', 'rose', 'bg-rose-600', 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800');
        if (n < 3.00) return mk('Nível Baixo / Estiagem', 'orange', 'bg-orange-500', 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800');
        return mk('Normal', 'emerald', 'bg-emerald-500', 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800');
    }
}

module.exports = RioAcreService;
module.exports.DadosIndisponiveisError = DadosIndisponiveisError;
