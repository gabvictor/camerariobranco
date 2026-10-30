const escapeHtml = (value) => String(value ?? '').replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '\'': '&#39;',
    '"': '&quot;'
}[c]));

const RESEND_DEFAULT_URL = 'https://api.resend.com/emails';
const RESEND_TEST_FROM = 'CamRB <onboarding@resend.dev>';

// O modo "console" só é aceito quando o site roda em endereço local.
const isLocalSite = (baseUrl) => {
    if (!baseUrl) return false;
    try {
        const { hostname } = new URL(baseUrl);
        return ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(hostname) || hostname.endsWith('.localhost');
    } catch {
        return false;
    }
};

/**
 * MailService — envio de e-mails transacionais.
 *
 * Drivers (escolha automática, ou force com MAIL_DRIVER=resend|smtp|console):
 *   1. resend  → RESEND_API_KEY (+ MAIL_FROM). Plano gratuito do Resend, via API HTTP.
 *   2. smtp    → SMTP_HOST, SMTP_PORT (587), SMTP_SECURE, SMTP_USER, SMTP_PASS (+ MAIL_FROM)
 *   3. console → NÃO envia: imprime o código no log do servidor. Só para teste local
 *                (MAIL_DRIVER=console e SITE_BASE_URL apontando para localhost).
 */
class MailService {
    /**
     * @param {object} [env]  variáveis de ambiente (só preenchem o que o serviceAccountKey.json não definir)
     * @param {{ fetchImpl?: Function, keyFileConfig?: { apiKey?: string, from?: string, fromAlertas?: string } }} [opts]
     *        keyFileConfig = bloco "resend" do serviceAccountKey.json (fonte principal).
     */
    constructor(env = process.env, { fetchImpl, keyFileConfig } = {}) {
        this._fetch = fetchImpl || ((...args) => fetch(...args));
        this._transporter = null;

        const fromFile = keyFileConfig && typeof keyFileConfig === 'object' ? keyFileConfig : {};
        env = {
            ...env,
            RESEND_API_KEY: String(fromFile.apiKey || '').trim() || (env.RESEND_API_KEY || '').trim(),
            MAIL_FROM: String(fromFile.from || '').trim() || (env.MAIL_FROM || '').trim(),
            MAIL_FROM_ALERTAS: String(fromFile.fromAlertas || '').trim() || (env.MAIL_FROM_ALERTAS || '').trim()
        };

        this._resendKey = (env.RESEND_API_KEY || '').trim();
        this._resendUrl = (env.RESEND_API_URL || '').trim() || RESEND_DEFAULT_URL;

        this._host = (env.SMTP_HOST || '').trim();
        this._port = Number.parseInt(env.SMTP_PORT, 10) || 587;
        this._secure = env.SMTP_SECURE
            ? String(env.SMTP_SECURE).toLowerCase() === 'true'
            : this._port === 465;
        this._user = (env.SMTP_USER || '').trim();
        this._pass = env.SMTP_PASS || '';

        const explicitFrom = (env.MAIL_FROM || '').trim();
        this.disabledReason = '';

        const requested = (env.MAIL_DRIVER || '').trim().toLowerCase();
        let driver = ['resend', 'smtp', 'console'].includes(requested) ? requested : '';

        if (!driver) {
            if (this._resendKey) driver = 'resend';
            else if (this._host && this._user && this._pass) driver = 'smtp';
        }

        if (driver === 'console' && !isLocalSite(env.SITE_BASE_URL)) {
            this.disabledReason = 'MAIL_DRIVER=console só é permitido quando SITE_BASE_URL aponta para localhost (evita vazar códigos em produção).';
            driver = '';
        }

        this.driver = driver || 'none';

        if (this.driver === 'resend') {
            this._from = explicitFrom || RESEND_TEST_FROM;
        } else if (this.driver === 'smtp') {
            this._from = explicitFrom || (this._user ? `CamRB <${this._user}>` : '');
        } else {
            this._from = explicitFrom || 'CamRB <no-reply@localhost>';
        }

        // Remetente separado para alertas do rio (e a confirmação da inscrição neles);
        // sem ele, os alertas saem pelo mesmo remetente dos códigos de login.
        this._fromAlerts = (env.MAIL_FROM_ALERTAS || '').trim() || this._from;
    }

    /** @param {'conta'|'alertas'} [channel] */
    _fromFor(channel) {
        return channel === 'alertas' ? this._fromAlerts : this._from;
    }

    isConfigured() {
        switch (this.driver) {
            case 'resend': return Boolean(this._resendKey && this._from);
            case 'smtp': return Boolean(this._host && this._user && this._pass && this._from);
            case 'console': return true;
            default: return false;
        }
    }

    _buildMessage(code, { name, expiresInMinutes }) {
        const greeting = name ? `Olá, ${escapeHtml(name)}!` : 'Olá!';
        const greetingText = name ? `Olá, ${name}!` : 'Olá!';

        const text = [
            greetingText,
            '',
            `Seu código de verificação do CamRB é: ${code}`,
            '',
            `Ele expira em ${expiresInMinutes} minutos. Se você não tentou criar uma conta ou entrar no CamRB, ignore este e-mail.`
        ].join('\n');

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 8px;font-size:20px;">${greeting}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#4b5563;">Use o código abaixo para confirmar seu e-mail no CamRB:</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;padding:16px 0;background:#eef2ff;border-radius:12px;color:#4338ca;">${escapeHtml(code)}</div>
    <p style="margin:20px 0 0;font-size:12px;color:#6b7280;">O código expira em ${expiresInMinutes} minutos. Se você não tentou criar uma conta ou entrar no CamRB, pode ignorar este e-mail.</p>
  </div>
</body>
</html>`;

        return { subject: `${code} é o seu código de verificação do CamRB`, text, html };
    }

    _getTransporter() {
        if (!this._transporter) {
            const nodemailer = require('nodemailer'); // só é carregado se o driver SMTP for usado
            this._transporter = nodemailer.createTransport({
                host: this._host,
                port: this._port,
                secure: this._secure,
                auth: { user: this._user, pass: this._pass },
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                socketTimeout: 15000
            });
        }
        return this._transporter;
    }

    async _sendViaResend(to, message, from = this._from) {
        const extraHeaders = message.headers && Object.keys(message.headers).length ? { headers: message.headers } : {};
        const response = await this._fetch(this._resendUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this._resendKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from,
                to: [to],
                subject: message.subject,
                html: message.html,
                text: message.text,
                ...extraHeaders
            }),
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            let detail = '';
            try {
                const body = await response.json();
                detail = body.message || body.name || '';
            } catch (_) { /* corpo não-JSON */ }

            let hint = '';
            if (response.status === 403) {
                hint = ' (remetente sem domínio verificado só envia para o e-mail dono da conta Resend; verifique seu domínio no painel do Resend)';
            } else if (response.status === 401) {
                hint = ' (RESEND_API_KEY inválida)';
            }

            const err = new Error(`Resend respondeu HTTP ${response.status}${detail ? `: ${detail}` : ''}${hint}`);
            err.status = response.status;
            throw err;
        }
    }

    /**
     * Envia o código numérico de verificação de e-mail.
     * @param {string} to
     * @param {string} code  6 dígitos
     * @param {{ name?: string, expiresInMinutes?: number }} [opts]
     */
    async sendVerificationCode(to, code, { name, expiresInMinutes = 10 } = {}) {
        if (!this.isConfigured()) {
            const err = new Error('Envio de e-mail não configurado.');
            err.code = 'MAIL_NOT_CONFIGURED';
            throw err;
        }

        const message = this._buildMessage(code, { name, expiresInMinutes });

        if (this.driver === 'console') {
            console.log(`\n[MAIL:console] ✉  Código de verificação para ${to}: ${code}  (expira em ${expiresInMinutes} min)\n`);
            return;
        }

        if (this.driver === 'resend') {
            await this._sendViaResend(to, message);
            return;
        }

        await this._getTransporter().sendMail({
            from: this._from,
            to,
            subject: message.subject,
            text: message.text,
            html: message.html
        });
    }

    /**
     * Envio genérico (alertas, confirmações). `headers` aceita List-Unsubscribe etc.
     * @param {string} to
     * @param {{ subject: string, text: string, html: string, headers?: Record<string,string> }} message
     * @param {{ channel?: 'conta'|'alertas' }} [opts]  'alertas' usa o remetente de alertas
     */
    async sendMessage(to, message, { channel } = {}) {
        if (!this.isConfigured()) {
            const err = new Error('Envio de e-mail não configurado.');
            err.code = 'MAIL_NOT_CONFIGURED';
            throw err;
        }

        if (this.driver === 'console') {
            console.log(`
[MAIL:console] ✉  Para ${to}: ${message.subject}
${message.text}
`);
            return;
        }

        const from = this._fromFor(channel);

        if (this.driver === 'resend') {
            await this._sendViaResend(to, message, from);
            return;
        }

        await this._getTransporter().sendMail({
            from,
            to,
            subject: message.subject,
            text: message.text,
            html: message.html,
            headers: message.headers
        });
    }
}

module.exports = MailService;
