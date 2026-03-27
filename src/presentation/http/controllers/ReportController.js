const { admin } = require('../../../config/firebaseAdmin');

/**
 * @controller ReportController
 * Gerencia os endpoints de reportes de câmeras.
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
        this.createChangelog = this.createChangelog.bind(this);
        this.getConfig     = this.getConfig.bind(this);
    }

    setDb(db) { this._db = db; return this; }

    /** POST /api/report */
    async create(req, res) {
        try {
            const id = await this.createReport.execute({
                cameraId:   req.body.cameraId,
                issueType:  req.body.issueType,
                description: req.body.description,
                userEmail:  req.body.userEmail,
                userAgent:  req.headers['user-agent']
            });
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
            const { status } = req.body;
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
                    cameraId: docSnap.ref.parent.parent.id,
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

    /** POST /api/changelog */
    async createChangelog(req, res) {
        try {
            const { title, message } = req.body;
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

    /** GET /api/config */
    getConfig(req, res) {
        const { ADMIN_EMAIL } = require('../../../config/firebaseAdmin');
        res.json({ adminEmail: ADMIN_EMAIL });
    }
}

module.exports = ReportController;
