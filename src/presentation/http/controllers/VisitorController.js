/**
 * Perfis de visitantes: painel do admin e aviso de "aba em segundo plano" vindo do navegador.
 */
class VisitorController {
    /** @param {import('../../../application/services/VisitorSessionService')} service */
    constructor(service) {
        this._service = service;
        this.live = this.live.bind(this);
        this.summary = this.summary.bind(this);
        this.sessions = this.sessions.bind(this);
        this.visibility = this.visibility.bind(this);
    }

    _fail(res, error, tag) {
        console.error(`[VISITANTES] ${tag}:`, error);
        res.status(500).json({ error: 'Erro ao carregar os dados de visitantes.' });
    }

    /** GET /api/admin/visitantes/ao-vivo */
    live(req, res) {
        try {
            res.setHeader('Cache-Control', 'no-store');
            res.json({ visitantes: this._service.live() });
        } catch (error) {
            this._fail(res, error, 'ao-vivo');
        }
    }

    /** GET /api/admin/visitantes/resumo?dias=7 */
    async summary(req, res) {
        try {
            res.setHeader('Cache-Control', 'no-store');
            res.json(await this._service.summary(req.query.dias));
        } catch (error) {
            this._fail(res, error, 'resumo');
        }
    }

    /** GET /api/admin/visitantes/sessoes?dias=7&limite=200&camera=1&logados=1&min=30 */
    async sessions(req, res) {
        try {
            res.setHeader('Cache-Control', 'no-store');
            const q = req.query;
            const sessoes = await this._service.sessions({
                days: q.dias,
                limit: q.limite,
                onlyCamera: q.camera === '1',
                onlyLogged: q.logados === '1',
                minSeconds: q.min
            });
            res.json({ sessoes });
        } catch (error) {
            this._fail(res, error, 'sessoes');
        }
    }

    /** POST /api/presence/visibility — o navegador avisa quando a aba vai para segundo plano ou volta. */
    visibility(req, res) {
        const { tabId, hidden } = req.body || {};
        if (typeof tabId === 'string' && /^[\w-]{6,80}$/.test(tabId) && typeof hidden === 'boolean') {
            this._service.setHidden(tabId, hidden);
        }
        res.status(204).end();
    }
}

module.exports = VisitorController;
