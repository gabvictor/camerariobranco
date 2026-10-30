const { AlertError } = require('../../../application/services/RioAlertService');

const escapeHtml = (value) => String(value ?? '').replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&#39;', '"': '&quot;'
}[c]));

const pageHtml = (title, bodyHtml) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} | CamRB</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;padding:16px;box-sizing:border-box}
  .card{max-width:420px;width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;text-align:center}
  h1{font-size:20px;margin:0 0 12px} p{line-height:1.5;color:#4b5563;margin:0 0 20px}
  button,a.btn{display:inline-block;background:#4f46e5;color:#fff;border:0;border-radius:10px;padding:12px 24px;font-weight:bold;font-size:15px;text-decoration:none;cursor:pointer}
  a.link{color:#4f46e5}
</style>
</head>
<body><div class="card">${bodyHtml}</div></body>
</html>`;

class AlertController {
    /** @param {import('../../../application/services/RioAlertService')} service */
    constructor(service) {
        this._service = service;
        this.subscribe = this.subscribe.bind(this);
        this.confirm = this.confirm.bind(this);
        this.unsubscribePage = this.unsubscribePage.bind(this);
        this.unsubscribe = this.unsubscribe.bind(this);
        this.levels = this.levels.bind(this);
    }

    levels(req, res) {
        res.json({ niveis: this._service.levels() });
    }

    async subscribe(req, res) {
        try {
            const { email, niveis, consentimento } = req.body || {};
            await this._service.subscribe({ email, niveis, consent: consentimento === true });
            res.json({
                ok: true,
                mensagem: 'Pronto! Se o e-mail estiver correto, enviamos um link de confirmação. Os alertas só começam depois que você clicar nele.'
            });
        } catch (error) {
            if (error instanceof AlertError) {
                return res.status(error.status).json({ error: error.message, code: error.code });
            }
            console.error('[RIO_ALERT] Erro inesperado ao inscrever:', error);
            res.status(500).json({ error: 'Erro interno. Tente novamente.' });
        }
    }

    /** GET /api/alertas/confirmar — link do e-mail de confirmação. */
    async confirm(req, res) {
        try {
            const ok = await this._service.confirm(String(req.query.id || ''), String(req.query.t || ''));
            res.redirect(`/rio?alertas=${ok ? 'confirmado' : 'invalido'}`);
        } catch (error) {
            console.error('[RIO_ALERT] Erro ao confirmar:', error);
            res.redirect('/rio?alertas=invalido');
        }
    }

    /**
     * GET /alertas/cancelar — mostra um botão. O cancelamento só acontece no POST, porque
     * antivírus/leitores de e-mail abrem links (GET) automaticamente e cancelariam sem querer.
     */
    unsubscribePage(req, res) {
        const id = escapeHtml(req.query.id || '');
        const t = escapeHtml(req.query.t || '');
        res.setHeader('Cache-Control', 'no-store');
        res.send(pageHtml('Cancelar alertas', `
            <h1>Deixar de receber alertas?</h1>
            <p>Você não receberá mais e-mails sobre o nível do Rio Acre.</p>
            <form method="POST" action="/api/alertas/cancelar?id=${id}&t=${t}">
                <button type="submit">Sim, cancelar alertas</button>
            </form>`));
    }

    /** POST /api/alertas/cancelar — do botão acima e do "um clique" (List-Unsubscribe-Post) dos provedores. */
    async unsubscribe(req, res) {
        try {
            const ok = await this._service.unsubscribe(String(req.query.id || ''), String(req.query.t || ''));
            const wantsJson = (req.headers['content-type'] || '').includes('json') || !(req.headers.accept || '').includes('html');
            if (!ok) {
                if (wantsJson) return res.status(400).json({ error: 'Link inválido.' });
                return res.status(400).send(pageHtml('Link inválido', '<h1>Link inválido</h1><p>Este link de cancelamento não é válido.</p><a class="link" href="/rio">Voltar</a>'));
            }
            if (wantsJson) return res.json({ ok: true });
            res.send(pageHtml('Alertas cancelados', `
                <h1>Pronto, alertas cancelados</h1>
                <p>Você não receberá mais e-mails sobre o Rio Acre. Se mudar de ideia, é só se inscrever de novo na página do rio.</p>
                <a class="btn" href="/rio">Ir para a página do rio</a>`));
        } catch (error) {
            console.error('[RIO_ALERT] Erro ao cancelar:', error);
            res.status(500).json({ error: 'Erro interno. Tente novamente.' });
        }
    }
}

module.exports = AlertController;
