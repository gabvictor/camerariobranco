const { createHash } = require('crypto');
const { getRioBrancoDateStr } = require('../../utils/dateUtils');
const { sanitizeKey } = require('../../utils/originParser');

const BOT_REGEX = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|go-http|java\//i;

/** Interseção (em ms) entre [a, b] e uma lista de intervalos [inicio, fim|null]. */
const overlapMs = (a, b, intervals, now) => {
    let total = 0;
    for (const [start, end] of intervals) {
        const s = Math.max(a, start);
        const e = Math.min(b, end == null ? now : end);
        if (e > s) total += e - s;
    }
    return total;
};

/** Une intervalos sobrepostos (várias conexões ao mesmo tempo contam uma vez só). */
const mergeIntervals = (list) => {
    const sorted = [...list].sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [s, e] of sorted) {
        const last = out[out.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else out.push([s, e]);
    }
    return out;
};

/**
 * VisitorSessionService — perfil de cada visita: quanto tempo ficou, quais páginas e câmeras viu.
 *
 * Como mede (sem cookies novos e sem identificar ninguém por e-mail):
 *  - cada página aberta mantém uma conexão com o servidor (presença): o tempo dela é o tempo na página;
 *  - cada vídeo ao vivo é uma conexão por câmera: o tempo dela é o tempo assistindo aquela câmera;
 *  - a "sessão" é a aba (tabId): termina quando fica sem conexões por alguns minutos;
 *  - quando a aba fica em segundo plano o navegador avisa, e esse tempo NÃO é contado.
 *
 * Gravação: o resumo diário (contadores) é gravado em lote a cada poucos minutos; o perfil detalhado só
 * de sessões relevantes (com algum tempo, câmera ou login), com limite por dia, e apagado após a retenção.
 */
class VisitorSessionService {
    /**
     * @param {object} deps
     * @param {object} deps.repo      repositório (saveSession, addDaily, listSessions, getDaily, purgeOlderThan)
     * @param {() => number} [deps.now]
     * @param {object} [deps.options]
     */
    constructor({ repo, now, options = {} }) {
        this._repo = repo;
        this._now = now || (() => Date.now());
        this._opts = {
            idleMs: 3 * 60 * 1000,          // sem conexões por 3 min = sessão encerrada
            bounceSeconds: 10,              // visita com menos que isso é "saída rápida"
            minDetailedSeconds: 20,         // perfil detalhado: ao menos 20 s no site...
            minCameraSeconds: 10,           // ...ou 10 s assistindo uma câmera, ou estar logado
            maxDetailedPerDay: 500,         // teto de perfis gravados por dia (protege a cota do banco)
            maxOpenSessions: 5000,
            requireLogin: false,            // true: só pessoas logadas entram nos perfis (visitantes anônimos e robôs ficam de fora)
            retentionDays: 30,              // perfis detalhados são apagados depois disso
            flushEveryMs: 5 * 60 * 1000,
            ...options
        };
        this._open = new Map();      // sid -> sessão em andamento
        this._conns = new Map();     // connId -> { sid, kind, key, since, tab }
        this._tabSid = new Map();    // tabId -> sid (a mesma pessoa pode ter várias abas numa só sessão)
        this._deltas = new Map();    // date -> contadores ainda não gravados
        this._detailedPerDay = new Map();
        this._lastFlushAt = 0;
        this._lastPurgeAt = 0;
        this._timer = null;
    }

    static isBot(userAgent) {
        return !userAgent || BOT_REGEX.test(String(userAgent));
    }

    // ─── Eventos vindos do servidor ─────────────────────────────────────────────
    _session(sid, user, meta) {
        let s = this._open.get(sid);
        const now = this._now();
        if (!s) {
            if (this._open.size >= this._opts.maxOpenSessions) {
                const oldest = [...this._open.values()].sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];
                if (oldest) this._finalize(oldest, true);
            }
            s = {
                sid,
                startedAt: now,
                lastActivityAt: now,
                user: null,
                meta: { ...(meta || {}) }, // cópia: nunca altera o objeto de quem chamou
                pages: new Map(),
                cameras: new Map(),
                intervals: [],   // conexões já encerradas: [inicio, fim]
                hidden: [],      // períodos em que TODAS as abas estavam em segundo plano: [inicio, fim|null]
                tabHidden: new Map(), // tabId -> true/false
                conns: new Set()
            };
            this._open.set(sid, s);
        }
        if (user && user.uid && !s.user) s.user = { uid: user.uid, name: user.name || 'Usuário' };
        if (meta && !s.meta.device) s.meta = { ...s.meta, ...meta };
        s.lastActivityAt = now;
        return s;
    }

    /** Anônimos e robôs não viram perfil quando `requireLogin` está ligado. */
    _admits(user, meta) {
        if (meta && meta.bot) return false;
        return !this._opts.requireLogin || Boolean(user && user.uid);
    }

    _rememberTab(s, tab) {
        if (!tab) return;
        this._tabSid.set(tab, s.sid);
        if (!s.tabHidden.has(tab)) s.tabHidden.set(tab, false);
    }

    pageOpened({ sid, connId, path, title, user, meta, tab }) {
        if (!sid || !connId || !this._admits(user, meta)) return;
        const s = this._session(sid, user, meta);
        if (!s.meta.entryPath) s.meta.entryPath = path || '/';
        const now = this._now();
        this._conns.set(connId, { sid, tab: tab || null, kind: 'page', key: path || '/', label: title || path || '/', since: now });
        s.conns.add(connId);
        this._rememberTab(s, tab);
    }

    cameraOpened({ sid, connId, code, name, user, meta, tab }) {
        if (!sid || !connId || !code || !this._admits(user, meta)) return;
        const s = this._session(sid, user, meta);
        this._conns.set(connId, { sid, tab: tab || null, kind: 'camera', key: String(code), label: name || `Câmera ${code}`, since: this._now() });
        s.conns.add(connId);
        this._rememberTab(s, tab);
    }

    pageClosed(connId) { this._closeConn(connId); }
    cameraClosed(connId) { this._closeConn(connId); }

    _closeConn(connId) {
        const c = this._conns.get(connId);
        if (!c) return; // idempotente: o servidor chama "fechar" várias vezes
        this._conns.delete(connId);
        const s = this._open.get(c.sid);
        if (!s) return;
        s.conns.delete(connId);

        const now = this._now();
        const activeMs = Math.max(0, now - c.since - overlapMs(c.since, now, s.hidden, now));
        const seconds = Math.round(activeMs / 1000);
        const bucket = c.kind === 'page' ? s.pages : s.cameras;
        const row = bucket.get(c.key) || { label: c.label, seconds: 0, views: 0 };
        row.seconds += seconds;
        row.views += 1;
        row.label = c.label || row.label;
        bucket.set(c.key, row);
        s.intervals.push([c.since, now]);
        s.lastActivityAt = now;

        // A aba que fechou deixa de contar para "todas em segundo plano".
        if (c.tab && ![...s.conns].some((id) => (this._conns.get(id) || {}).tab === c.tab)) {
            s.tabHidden.delete(c.tab);
            this._tabSid.delete(c.tab);
            this._syncHidden(s, now);
        }
    }

    /** Há "segundo plano" na sessão só quando TODAS as abas abertas estão escondidas. */
    _syncHidden(s, now) {
        const all = s.tabHidden.size > 0 && [...s.tabHidden.values()].every(Boolean);
        const last = s.hidden[s.hidden.length - 1];
        if (all && (!last || last[1] != null)) s.hidden.push([now, null]);
        else if (!all && last && last[1] == null) last[1] = now;
    }

    /** Uma aba foi para segundo plano (hidden=true) ou voltou (hidden=false). `key` é o tabId (ou o sid, nos testes). */
    setHidden(key, hidden) {
        const sid = this._tabSid.get(key) || key;
        const s = this._open.get(sid);
        if (!s) return;
        const now = this._now();
        s.tabHidden.set(key, hidden);
        this._syncHidden(s, now);
        s.lastActivityAt = now;
    }

    // ─── Cálculos ───────────────────────────────────────────────────────────────
    _durationSec(s, now) {
        const all = [...s.intervals];
        for (const connId of s.conns) {
            const c = this._conns.get(connId);
            if (c) all.push([c.since, now]);
        }
        let ms = 0;
        for (const [a, b] of mergeIntervals(all)) {
            ms += Math.max(0, (b - a) - overlapMs(a, b, s.hidden, now));
        }
        return Math.round(ms / 1000);
    }

    _snapshot(s, now) {
        const pages = new Map([...s.pages].map(([k, v]) => [k, { ...v }]));
        const cameras = new Map([...s.cameras].map(([k, v]) => [k, { ...v }]));
        const current = { pages: [], cameras: [] };

        for (const connId of s.conns) {
            const c = this._conns.get(connId);
            if (!c) continue;
            const sec = Math.round(Math.max(0, now - c.since - overlapMs(c.since, now, s.hidden, now)) / 1000);
            const bucket = c.kind === 'page' ? pages : cameras;
            const row = bucket.get(c.key) || { label: c.label, seconds: 0, views: 0 };
            row.seconds += sec;
            row.views += 1;
            bucket.set(c.key, row);
            current[c.kind === 'page' ? 'pages' : 'cameras'].push({ key: c.key, label: c.label, seconds: sec });
        }

        const toList = (m, keyName) => [...m].map(([key, v]) => ({ [keyName]: key, nome: v.label, segundos: v.seconds, vezes: v.views }))
            .sort((a, b) => b.segundos - a.segundos);
        return { pages: toList(pages, 'caminho'), cameras: toList(cameras, 'codigo'), current };
    }

    /** Visitantes conectados agora, do mais antigo ao mais recente. */
    live() {
        const now = this._now();
        return [...this._open.values()]
            .filter((s) => s.conns.size > 0)
            .map((s) => {
                const snap = this._snapshot(s, now);
                const hiddenNow = s.hidden.length > 0 && s.hidden[s.hidden.length - 1][1] == null;
                return {
                    id: s.sid.slice(-8),
                    usuario: s.user ? { nome: s.user.name } : null,
                    dispositivo: s.meta.device || '', navegador: s.meta.browser || '', sistema: s.meta.os || '',
                    cidade: s.meta.city || '', regiao: s.meta.region || '', pais: s.meta.country || '',
                    ipMascarado: s.meta.ipMasked || '',
                    entrada: s.meta.entryPath || '/',
                    inicio: s.startedAt,
                    tempoSegundos: this._durationSec(s, now),
                    emSegundoPlano: hiddenNow,
                    paginaAtual: snap.current.pages.map((p) => ({ caminho: p.key, nome: p.label })),
                    assistindoAgora: snap.current.cameras.map((c) => ({ codigo: c.key, nome: c.label, segundos: c.seconds })),
                    paginas: snap.pages,
                    cameras: snap.cameras
                };
            })
            .sort((a, b) => a.inicio - b.inicio);
    }

    // ─── Encerramento, resumo diário e gravação ─────────────────────────────────
    _finalize(s, force = false) {
        const now = this._now();
        for (const connId of [...s.conns]) this._closeConn(connId);
        this._open.delete(s.sid);

        const durationSec = this._durationSec(s, now);
        const cameraSeconds = [...s.cameras.values()].reduce((sum, c) => sum + c.seconds, 0);
        const pageViews = [...s.pages.values()].reduce((sum, p) => sum + p.views, 0);
        const date = getRioBrancoDateStr(new Date(s.startedAt));
        const hour = Number(new Date(s.startedAt - 5 * 3600 * 1000).toISOString().slice(11, 13)); // hora em Rio Branco (UTC-5)

        // 1) resumo do dia (contadores)
        const d = this._deltaFor(date);
        d.sessions += 1;
        d.seconds += durationSec;
        if (durationSec < this._opts.bounceSeconds) d.bounces += 1;
        if (s.user) d.logged += 1;
        if (s.cameras.size > 0) d.withCamera += 1;
        d.pageViews += pageViews;
        d.hours[hour] = (d.hours[hour] || 0) + 1;
        const deviceKey = sanitizeKey(s.meta.device || 'Desconhecido');
        d.devices[deviceKey] = (d.devices[deviceKey] || 0) + 1;
        for (const [code, c] of s.cameras) {
            const k = sanitizeKey(code);
            d.cameraSeconds[k] = (d.cameraSeconds[k] || 0) + c.seconds;
            d.cameraSessions[k] = (d.cameraSessions[k] || 0) + 1;
            d.cameraNames[k] = c.label;
        }
        for (const [path, p] of s.pages) {
            const k = sanitizeKey(path);
            d.pageSeconds[k] = (d.pageSeconds[k] || 0) + p.seconds;
            d.pagePaths[k] = path;
        }
        d.dirty = true;

        // 2) perfil detalhado, só quando vale a pena guardar
        const relevant = durationSec >= this._opts.minDetailedSeconds || cameraSeconds >= this._opts.minCameraSeconds || Boolean(s.user);
        const count = this._detailedPerDay.get(date) || 0;
        let record = null;
        if (relevant && count < this._opts.maxDetailedPerDay) {
            this._detailedPerDay.set(date, count + 1);
            record = {
                sid: s.sid,
                date,
                startedAtMs: s.startedAt,
                endedAtMs: Math.max(s.lastActivityAt, s.startedAt),
                durationSec,
                userId: s.user ? s.user.uid : null,
                userName: s.user ? s.user.name : null,
                isLoggedIn: Boolean(s.user),
                device: s.meta.device || '', browser: s.meta.browser || '', os: s.meta.os || '',
                city: s.meta.city || '', region: s.meta.region || '', country: s.meta.country || '',
                ipMasked: s.meta.ipMasked || '',
                entryPath: s.meta.entryPath || '/',
                cameraSeconds,
                pages: [...s.pages].map(([path, p]) => ({ path, title: p.label, seconds: p.seconds, views: p.views }))
                    .sort((a, b) => b.seconds - a.seconds).slice(0, 30),
                cameras: [...s.cameras].map(([code, c]) => ({ code, name: c.label, seconds: c.seconds, views: c.views }))
                    .sort((a, b) => b.seconds - a.seconds).slice(0, 20)
            };
        }
        return record;
    }

    _deltaFor(date) {
        let d = this._deltas.get(date);
        if (!d) {
            d = {
                sessions: 0, seconds: 0, bounces: 0, logged: 0, withCamera: 0, pageViews: 0,
                hours: {}, devices: {}, cameraSeconds: {}, cameraSessions: {}, cameraNames: {}, pageSeconds: {}, pagePaths: {},
                dirty: false
            };
            this._deltas.set(date, d);
        }
        return d;
    }

    /** Encerra as sessões paradas e grava o que estiver pendente. Chamar a cada ~minuto. */
    async sweep() {
        const now = this._now();
        const records = [];
        for (const s of [...this._open.values()]) {
            if (s.conns.size === 0 && now - s.lastActivityAt >= this._opts.idleMs) {
                const record = this._finalize(s);
                if (record) records.push(record);
            }
        }
        await this._persist(records, false);
        return { encerradas: records.length, abertas: this._open.size };
    }

    /** Encerra tudo (desligamento do servidor) e grava. */
    async flushAll() {
        const records = [];
        for (const s of [...this._open.values()]) {
            const record = this._finalize(s, true);
            if (record) records.push(record);
        }
        await this._persist(records, true);
    }

    async _persist(records, force) {
        const now = this._now();
        for (const record of records) {
            try {
                await this._repo.saveSession(record);
            } catch (error) {
                console.error('[VISITANTES] Falha ao gravar perfil de sessão:', error.message);
            }
        }

        if (force || now - this._lastFlushAt >= this._opts.flushEveryMs) {
            this._lastFlushAt = now;
            // Percorre uma cópia: em caso de falha o dia volta para a fila, e alterar o mapa durante o laço o repetiria sem fim
            for (const [date, d] of [...this._deltas]) {
                if (!d.dirty) continue;
                const copy = JSON.parse(JSON.stringify(d));
                this._deltas.delete(date); // se falhar, devolvemos abaixo
                try {
                    await this._repo.addDaily(date, copy);
                } catch (error) {
                    console.error('[VISITANTES] Falha ao gravar resumo do dia:', error.message);
                    const back = this._deltaFor(date);
                    this._mergeInto(back, copy);
                }
            }
        }

        if (force || now - this._lastPurgeAt >= 24 * 3600 * 1000) {
            this._lastPurgeAt = now;
            try {
                const removed = await this._repo.purgeOlderThan(now - this._opts.retentionDays * 24 * 3600 * 1000);
                if (removed) console.log(`[VISITANTES] ${removed} perfil(is) com mais de ${this._opts.retentionDays} dias apagado(s).`);
            } catch (error) {
                console.error('[VISITANTES] Falha na limpeza de perfis antigos:', error.message);
            }
        }
    }

    _mergeInto(target, src) {
        for (const k of ['sessions', 'seconds', 'bounces', 'logged', 'withCamera', 'pageViews']) target[k] += src[k] || 0;
        for (const map of ['hours', 'devices', 'cameraSeconds', 'cameraSessions', 'pageSeconds']) {
            for (const [k, v] of Object.entries(src[map] || {})) target[map][k] = (target[map][k] || 0) + v;
        }
        Object.assign(target.cameraNames, src.cameraNames || {});
        Object.assign(target.pagePaths, src.pagePaths || {});
        target.dirty = true;
    }

    // ─── Consultas para o painel ────────────────────────────────────────────────
    /** Resumo dos últimos N dias (gravado + o que ainda não foi gravado). */
    async summary(days = 7) {
        const n = Math.max(1, Math.min(30, parseInt(days, 10) || 7));
        const dates = [];
        for (let i = 0; i < n; i++) dates.push(getRioBrancoDateStr(new Date(this._now() - i * 24 * 3600 * 1000)));

        const stored = await this._repo.getDaily(dates);
        const acc = this._emptyAcc();
        const perDay = [];

        for (const date of dates.slice().reverse()) {
            const day = this._emptyAcc();
            if (stored[date]) this._addAcc(day, stored[date]);
            const pending = this._deltas.get(date);
            if (pending) this._addAcc(day, pending);
            perDay.push({ data: date, sessoes: day.sessions, mediaSegundos: day.sessions ? Math.round(day.seconds / day.sessions) : 0 });
            this._addAcc(acc, day);
        }

        const topCameras = Object.entries(acc.cameraSeconds)
            .map(([k, seconds]) => ({
                codigo: k, nome: acc.cameraNames[k] || `Câmera ${k}`, segundos: seconds,
                sessoes: acc.cameraSessions[k] || 0,
                mediaSegundos: acc.cameraSessions[k] ? Math.round(seconds / acc.cameraSessions[k]) : 0
            }))
            .sort((a, b) => b.segundos - a.segundos).slice(0, 10);
        const topPages = Object.entries(acc.pageSeconds)
            .map(([k, seconds]) => ({ caminho: acc.pagePaths[k] || k, segundos: seconds }))
            .sort((a, b) => b.segundos - a.segundos).slice(0, 10);
        const hours = Array.from({ length: 24 }, (_, h) => ({ hora: h, sessoes: acc.hours[h] || 0 }));

        return {
            dias: n,
            sessoes: acc.sessions,
            mediaSegundos: acc.sessions ? Math.round(acc.seconds / acc.sessions) : 0,
            saidaRapidaPct: acc.sessions ? Math.round((acc.bounces / acc.sessions) * 100) : 0,
            logadosPct: acc.sessions ? Math.round((acc.logged / acc.sessions) * 100) : 0,
            comCameraPct: acc.sessions ? Math.round((acc.withCamera / acc.sessions) * 100) : 0,
            paginasPorSessao: acc.sessions ? Math.round((acc.pageViews / acc.sessions) * 10) / 10 : 0,
            segundosAssistidos: Object.values(acc.cameraSeconds).reduce((a, b) => a + b, 0),
            camerasMaisAssistidas: topCameras,
            paginasMaisUsadas: topPages,
            dispositivos: Object.entries(acc.devices).map(([nome, qtd]) => ({ nome, sessoes: qtd })).sort((a, b) => b.sessoes - a.sessoes),
            porHora: hours,
            porDia: perDay,
            aoVivo: this.live().length
        };
    }

    _emptyAcc() {
        return { sessions: 0, seconds: 0, bounces: 0, logged: 0, withCamera: 0, pageViews: 0, hours: {}, devices: {},
            cameraSeconds: {}, cameraSessions: {}, cameraNames: {}, pageSeconds: {}, pagePaths: {} };
    }

    _addAcc(acc, d) {
        for (const k of ['sessions', 'seconds', 'bounces', 'logged', 'withCamera', 'pageViews']) acc[k] += d[k] || 0;
        for (const map of ['hours', 'devices', 'cameraSeconds', 'cameraSessions', 'pageSeconds']) {
            for (const [k, v] of Object.entries(d[map] || {})) acc[map][k] = (acc[map][k] || 0) + v;
        }
        Object.assign(acc.cameraNames, d.cameraNames || {});
        Object.assign(acc.pagePaths, d.pagePaths || {});
    }

    /** Perfis gravados (mais recentes primeiro), com filtros simples. */
    async sessions({ days = 7, limit = 200, onlyCamera = false, onlyLogged = false, minSeconds = 0 } = {}) {
        const n = Math.max(1, Math.min(30, parseInt(days, 10) || 7));
        const lim = Math.max(1, Math.min(500, parseInt(limit, 10) || 200));
        const since = this._now() - n * 24 * 3600 * 1000;
        let list = await this._repo.listSessions({ sinceMs: since, limit: 500 });
        if (onlyCamera) list = list.filter((s) => (s.cameras || []).length > 0);
        if (onlyLogged) list = list.filter((s) => s.isLoggedIn);
        const min = Math.max(0, parseInt(minSeconds, 10) || 0);
        if (min) list = list.filter((s) => s.durationSec >= min);
        return list.slice(0, lim).map((s) => ({
            id: String(s.sid).slice(-8),
            inicio: s.startedAtMs, fim: s.endedAtMs, duracaoSegundos: s.durationSec,
            usuario: s.isLoggedIn ? { nome: s.userName } : null,
            dispositivo: s.device, navegador: s.browser, sistema: s.os,
            cidade: s.city, regiao: s.region, pais: s.country, ipMascarado: s.ipMasked,
            entrada: s.entryPath, segundosEmCameras: s.cameraSeconds || 0,
            paginas: (s.pages || []).map((p) => ({ caminho: p.path, nome: p.title, segundos: p.seconds, vezes: p.views })),
            cameras: (s.cameras || []).map((c) => ({ codigo: c.code, nome: c.name, segundos: c.seconds, vezes: c.views }))
        }));
    }

    /**
     * Uma linha por PESSOA: junta todas as visitas gravadas de quem aparece várias vezes.
     *  - logado: pela conta (userId), em qualquer aparelho;
     *  - anônimo (perfis antigos): por IP mascarado + aparelho + navegador + sistema, que é o que há em comum.
     *    É uma aproximação: duas pessoas na mesma rede com o mesmo modelo de aparelho se juntam.
     */
    async profiles({ days = 7, limit = 200, onlyCamera = false, onlyLogged = false, minSeconds = 0 } = {}) {
        const n = Math.max(1, Math.min(30, parseInt(days, 10) || 7));
        const lim = Math.max(1, Math.min(500, parseInt(limit, 10) || 200));
        const since = this._now() - n * 24 * 3600 * 1000;
        const records = await this._repo.listSessions({ sinceMs: since, limit: 500 });

        const people = new Map();
        for (const s of records) {
            const logged = Boolean(s.isLoggedIn && s.userId);
            const key = logged ? `u:${s.userId}` : `a:${s.ipMasked || '?'}|${s.device || '?'}|${s.browser || '?'}|${s.os || '?'}`;
            let p = people.get(key);
            if (!p) {
                p = { key, logged, name: logged ? s.userName : null, visits: [], devices: new Set(), places: new Set(), ips: new Set(),
                    pages: new Map(), cameras: new Map(), seconds: 0, cameraSeconds: 0 };
                people.set(key, p);
            }
            p.visits.push(s);
            p.seconds += s.durationSec || 0;
            p.cameraSeconds += s.cameraSeconds || 0;
            const dev = [s.device, s.browser].filter(Boolean).join(' · ');
            if (dev) p.devices.add(dev);
            const place = [s.city, s.region].filter(Boolean).join(', ');
            if (place) p.places.add(place);
            if (s.ipMasked) p.ips.add(s.ipMasked);
            for (const pg of s.pages || []) {
                const row = p.pages.get(pg.path) || { caminho: pg.path, nome: pg.title, segundos: 0, vezes: 0, visitas: 0 };
                row.segundos += pg.seconds || 0; row.vezes += pg.views || 0; row.visitas += 1;
                p.pages.set(pg.path, row);
            }
            for (const c of s.cameras || []) {
                const row = p.cameras.get(c.code) || { codigo: c.code, nome: c.name, segundos: 0, vezes: 0, visitas: 0 };
                row.segundos += c.seconds || 0; row.vezes += c.views || 0; row.visitas += 1;
                p.cameras.set(c.code, row);
            }
        }

        let list = [...people.values()];
        if (onlyCamera) list = list.filter((p) => p.cameras.size > 0);
        if (onlyLogged) list = list.filter((p) => p.logged);
        const min = Math.max(0, parseInt(minSeconds, 10) || 0);
        if (min) list = list.filter((p) => p.seconds >= min);

        return list.map((p) => {
            const visits = [...p.visits].sort((a, b) => a.startedAtMs - b.startedAtMs);
            const byTime = (a, b) => b.segundos - a.segundos;
            return {
                id: createHash('sha1').update(p.key).digest('hex').slice(0, 8),
                usuario: p.logged ? { nome: p.name } : null,
                agrupadoPor: p.logged ? 'conta' : 'IP mascarado, aparelho e navegador',
                visitas: visits.length,
                duracaoSegundos: p.seconds,
                segundosEmCameras: p.cameraSeconds,
                primeira: visits[0].startedAtMs,
                ultima: Math.max(...visits.map((v) => v.endedAtMs || v.startedAtMs)),
                dispositivos: [...p.devices], locais: [...p.places], ipsMascarados: [...p.ips],
                paginas: [...p.pages.values()].sort(byTime).slice(0, 30),
                cameras: [...p.cameras.values()].sort(byTime).slice(0, 20),
                trajetoria: visits.slice(-50).map((v) => ({
                    inicio: v.startedAtMs, duracaoSegundos: v.durationSec, entrada: v.entryPath,
                    cameras: (v.cameras || []).map((c) => c.name)
                }))
            };
        }).sort((a, b) => b.ultima - a.ultima).slice(0, lim);
    }

    // ─── Agendamento ────────────────────────────────────────────────────────────
    start(intervalMs = 60 * 1000) {
        if (this._timer) return;
        this._timer = setInterval(() => {
            this.sweep().catch((e) => console.error('[VISITANTES] Erro na rotina de sessões:', e.message));
        }, intervalMs);
        this._timer.unref();
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    }
}

module.exports = VisitorSessionService;
