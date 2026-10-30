const crypto = require('crypto');

/** Versão do texto de consentimento (Termos de Uso, seção de alertas). Muda quando o texto mudar. */
const CONSENT_VERSION = '2026-10';

const LEVEL_IDS = ['atencao', 'alerta', 'transbordamento'];
const DEFAULT_LEVELS = ['alerta', 'transbordamento'];

const escapeHtml = (value) => String(value ?? '').replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&#39;', '"': '&quot;'
}[c]));

const fmtMeters = (n) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

class AlertError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'AlertError';
        this.status = status;
        this.code = code;
    }
}

/**
 * RioAlertService — alertas por e-mail quando o Rio Acre cruza uma cota.
 *
 * Princípios:
 *  - Só recebe quem pediu: inscrição com consentimento explícito + confirmação por link (double opt-in).
 *  - Todo e-mail tem link de cancelamento (e cabeçalho List-Unsubscribe de um clique).
 *  - Links são assinados (HMAC), sem guardar token no banco.
 *  - Só alerta na SUBIDA de nível, com leitura recente e confiável, confirmada em leituras consecutivas
 *    e com histerese na descida (evita e-mail repetido quando o rio oscila perto da cota).
 *  - Limite diário de envios para sobrar cota do provedor para os códigos de login.
 */
class RioAlertService {
    /**
     * @param {object} deps
     * @param {object} deps.repo         repositório de inscritos/estado (ver FirebaseAlertSubscriberRepository)
     * @param {object} deps.mailService  MailService (sendMessage / isConfigured)
     * @param {object} deps.rioService   RioAcreService (getNivelRioAcre, cotaAtencao/Alerta/Transbordamento)
     * @param {string} deps.tokenSecret  segredo para assinar links
     * @param {string} [deps.baseUrl]    URL pública do site
     */
    constructor({ repo, mailService, rioService, tokenSecret, baseUrl, now, sleep, options = {} }) {
        if (!tokenSecret) throw new Error('RioAlertService: tokenSecret é obrigatório.');
        this._repo = repo;
        this._mail = mailService;
        this._rio = rioService;
        this._secret = tokenSecret;
        this._baseUrl = String(baseUrl || 'https://camerasriobranco.com.br').replace(/\/+$/, '');
        this._now = now || (() => Date.now());
        this._sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
        this._timer = null;
        this._running = false;

        this._opts = {
            confirmationsNeeded: 2,             // leituras seguidas acima da cota antes de alertar
            hysteresisM: 0.15,                  // o rio precisa cair 15 cm abaixo da cota para "rearmar"
            maxEmailsPerDay: 80,                // Resend grátis = 100/dia; sobra o resto para os códigos de login
            sendIntervalMs: 600,                // Resend grátis aceita ~2 req/s
            confirmCooldownMs: 60 * 1000,
            maxEventAttempts: 6,
            ...options
        };
    }

    // ─── Níveis ─────────────────────────────────────────────────────────────────
    levels() {
        return [
            { id: 'atencao', nome: 'Atenção', cota: this._rio.cotaAtencao },
            { id: 'alerta', nome: 'Alerta', cota: this._rio.cotaAlerta },
            { id: 'transbordamento', nome: 'Transbordamento', cota: this._rio.cotaTransbordamento }
        ];
    }

    _levelRank(id) {
        const i = LEVEL_IDS.indexOf(id);
        return i < 0 ? -1 : i;
    }

    // ─── Tokens (HMAC) ──────────────────────────────────────────────────────────
    _idFor(email) {
        return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
    }

    _token(purpose, id) {
        return crypto.createHmac('sha256', this._secret).update(`${purpose}:${id}`).digest('hex').slice(0, 40);
    }

    _validToken(purpose, id, token) {
        if (typeof id !== 'string' || typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return false;
        const expected = Buffer.from(this._token(purpose, id));
        const received = Buffer.from(token);
        return expected.length === received.length && crypto.timingSafeEqual(expected, received);
    }

    confirmUrl(id) {
        return `${this._baseUrl}/api/alertas/confirmar?id=${id}&t=${this._token('confirm', id)}`;
    }

    /** Página (GET) que mostra o botão de cancelar; o cancelamento em si é POST. */
    unsubscribePageUrl(id) {
        return `${this._baseUrl}/alertas/cancelar?id=${id}&t=${this._token('unsub', id)}`;
    }

    unsubscribePostUrl(id) {
        return `${this._baseUrl}/api/alertas/cancelar?id=${id}&t=${this._token('unsub', id)}`;
    }

    // ─── Inscrição ──────────────────────────────────────────────────────────────
    /**
     * Cria/atualiza uma inscrição PENDENTE e envia o link de confirmação.
     * A resposta é sempre a mesma para não revelar quem já está inscrito.
     */
    async subscribe({ email, niveis, consent }) {
        const clean = String(email ?? '').trim().toLowerCase();
        if (!clean || clean.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
            throw new AlertError(400, 'INVALID_EMAIL', 'Digite um e-mail válido.');
        }
        if (consent !== true) {
            throw new AlertError(400, 'CONSENT_REQUIRED', 'Marque a caixa de consentimento para receber os alertas.');
        }

        let levels = Array.isArray(niveis) ? [...new Set(niveis.filter((n) => LEVEL_IDS.includes(n)))] : [];
        if (!levels.length) levels = [...DEFAULT_LEVELS];

        if (!this._mail.isConfigured()) {
            throw new AlertError(503, 'MAIL_NOT_CONFIGURED', 'O envio de e-mails não está disponível no momento.');
        }

        const id = this._idFor(clean);
        const now = this._now();
        const existing = await this._repo.getSubscriber(id);
        const generic = { ok: true };

        // Quem já está inscrito não é alterado por terceiros: ignora em silêncio.
        if (existing && existing.status === 'active') return generic;
        if (existing && existing.status === 'pending' && now - (existing.confirmSentAt || 0) < this._opts.confirmCooldownMs) {
            return generic;
        }

        await this._repo.saveSubscriber({
            id,
            email: clean,
            status: 'pending',
            niveis: levels,
            consentAt: now,
            consentVersion: CONSENT_VERSION,
            confirmSentAt: now,
            createdAt: existing?.createdAt || now
        });

        try {
            await this._mail.sendMessage(clean, this._buildConfirmMessage(id, levels), { channel: 'alertas' });
        } catch (error) {
            console.error('[RIO_ALERT] Falha ao enviar confirmação:', error.message);
            throw new AlertError(502, 'MAIL_SEND_FAILED', 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.');
        }
        return generic;
    }

    /** @returns {Promise<boolean>} true se o link era válido */
    async confirm(id, token) {
        if (!this._validToken('confirm', id, token)) return false;
        const sub = await this._repo.getSubscriber(id);
        if (!sub || sub.status === 'unsubscribed') return false; // cancelou depois: o link antigo não reativa
        if (sub.status !== 'active') {
            await this._repo.saveSubscriber({ ...sub, status: 'active', confirmedAt: this._now() });
        }
        return true;
    }

    /** @returns {Promise<boolean>} true se o link era válido (idempotente) */
    async unsubscribe(id, token) {
        if (!this._validToken('unsub', id, token)) return false;
        const sub = await this._repo.getSubscriber(id);
        if (sub && sub.status !== 'unsubscribed') {
            await this._repo.saveSubscriber({ ...sub, status: 'unsubscribed', unsubscribedAt: this._now() });
        }
        return true;
    }

    // ─── Mensagens ──────────────────────────────────────────────────────────────
    _layout({ title, bodyHtml, footerHtml }) {
        return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 12px;font-size:20px;">${title}</h1>
    ${bodyHtml}
  </div>
  <p style="max-width:480px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">${footerHtml}</p>
</body>
</html>`;
    }

    _buildConfirmMessage(id, levels) {
        const url = this.confirmUrl(id);
        const names = this.levels().filter((l) => levels.includes(l.id)).map((l) => `${l.nome} (${fmtMeters(l.cota)} m)`);
        const text = [
            'Olá!',
            '',
            'Alguém (esperamos que você) pediu para receber no CamRB alertas por e-mail quando o Rio Acre, em Rio Branco, passar de: ' + names.join(', ') + '.',
            '',
            'Para confirmar e começar a receber, abra o link abaixo:',
            url,
            '',
            'Se não foi você, ignore este e-mail: nada será enviado sem a sua confirmação.'
        ].join('\n');
        const html = this._layout({
            title: 'Confirme os alertas do Rio Acre',
            bodyHtml: `<p style="margin:0 0 16px;line-height:1.5;">Pediram para receber no <strong>CamRB</strong> alertas por e-mail quando o Rio Acre, em Rio Branco, passar de: <strong>${escapeHtml(names.join(', '))}</strong>.</p>
    <p style="margin:0 0 24px;"><a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:10px;">Confirmar alertas</a></p>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">Se não foi você, ignore este e-mail: nada será enviado sem a sua confirmação.</p>`,
            footerHtml: 'CamRB · Rio Branco - AC'
        });
        return { subject: 'Confirme seus alertas do Rio Acre - CamRB', text, html };
    }

    _buildAlertMessage(sub, event) {
        const level = this.levels().find((l) => l.id === event.level);
        const unsubPage = this.unsubscribePageUrl(sub.id);
        const unsubPost = this.unsubscribePostUrl(sub.id);
        const riverUrl = `${this._baseUrl}/rio`;
        const headline = event.level === 'transbordamento'
            ? `Rio Acre acima da cota de transbordamento (${fmtMeters(level.cota)} m)`
            : `Rio Acre acima da cota de ${level.nome.toLowerCase()} (${fmtMeters(level.cota)} m)`;

        const text = [
            headline,
            '',
            `Nível atual: ${fmtMeters(event.metros)} m (leitura de ${event.dataLeitura || 'agora há pouco'}).`,
            `Estação: Rio Branco - Rio Acre. Fonte: ${event.fonte || 'ANA'}.`,
            '',
            `Acompanhe em tempo real: ${riverUrl}`,
            '',
            'Este é um aviso automático e informativo, baseado em dados da ANA. Para orientações oficiais, consulte a Defesa Civil (199) e o SGB/CPRM.',
            '',
            `Você recebe este e-mail porque pediu alertas do Rio Acre no CamRB. Para deixar de receber: ${unsubPage}`
        ].join('\n');

        const color = event.level === 'transbordamento' ? '#dc2626' : event.level === 'alerta' ? '#ea580c' : '#d97706';
        const html = this._layout({
            title: `<span style="color:${color};">${escapeHtml(headline)}</span>`,
            bodyHtml: `<p style="margin:0 0 4px;font-size:34px;font-weight:bold;">${fmtMeters(event.metros)} m</p>
    <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">Leitura de ${escapeHtml(event.dataLeitura || 'agora há pouco')} · Estação Rio Branco · Fonte: ${escapeHtml(event.fonte || 'ANA')}</p>
    <p style="margin:0 0 24px;"><a href="${riverUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:10px;">Ver nível em tempo real</a></p>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">Aviso automático e informativo, baseado em dados da ANA. Para orientações oficiais, consulte a Defesa Civil (199) e o SGB/CPRM.</p>`,
            footerHtml: `Você recebe este e-mail porque pediu alertas do Rio Acre no CamRB.<br><a href="${unsubPage}" style="color:#6b7280;">Deixar de receber</a>`
        });

        return {
            subject: `${event.level === 'transbordamento' ? '🚨' : '⚠️'} ${headline}`,
            text,
            html,
            headers: {
                'List-Unsubscribe': `<${unsubPost}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            }
        };
    }

    // ─── Avaliação do nível e disparo ───────────────────────────────────────────
    _levelFor(metros, hysteresis = 0) {
        let current = 'normal';
        for (const l of this.levels()) {
            if (metros >= l.cota - hysteresis) current = l.id;
        }
        return current;
    }

    /**
     * Lê o nível atual, atualiza o estado e envia os e-mails pendentes.
     * Seguro de chamar em intervalo fixo; não faz nada se a leitura for velha ou duvidosa.
     */
    async evaluate() {
        if (this._running) return { skipped: 'em-andamento' };
        this._running = true;
        try {
            return await this._evaluate();
        } finally {
            this._running = false;
        }
    }

    async _evaluate() {
        let data;
        try {
            data = await this._rio.getNivelRioAcre();
        } catch (error) {
            return { skipped: 'sem-leitura' };
        }

        const metros = data?.nivel?.metros;
        if (!Number.isFinite(metros)) return { skipped: 'sem-leitura' };
        if (data.frescor?.desatualizado || data.frescor?.fusoSuspeito) return { skipped: 'leitura-desatualizada' };
        if (data.nivel?.qualidade && data.nivel.qualidade.confiavel === false) return { skipped: 'leitura-nao-confiavel' };

        const { hysteresisM, confirmationsNeeded } = this._opts;
        let state = await this._repo.getState();

        // Primeira execução: assume o nível atual sem alertar (evita disparo em massa ao ligar o sistema).
        if (!state) {
            state = { level: this._levelFor(metros, hysteresisM), candidate: null, event: null, sent: { date: '', count: 0 } };
            await this._repo.saveState(state);
            return { initialized: state.level };
        }

        const rank = (id) => (id === 'normal' ? -1 : this._levelRank(id));
        const raw = this._levelFor(metros);
        const effective = this._levelFor(metros, hysteresisM);
        let changed = false;

        if (rank(raw) > rank(state.level)) {
            const same = state.candidate && state.candidate.level === raw;
            const count = same ? state.candidate.count + 1 : 1;
            if (count >= confirmationsNeeded) {
                state.level = raw;
                state.candidate = null;
                state.event = {
                    id: `${raw}-${this._now()}-${crypto.randomBytes(3).toString('hex')}`,
                    level: raw,
                    metros,
                    dataLeitura: data.nivel.dataLeitura || '',
                    fonte: data.fonte || 'ANA',
                    attempts: 0,
                    done: false
                };
            } else {
                state.candidate = { level: raw, count };
            }
            changed = true;
        } else {
            if (state.candidate) { state.candidate = null; changed = true; }
            if (rank(effective) < rank(state.level)) {
                state.level = effective; // rio baixou o bastante: rearma o alerta
                if (state.event && !state.event.done) state.event.done = true; // não envia aviso velho
                changed = true;
            }
        }

        let result = { level: state.level };
        if (state.event && !state.event.done) {
            result = { ...result, ...(await this._dispatch(state)) };
            changed = true;
        }
        if (changed) await this._repo.saveState(state);
        return result;
    }

    async _dispatch(state) {
        const event = state.event;
        event.attempts = (event.attempts || 0) + 1;

        if (!this._mail.isConfigured()) {
            if (event.attempts >= this._opts.maxEventAttempts) event.done = true;
            return { sent: 0, reason: 'mail-nao-configurado' };
        }

        const dayKey = new Date(this._now() - 5 * 3600 * 1000).toISOString().slice(0, 10); // dia em Rio Branco (UTC-5)
        if (!state.sent || state.sent.date !== dayKey) state.sent = { date: dayKey, count: 0 };

        const subs = (await this._repo.listActiveSubscribers())
            .filter((s) => (s.niveis || DEFAULT_LEVELS).includes(event.level) && s.lastEventId !== event.id)
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

        let sent = 0;
        let failed = 0;
        for (const sub of subs) {
            if (state.sent.count >= this._opts.maxEmailsPerDay) break;
            try {
                await this._mail.sendMessage(sub.email, this._buildAlertMessage(sub, event), { channel: 'alertas' });
                await this._repo.markNotified(sub.id, event.id);
                state.sent.count++;
                sent++;
            } catch (error) {
                failed++;
                console.error(`[RIO_ALERT] Falha ao enviar para inscrito ${sub.id}:`, error.message);
            }
            await this._sleep(this._opts.sendIntervalMs);
        }

        const remaining = subs.length - sent;
        const capHit = state.sent.count >= this._opts.maxEmailsPerDay && remaining > 0;
        if (capHit) console.warn(`[RIO_ALERT] Limite diário de ${this._opts.maxEmailsPerDay} e-mails atingido; ${remaining} inscrito(s) ficam para o próximo ciclo.`);
        if (remaining === 0 || (failed > 0 && event.attempts >= this._opts.maxEventAttempts)) event.done = true;

        console.log(`[RIO_ALERT] Evento ${event.id}: ${sent} enviado(s), ${remaining} pendente(s).`);
        return { sent, remaining };
    }

    // ─── Agendamento ────────────────────────────────────────────────────────────
    start(intervalMs = 5 * 60 * 1000) {
        if (this._timer) return;
        const tick = () => this.evaluate().catch((e) => console.error('[RIO_ALERT] Erro na avaliação:', e.message));
        setTimeout(tick, 90 * 1000).unref();
        this._timer = setInterval(tick, intervalMs);
        this._timer.unref();
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    }
}

module.exports = RioAlertService;
module.exports.AlertError = AlertError;
module.exports.CONSENT_VERSION = CONSENT_VERSION;
module.exports.LEVEL_IDS = LEVEL_IDS;
