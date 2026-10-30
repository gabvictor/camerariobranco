const { VerificationError } = require('../../../application/services/EmailVerificationService');

class EmailVerificationController {
    /** @param {import('../../../application/services/EmailVerificationService')} service */
    constructor(service) {
        this._service = service;
        this.sendCode = this.sendCode.bind(this);
        this.verifyCode = this.verifyCode.bind(this);
    }

    _fail(res, error) {
        if (error instanceof VerificationError) {
            if (error.extra?.retryAfter) res.setHeader('Retry-After', String(error.extra.retryAfter));
            return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
        }
        console.error('[EMAIL_VERIFICATION] Erro inesperado:', error);
        return res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.', code: 'INTERNAL' });
    }

    /** POST /api/auth/send-code — requer ID token (e-mail ainda não verificado) */
    async sendCode(req, res) {
        try {
            const result = await this._service.sendCode({ uid: req.user.uid });
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ sent: !result.alreadyVerified, ...result });
        } catch (error) {
            return this._fail(res, error);
        }
    }

    /** POST /api/auth/verify-code  body: { code: "123456" } */
    async verifyCode(req, res) {
        try {
            const result = await this._service.verifyCode({ uid: req.user.uid, code: req.body?.code });
            res.setHeader('Cache-Control', 'no-store');
            return res.json(result);
        } catch (error) {
            return this._fail(res, error);
        }
    }
}

module.exports = EmailVerificationController;
