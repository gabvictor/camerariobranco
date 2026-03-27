/**
 * @controller CameraController
 * Apenas trata HTTP: valida request, chama use-case, formata response.
 * Zero lógica de negócio — tudo delegado para use-cases e serviços.
 */
class CameraController {
    /**
     * @param {import('../../../application/services/CameraCache')} cameraCache
     * @param {import('../../../application/services/MetricsService')} metricsService
     * @param {import('../../../domain/contracts/ICameraRepository')} cameraRepository
     * @param {import('../../../application/use-cases/TrackVisitUseCase')} trackVisitUseCase
     */
    constructor(cameraCache, metricsService, cameraRepository, trackVisitUseCase) {
        this.cache       = cameraCache;
        this.metrics     = metricsService;
        this.cameraRepo  = cameraRepository;
        this.trackVisit  = trackVisitUseCase;

        // Bind para uso como middleware Express
        this.getStatuses     = this.getStatuses.bind(this);
        this.trackVisitRoute = this.trackVisitRoute.bind(this);
        this.getTraffic      = this.getTraffic.bind(this);
        this.getSimpleMetrics = this.getSimpleMetrics.bind(this);
        this.getSiteConfig   = this.getSiteConfig.bind(this);
        this.updateSiteConfig = this.updateSiteConfig.bind(this);
        this.updateCameraInfo = this.updateCameraInfo.bind(this);
    }

    /** GET /status-cameras */
    getStatuses(req, res) {
        const camerasWithViews = this.cache.getAll().map(cam => ({
            ...cam, views: this.metrics.topCameras[cam.codigo] || 0
        }));
        if (req.userIsAdmin) return res.json(camerasWithViews);
        res.json(camerasWithViews.filter(c => c.level === 1 || !c.level));
    }

    /** POST /api/track-visit */
    async trackVisitRoute(req, res) {
        try {
            await this.trackVisit.execute();
            res.status(200).send();
        } catch { res.status(500).send(); }
    }

    /** GET /api/traffic */
    async getTraffic(req, res) {
        try {
            const stats = await this.trackVisit.getStats();
            res.json(stats);
        } catch { res.status(500).json({ message: 'Erro ao obter tráfego.' }); }
    }

    /** GET /api/simple-metrics */
    getSimpleMetrics(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        res.json(this.metrics.getSnapshot());
    }

    /** GET /api/site-config */
    getSiteConfig(req, res) {
        res.json(this._siteConfig || { showAppBanner: true });
    }

    /** POST /api/site-config */
    async updateSiteConfig(req, res) {
        try {
            const newConfig = req.body;
            if (typeof newConfig.showAppBanner !== 'boolean') {
                return res.status(400).json({ message: 'Parâmetros inválidos.' });
            }
            this._siteConfig = { ...(this._siteConfig || {}), ...newConfig };
            await this._db.collection('site_config').doc('global').set(this._siteConfig, { merge: true });
            res.json({ success: true, config: this._siteConfig });
        } catch { res.status(500).json({ message: 'Erro ao salvar configuração.' }); }
    }

    /** Injeta db para operações de config (chamado no bootstrap) */
    setDb(db) { this._db = db; return this; }
    setSiteConfig(cfg) { this._siteConfig = cfg; return this; }

    /** POST /api/update-camera-info */
    async updateCameraInfo(req, res) {
        const { admin } = require('../../../config/firebaseAdmin');
        const Camera = require('../../../domain/entities/Camera');
        const { codigo, nome, categoria, descricao, coords, level } = req.body;

        if (!codigo || !nome) {
            return res.status(400).json({ message: 'Código e nome são obrigatórios.' });
        }

        let validCoords = null;
        if (coords) {
            if (Array.isArray(coords) && coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
                validCoords = coords.map(Number);
            } else {
                return res.status(400).json({ message: 'Coordenadas inválidas. Formato: [lat, lng].' });
            }
        }

        const validLevel = Number(level);
        if (isNaN(validLevel) || validLevel < 1 || validLevel > 3) {
            return res.status(400).json({ message: 'Nível de acesso inválido (1-3).' });
        }

        try {
            const camera = new Camera({ codigo, nome, categoria, descricao, coords: validCoords, level: validLevel });
            await this.cameraRepo.save(camera);
            // Update 'updatedBy' separately (domain entity doesn't track this)
            await this._db.collection('cameras').doc(codigo).update({
                updatedBy: req.user.email,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            await this.cameraRepo.refresh();
            res.status(200).json({ message: 'Câmera atualizada com sucesso!' });
        } catch (error) {
            console.error('[CAMERA_UPDATE_ERROR]', error);
            res.status(500).json({ message: 'Erro ao salvar câmera.' });
        }
    }
}

module.exports = CameraController;
