const { sanitizeCameraCode, sanitizeString, sanitizeMultiline, sanitizeEmail } = require('../../../utils/validation');
const { admin } = require('../../../config/firebaseAdmin');

/**
 * @controller ReportController
 * Gerencia os endpoints de reportes de câmeras e configurações administrativas.
 */
class ReportController {
    /**
     * @param {import('../../../application/use-cases/CreateReportUseCase')} createReportUseCase
     * @param {import('../../../domain/contracts/IReportRepository')} reportRepository
     */
    constructor(createReportUseCase, reportRepository) {
        this.createReport  = createReportUseCase;
        this.reportRepo    = reportRepository;

        this.create        = this.create.bind(this);
        this.list          = this.list.bind(this);
        this.updateStatus  = this.updateStatus.bind(this);
        this.delete        = this.delete.bind(this);
        this.listComments  = this.listComments.bind(this);
        this.deleteComment = this.deleteComment.bind(this);
        this.listSuggestions = this.listSuggestions.bind(this);
        this.updateSuggestionStatus = this.updateSuggestionStatus.bind(this);
        this.deleteSuggestion = this.deleteSuggestion.bind(this);
        this.createChangelog = this.createChangelog.bind(this);
        this.getConfig     = this.getConfig.bind(this);
        this.getMe         = this.getMe.bind(this);
    }

    setDb(db) { this._db = db; return this; }

    /** POST /api/report */
    async create(req, res) {
        try {
            const payload = {
                cameraId: sanitizeCameraCode(req.body.cameraId),
                issueType: sanitizeString(req.body.issueType, { maxLength: 80 }),
                description: sanitizeMultiline(req.body.description, { maxLength: 500 }),
                userEmail: sanitizeEmail(req.body.userEmail) || 'anônimo',
                userAgent: sanitizeString(req.headers['user-agent'], { maxLength: 255 })
            };

            const id = await this.createReport.execute(payload);
            res.status(200).json({ success: true, message: 'Reporte enviado com sucesso', id });
        } catch (error) {
            if (error.message.includes('obrigatório')) {
                return res.status(400).json({ error: error.message });
            }
            console.error('Erro ao salvar reporte:', error);
            res.status(500).json({ error: 'Erro interno ao processar reporte' });
        }
    }

    /** GET /api/reports */
    async list(req, res) {
        try {
            const reports = await this.reportRepo.findAll({ limit: 50 });
            res.setHeader('Cache-Control', 'no-store');
            res.json(reports);
        } catch { res.status(500).json({ error: 'Erro ao buscar reportes' }); }
    }

    /** PUT /api/report/:id/status */
    async updateStatus(req, res) {
        try {
            const status = sanitizeString(req.body.status, { maxLength: 20 });
            if (!status) return res.status(400).json({ error: 'Status é obrigatório' });
            await this.reportRepo.updateStatus(req.params.id, status);
            res.json({ success: true, message: 'Status atualizado' });
        } catch (error) {
            if (error.message.includes('não encontrado')) return res.status(404).json({ error: error.message });
            if (error.message.includes('inválido')) return res.status(400).json({ error: error.message });
            res.status(500).json({ error: 'Erro ao atualizar reporte' });
        }
    }

    /** DELETE /api/report/:id */
    async delete(req, res) {
        try {
            await this.reportRepo.delete(req.params.id);
            res.json({ success: true });
        } catch (error) {
            if (error.message.includes('não encontrado')) return res.status(404).json({ error: error.message });
            res.status(500).json({ error: 'Erro ao excluir reporte' });
        }
    }

    /** GET /api/comments */
    async listComments(req, res) {
        try {
            const limit = Math.min(Number(req.query.limit) || 200, 1000);
            const snapshot = await this._db.collectionGroup('comments').limit(limit).get();
            const items = snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    cameraId: docSnap.ref.parent?.parent?.id || 'desconhecido',
                    text: data.text || '',
                    userDisplayName: data.userDisplayName || '',
                    userId: data.userId || '',
                    timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
                };
            }).sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return tb - ta;
            });
            res.setHeader('Cache-Control', 'no-store');
            res.json(items);
        } catch { res.status(500).json({ error: 'Erro ao listar comentários' }); }
    }

    /** DELETE /api/comment/:cameraId/:id */
    async deleteComment(req, res) {
        try {
            const { cameraId, id } = req.params;
            const ref = this._db.collection('cameras').doc(cameraId).collection('comments').doc(id);
            if (!(await ref.get()).exists) return res.status(404).json({ error: 'Comentário não encontrado' });
            await ref.delete();
            res.json({ success: true });
        } catch { res.status(500).json({ error: 'Erro ao excluir comentário' }); }
    }

    /** GET /api/suggestions */
    async listSuggestions(req, res) {
        try {
            if (!this._db) return res.json([]);
            let snapshot;
            try {
                snapshot = await this._db.collection('suggestions').orderBy('createdAt', 'desc').limit(100).get();
            } catch (queryErr) {
                console.warn('Fallback sem orderBy para suggestions:', queryErr.message);
                snapshot = await this._db.collection('suggestions').limit(100).get();
            }

            const items = snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                let dateFormatted = 'Data não informada';
                if (data.createdAt) {
                    if (typeof data.createdAt.toDate === 'function') {
                        dateFormatted = data.createdAt.toDate().toLocaleString('pt-BR');
                    } else if (typeof data.createdAt === 'string' || typeof data.createdAt === 'number') {
                        dateFormatted = new Date(data.createdAt).toLocaleString('pt-BR');
                    }
                }
                return {
                    id: docSnap.id,
                    ...data,
                    createdAtFormatted: dateFormatted
                };
            });
            res.setHeader('Cache-Control', 'no-store');
            res.json(items);
        } catch (error) {
            console.error('Erro ao listar sugestões:', error);
            res.status(500).json({ error: 'Erro ao listar sugestões' });
        }
    }

    /** PUT /api/suggestion/:id/status */
    async updateSuggestionStatus(req, res) {
        try {
            if (!this._db) return res.status(500).json({ error: 'DB indisponível' });
            const { status } = req.body;
            await this._db.collection('suggestions').doc(req.params.id).update({
                status: status || 'lido'
            });
            res.json({ success: true, message: 'Status atualizado com sucesso' });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao atualizar sugestão' });
        }
    }

    /** DELETE /api/suggestion/:id */
    async deleteSuggestion(req, res) {
        try {
            if (!this._db) return res.status(500).json({ error: 'DB indisponível' });
            await this._db.collection('suggestions').doc(req.params.id).delete();
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao excluir sugestão' });
        }
    }

    /** POST /api/changelog */
    async createChangelog(req, res) {
        try {
            const title = sanitizeString(req.body.title, { maxLength: 120 });
            const message = sanitizeMultiline(req.body.message, { maxLength: 2000 });
            if (!title || !message) return res.status(400).json({ error: 'Título e Mensagem são obrigatórios' });
            const docRef = await this._db.collection('changelog').add({
                title, message,
                date: new Date().toLocaleDateString('pt-BR'),
                active: true,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            res.json({ success: true, message: 'Novidade publicada!', id: docRef.id });
        } catch { res.status(500).json({ error: 'Erro ao publicar novidade' }); }
    }

    /** GET /api/auth/me */
    getMe(req, res) {
        res.json({
            authenticated: Boolean(req.user),
            isAdmin: Boolean(req.userIsAdmin),
            email: req.user?.email || null
        });
    }

    /** GET /api/config */
    getConfig(req, res) {
        res.json({
            siteConfigured: true
        });
    }
}

module.exports = ReportController;
