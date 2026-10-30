const crypto = require('crypto');

const COLLECTION = 'emailVerifications';

const DEFAULT_OPTIONS = {
    codeTtlMs: 10 * 60 * 1000,        // validade do código
    resendCooldownMs: 60 * 1000,      // intervalo mínimo entre envios
    maxAttempts: 5,                   // tentativas erradas por código
    maxSendsPerHour: 5                // envios por hora, por conta
};

class VerificationError extends Error {
    constructor(status, code, message, extra = {}) {
        super(message);
        this.name = 'VerificationError';
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

/**
 * EmailVerificationService — verificação de e-mail por código numérico de 6 dígitos.
 *
 * - O código nunca é guardado em texto puro: apenas HMAC-SHA256 com salt aleatório.
 * - Os documentos ficam na coleção `emailVerifications` (somente Admin SDK; as regras
 *   do Firestore não liberam essa coleção para clientes).
 * - Ao validar, marca `emailVerified: true` no Firebase Auth, o que passa a valer no
 *   claim `email_verified` do ID token (usado pelo servidor e pelas regras do Firestore).
 */
class EmailVerificationService {
    /**
     * @param {{ db: any, admin: any, mailService: any, now?: () => number, options?: Partial<typeof DEFAULT_OPTIONS> }} deps
     */
    constructor({ db, admin, mailService, now = () => Date.now(), options = {} }) {
        this._db = db;
        this._admin = admin;
        this._mail = mailService;
        this._now = now;
        this._opts = { ...DEFAULT_OPTIONS, ...options };
    }

    get options() {
        return { ...this._opts };
    }

    _ref(uid) {
        return this._db.collection(COLLECTION).doc(uid);
    }

    _hash(code, salt) {
        return crypto.createHmac('sha256', salt).update(code).digest('hex');
    }

    _generateCode() {
        return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    }

    /**
     * Gera um novo código e envia por e-mail.
     * @returns {Promise<{ alreadyVerified?: boolean, cooldownSeconds?: number, expiresInMinutes?: number }>}
     */
    async sendCode({ uid }) {
        if (!this._mail.isConfigured()) {
            throw new VerificationError(503, 'MAIL_NOT_CONFIGURED',
                'O envio de e-mails não está configurado no servidor. Avise o administrador do site.');
        }

        const userRecord = await this._admin.auth().getUser(uid);
        if (userRecord.emailVerified) return { alreadyVerified: true };
        if (!userRecord.email) {
            throw new VerificationError(400, 'NO_EMAIL', 'Esta conta não possui e-mail.');
        }

        const { codeTtlMs, resendCooldownMs, maxSendsPerHour } = this._opts;
        const code = this._generateCode();
        const salt = crypto.randomBytes(16).toString('hex');
        const codeHash = this._hash(code, salt);
        const ref = this._ref(uid);
        const hourMs = 60 * 60 * 1000;

        await this._db.runTransaction(async (t) => {
            const now = this._now();
            const snap = await t.get(ref);
            const data = snap.exists ? snap.data() : {};

            const sinceLast = now - (data.lastSentAt || 0);
            if (sinceLast < resendCooldownMs) {
                throw new VerificationError(429, 'RESEND_COOLDOWN',
                    'Aguarde um pouco antes de pedir um novo código.',
                    { retryAfter: Math.ceil((resendCooldownMs - sinceLast) / 1000) });
            }

            const sendTimes = (data.sendTimes || []).filter(ts => now - ts < hourMs);
            if (sendTimes.length >= maxSendsPerHour) {
                throw new VerificationError(429, 'TOO_MANY_SENDS',
                    'Você pediu códigos demais. Tente novamente mais tarde.',
                    { retryAfter: Math.ceil((sendTimes[0] + hourMs - now) / 1000) });
            }
            sendTimes.push(now);

            t.set(ref, {
                email: userRecord.email,
                codeHash,
                salt,
                attempts: 0,
                expiresAt: now + codeTtlMs,
                lastSentAt: now,
                sendTimes
            });
        });

        try {
            await this._mail.sendVerificationCode(userRecord.email, code, {
                name: userRecord.displayName || '',
                expiresInMinutes: Math.round(codeTtlMs / 60000)
            });
        } catch (error) {
            console.error('[EMAIL_VERIFICATION] Falha ao enviar e-mail:', error.message);
            // Invalida o código que não chegou e libera um novo pedido imediato.
            try {
                await ref.update({ codeHash: null, lastSentAt: 0 });
            } catch (_) { /* melhor esforço */ }
            throw new VerificationError(502, 'MAIL_SEND_FAILED',
                'Não foi possível enviar o e-mail agora. Confira o endereço e tente novamente.');
        }

        return {
            cooldownSeconds: Math.round(resendCooldownMs / 1000),
            expiresInMinutes: Math.round(codeTtlMs / 60000)
        };
    }

    /**
     * Confere o código digitado. Em caso de sucesso, marca o e-mail como verificado.
     * @returns {Promise<{ verified: true }>}
     * @throws {VerificationError}
     */
    async verifyCode({ uid, code }) {
        const clean = String(code ?? '').trim();
        if (!/^\d{6}$/.test(clean)) {
            throw new VerificationError(400, 'INVALID_FORMAT', 'Digite o código de 6 dígitos.');
        }

        const userRecord = await this._admin.auth().getUser(uid);
        if (userRecord.emailVerified) return { verified: true };

        const ref = this._ref(uid);
        const { maxAttempts } = this._opts;
        let outcome;

        await this._db.runTransaction(async (t) => {
            const now = this._now();
            const snap = await t.get(ref);
            const data = snap.exists ? snap.data() : null;

            const sameEmail = data && data.email
                && String(data.email).toLowerCase() === String(userRecord.email || '').toLowerCase();

            if (!data || !data.codeHash || !sameEmail) {
                outcome = { error: new VerificationError(400, 'NO_CODE', 'Nenhum código ativo. Peça um novo código.') };
                return;
            }

            if (now > data.expiresAt) {
                t.update(ref, { codeHash: null });
                outcome = { error: new VerificationError(400, 'EXPIRED', 'O código expirou. Peça um novo código.') };
                return;
            }

            if ((data.attempts || 0) >= maxAttempts) {
                t.update(ref, { codeHash: null });
                outcome = { error: new VerificationError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas erradas. Peça um novo código.') };
                return;
            }

            const expected = Buffer.from(data.codeHash, 'hex');
            const received = Buffer.from(this._hash(clean, data.salt), 'hex');
            const match = expected.length === received.length && crypto.timingSafeEqual(expected, received);

            if (!match) {
                const attempts = (data.attempts || 0) + 1;
                if (attempts >= maxAttempts) {
                    t.update(ref, { attempts, codeHash: null });
                    outcome = { error: new VerificationError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas erradas. Peça um novo código.') };
                } else {
                    t.update(ref, { attempts });
                    outcome = {
                        error: new VerificationError(400, 'INVALID_CODE', 'Código incorreto.',
                            { remainingAttempts: maxAttempts - attempts })
                    };
                }
                return;
            }

            t.delete(ref);
            outcome = { ok: true };
        });

        if (!outcome.ok) throw outcome.error;

        await this._admin.auth().updateUser(uid, { emailVerified: true });
        return { verified: true };
    }
}

module.exports = EmailVerificationService;
module.exports.VerificationError = VerificationError;
