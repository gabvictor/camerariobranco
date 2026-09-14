/**
 * @controller SponsorController
 * Handlers HTTP para gestão e exibição de patrocinadores e planos.
 */
class SponsorController {
    /**
     * @param {import('../../../application/services/SponsorService')} sponsorService
     * @param {import('../../../application/use-cases/ManageSponsorUseCase')} manageSponsorUC
     * @param {import('../../../application/use-cases/GetSponsorPublicDataUseCase')} getPublicDataUC
     * @param {import('../../../infrastructure/services/SponsorLogoUploadService')} logoUploadService
     */
    constructor(sponsorService, manageSponsorUC, getPublicDataUC, logoUploadService) {
        this.sponsorService = sponsorService;
        this.manageSponsorUC = manageSponsorUC;
        this.getPublicDataUC = getPublicDataUC;
        this.logoUploadService = logoUploadService;

        // Binds
        this.getPublicData = this.getPublicData.bind(this);
        this.getSponsorForCamera = this.getSponsorForCamera.bind(this);
        this.getPublicPlans = this.getPublicPlans.bind(this);
        this.getAdminSponsors = this.getAdminSponsors.bind(this);
        this.getAdminSponsorById = this.getAdminSponsorById.bind(this);
        this.createSponsor = this.createSponsor.bind(this);
        this.updateSponsor = this.updateSponsor.bind(this);
        this.renewSponsor = this.renewSponsor.bind(this);
        this.toggleStatus = this.toggleStatus.bind(this);
        this.deleteSponsor = this.deleteSponsor.bind(this);
        this.uploadLogo = this.uploadLogo.bind(this);
        this.getAdminPlans = this.getAdminPlans.bind(this);
        this.updatePlan = this.updatePlan.bind(this);
    }

    // ─── Endpoints Públicos ───────────────────────────────────────────────────

    /** GET /api/sponsors/public */
    async getPublicData(req, res) {
        try {
            const data = await this.getPublicDataUC.getPublicOverview();
            res.setHeader('Cache-Control', 'public, max-age=60');
            return res.json(data);
        } catch (error) {
            console.error('[SPONSOR_PUBLIC_ERROR]', error);
            return res.status(500).json({ error: 'Erro ao carregar patrocinadores públicos.' });
        }
    }

    /** GET /api/sponsors/camera/:code */
    async getSponsorForCamera(req, res) {
        try {
            const code = req.params.code;
            const sponsor = await this.getPublicDataUC.getSponsorForCamera(code);
            res.setHeader('Cache-Control', 'public, max-age=120');
            return res.json({ sponsor });
        } catch (error) {
            console.error('[SPONSOR_CAMERA_ERROR]', error);
            return res.status(500).json({ error: 'Erro ao carregar patrocinador da câmera.' });
        }
    }

    /** GET /api/sponsors/plans */
    async getPublicPlans(req, res) {
        try {
            const plans = await this.sponsorService.sponsorRepo.getPlans();
            res.setHeader('Cache-Control', 'public, max-age=300');
            return res.json({ plans: plans.filter(p => p.ativo).map(p => p.toJSON()) });
        } catch (error) {
            console.error('[SPONSOR_PLANS_ERROR]', error);
            return res.status(500).json({ error: 'Erro ao consultar planos.' });
        }
    }

    // ─── Endpoints Administrativos ─────────────────────────────────────────────

    /** GET /api/admin/sponsors */
    async getAdminSponsors(req, res) {
        try {
            const [sponsors, stats] = await Promise.all([
                this.sponsorService.getAllEnriched(),
                this.sponsorService.getAdminDashboardStats()
            ]);

            res.setHeader('Cache-Control', 'no-store');
            return res.json({
                sponsors,
                stats
            });
        } catch (error) {
            console.error('[ADMIN_SPONSORS_ERROR]', error);
            return res.status(500).json({ error: 'Erro ao listar patrocinadores administrativos.' });
        }
    }

    /** GET /api/admin/sponsors/:id */
    async getAdminSponsorById(req, res) {
        try {
            const sponsor = await this.sponsorService.sponsorRepo.findById(req.params.id);
            if (!sponsor) {
                return res.status(404).json({ error: 'Patrocinador não encontrado.' });
            }
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ sponsor: sponsor.toJSON() });
        } catch (error) {
            console.error('[ADMIN_SPONSOR_BY_ID_ERROR]', error);
            return res.status(500).json({ error: 'Erro ao buscar patrocinador.' });
        }
    }

    /** POST /api/admin/sponsors */
    async createSponsor(req, res) {
        try {
            const adminEmail = (req.user && req.user.email) || 'admin';
            const created = await this.manageSponsorUC.create(req.body, adminEmail);
            return res.status(201).json({
                success: true,
                message: 'Patrocinador cadastrado com sucesso!',
                sponsor: created.toJSON()
            });
        } catch (error) {
            console.error('[ADMIN_CREATE_SPONSOR_ERROR]', error);
            return res.status(400).json({ error: error.message || 'Erro ao cadastrar patrocinador.' });
        }
    }

    /** PUT /api/admin/sponsors/:id */
    async updateSponsor(req, res) {
        try {
            const adminEmail = (req.user && req.user.email) || 'admin';
            const updated = await this.manageSponsorUC.update(req.params.id, req.body, adminEmail);
            return res.json({
                success: true,
                message: 'Patrocinador atualizado com sucesso!',
                sponsor: updated.toJSON()
            });
        } catch (error) {
            console.error('[ADMIN_UPDATE_SPONSOR_ERROR]', error);
            return res.status(400).json({ error: error.message || 'Erro ao atualizar patrocinador.' });
        }
    }

    /** POST /api/admin/sponsors/:id/renew */
    async renewSponsor(req, res) {
        try {
            const adminEmail = (req.user && req.user.email) || 'admin';
            const renewed = await this.manageSponsorUC.renew(req.params.id, req.body, adminEmail);
            return res.json({
                success: true,
                message: 'Contrato de patrocínio renovado com sucesso!',
                sponsor: renewed.toJSON()
            });
        } catch (error) {
            console.error('[ADMIN_RENEW_SPONSOR_ERROR]', error);
            return res.status(400).json({ error: error.message || 'Erro ao renovar patrocinador.' });
        }
    }

    /** PATCH /api/admin/sponsors/:id/status */
    async toggleStatus(req, res) {
        try {
            const { status } = req.body;
            if (!['ativo', 'inativo'].includes(status)) {
                return res.status(400).json({ error: 'Status deve ser "ativo" ou "inativo".' });
            }
            const updated = await this.manageSponsorUC.toggleStatus(req.params.id, status);
            return res.json({
                success: true,
                message: `Patrocinador marcado como ${status}!`,
                sponsor: updated.toJSON()
            });
        } catch (error) {
            console.error('[ADMIN_TOGGLE_STATUS_ERROR]', error);
            return res.status(400).json({ error: error.message || 'Erro ao alterar status.' });
        }
    }

    /** DELETE /api/admin/sponsors/:id */
    async deleteSponsor(req, res) {
        try {
            const success = await this.manageSponsorUC.delete(req.params.id);
            if (!success) {
                return res.status(404).json({ error: 'Patrocinador não encontrado para exclusão.' });
            }
            return res.json({ success: true, message: 'Patrocinador removido com sucesso.' });
        } catch (error) {
            console.error('[ADMIN_DELETE_SPONSOR_ERROR]', error);
            return res.status(500).json({ error: 'Erro ao excluir patrocinador.' });
        }
    }

    /** POST /api/admin/sponsors/upload-logo */
    async uploadLogo(req, res) {
        try {
            const { imageBase64, sponsorId } = req.body || {};
            if (!imageBase64) {
                return res.status(400).json({ error: 'Imagem Base64 é obrigatória.' });
            }

            const result = await this.logoUploadService.processAndSaveLogo(imageBase64, sponsorId);
            return res.json({
                success: true,
                url: result.url,
                fileName: result.fileName
            });
        } catch (error) {
            console.error('[ADMIN_UPLOAD_LOGO_ERROR]', error);
            return res.status(400).json({ error: error.message || 'Falha ao processar logotipo.' });
        }
    }

    /** GET /api/admin/sponsors/plans */
    async getAdminPlans(req, res) {
        try {
            const plans = await this.sponsorService.sponsorRepo.getPlans();
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ plans: plans.map(p => p.toJSON()) });
        } catch (error) {
            console.error('[ADMIN_PLANS_ERROR]', error);
            return res.status(500).json({ error: 'Erro ao carregar planos.' });
        }
    }

    /** PUT /api/admin/sponsors/plans/:id */
    async updatePlan(req, res) {
        try {
            const updated = await this.manageSponsorUC.updatePlan(req.params.id, req.body);
            return res.json({
                success: true,
                message: 'Plano atualizado com sucesso!',
                plan: updated.toJSON()
            });
        } catch (error) {
            console.error('[ADMIN_UPDATE_PLAN_ERROR]', error);
            return res.status(400).json({ error: error.message || 'Erro ao atualizar plano.' });
        }
    }
}

module.exports = SponsorController;
