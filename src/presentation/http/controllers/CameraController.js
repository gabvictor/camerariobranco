const { sanitizeCameraCode, sanitizeString, sanitizeMultiline } = require('../../../utils/validation');
const { extractClientIp } = require('../../../utils/geoUtils');
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
        this.getStatuses       = this.getStatuses.bind(this);
        this.trackVisitRoute   = this.trackVisitRoute.bind(this);
        this.getTraffic        = this.getTraffic.bind(this);
        this.getSimpleMetrics  = this.getSimpleMetrics.bind(this);
        this.getSiteConfig     = this.getSiteConfig.bind(this);
        this.updateSiteConfig  = this.updateSiteConfig.bind(this);
        this.updateCameraInfo  = this.updateCameraInfo.bind(this);
        this.getRioAcre               = this.getRioAcre.bind(this);
        this.getRioAcreHistorico      = this.getRioAcreHistorico.bind(this);
        this.getTimelapse             = this.getTimelapse.bind(this);
        this.getAvailableTimelapses   = this.getAvailableTimelapses.bind(this);
        this.submitContactSuggestion  = this.submitContactSuggestion.bind(this);
        this.getTimelapseAdminStats   = this.getTimelapseAdminStats.bind(this);
        this.updateTimelapseConfig    = this.updateTimelapseConfig.bind(this);
        this.captureTimelapseNow      = this.captureTimelapseNow.bind(this);
        this.deleteTimelapseAll       = this.deleteTimelapseAll.bind(this);
        this.getOnlineCamerasForAnalysis = this.getOnlineCamerasForAnalysis.bind(this);
        this.generateContactSheet        = this.generateContactSheet.bind(this);
    }

    setRioAcreService(service) { this._rioAcreService = service; return this; }
    setTimelapseScheduler(scheduler) { this._timelapseScheduler = scheduler; return this; }

    /** GET /api/rio-acre */
    async getRioAcre(req, res) {
        try {
            if (!this._rioAcreService) {
                const RioAcreService = require('../../../infrastructure/services/RioAcreService');
                this._rioAcreService = new RioAcreService();
            }
            const data = await this._rioAcreService.getNivelRioAcre();
            res.setHeader('Cache-Control', 'public, max-age=300');
            res.json(data);
        } catch (error) {
            console.error('[RIO_ACRE_ERROR]', error.message);
            res.status(500).json({ error: 'Erro ao consultar nível do Rio Acre' });
        }
    }

    /** GET /api/rio-acre/historico */
    async getRioAcreHistorico(req, res) {
        try {
            if (!this._rioAcreService) {
                const RioAcreService = require('../../../infrastructure/services/RioAcreService');
                this._rioAcreService = new RioAcreService();
            }
            const dias = Math.max(1, Math.min(60, parseInt(req.query.dias, 10) || 30));
            const data = await this._rioAcreService.getHistoricoRioAcre(dias);
            res.setHeader('Cache-Control', 'public, max-age=1800');
            res.json(data);
        } catch (error) {
            console.error('[RIO_ACRE_HISTORICO_ERROR]', error.message);
            res.status(500).json({ error: 'Erro ao consultar histórico do Rio Acre' });
        }
    }

    /** GET /api/timelapse/:code */
    getTimelapse(req, res) {
        const code = sanitizeCameraCode(req.params.code || req.query.code);
        if (!code) return res.status(400).json({ error: 'Código de câmera inválido' });

        if (!this._timelapseScheduler) {
            return res.json([]);
        }

        const frames = this._timelapseScheduler.getFrames(code);
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(frames);
    }

    /** GET /api/timelapses-available */
    getAvailableTimelapses(req, res) {
        if (!this._timelapseScheduler) {
            return res.json([]);
        }
        const cameras = this._timelapseScheduler.getAvailableCamerasWithTimelapses();
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(cameras);
    }

    /** POST /api/contact */
    async submitContactSuggestion(req, res) {
        try {
            const { tipo, nome, email, mensagem, cameraOuLocal } = req.body || {};

            if (!mensagem || typeof mensagem !== 'string' || mensagem.trim().length < 5) {
                return res.status(400).json({ error: 'Por favor, forneça uma mensagem válida com pelo menos 5 caracteres.' });
            }

            if (mensagem.length > 3000) {
                return res.status(400).json({ error: 'A mensagem é muito longa (máximo 3000 caracteres).' });
            }

            const cleanData = {
                tipo: (tipo || 'sugestao').slice(0, 50),
                nome: (nome || 'Anônimo').slice(0, 100),
                email: (email || '').slice(0, 150),
                cameraOuLocal: (cameraOuLocal || '').slice(0, 200),
                mensagem: mensagem.trim(),
                createdAt: new Date(),
                status: 'pendente'
            };

            if (this._db) {
                await this._db.collection('suggestions').add(cleanData);
            }

            return res.status(201).json({ success: true, message: 'Mensagem enviada com sucesso! Obrigado pela sua contribuição.' });
        } catch (error) {
            console.error('[CONTACT_SUBMIT_ERROR]', error);
            return res.status(500).json({ error: 'Falha ao salvar sua mensagem. Tente novamente mais tarde.' });
        }
    }

    /** GET /api/timelapse-admin/stats */
    getTimelapseAdminStats(req, res) {
        if (!this._timelapseScheduler) return res.json({ totalFrames: 0, cameraCount: 0 });
        res.setHeader('Cache-Control', 'no-store');
        res.json(this._timelapseScheduler.getStats());
    }

    /** POST /api/timelapse-admin/config */
    async updateTimelapseConfig(req, res) {
        try {
            const minutes = parseInt(req.body.intervalMinutes, 10);
            if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
                return res.status(400).json({ error: 'Intervalo inválido (1 a 1440 minutos).' });
            }

            if (this._timelapseScheduler) {
                this._timelapseScheduler.setIntervalMinutes(minutes);
            }

            if (this._db) {
                await this._db.collection('site_config').doc('global').set({
                    timelapseIntervalMinutes: minutes
                }, { merge: true });
            }

            res.json({ success: true, message: `Intervalo alterado para ${minutes} minutos.`, intervalMinutes: minutes });
        } catch (error) {
            console.error('[TIMELAPSE_CONFIG_ERROR]', error);
            res.status(500).json({ error: 'Erro ao salvar configuração do timelapse.' });
        }
    }

    /** POST /api/timelapse-admin/capture-now */
    async captureTimelapseNow(req, res) {
        try {
            if (!this._timelapseScheduler) return res.status(500).json({ error: 'TimelapseScheduler não inicializado.' });
            const stats = await this._timelapseScheduler.captureNow();
            res.json({ success: true, message: 'Captura manual realizada com sucesso!', stats });
        } catch (error) {
            console.error('[TIMELAPSE_CAPTURE_NOW_ERROR]', error);
            res.status(500).json({ error: 'Erro ao executar captura manual.' });
        }
    }

    /** DELETE /api/timelapse-admin/delete-all */
    deleteTimelapseAll(req, res) {
        try {
            if (!this._timelapseScheduler) return res.status(500).json({ error: 'TimelapseScheduler não inicializado.' });
            const result = this._timelapseScheduler.deleteAllFrames();
            res.json(result);
        } catch (error) {
            console.error('[TIMELAPSE_DELETE_ALL_ERROR]', error);
            res.status(500).json({ error: 'Erro ao excluir snapshots.' });
        }
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
            const rawCookie = req.headers.cookie || '';
            const body = req.body || {};
            const force = body.force === true;

            if (!force && rawCookie.includes('camrb_visited_today=1')) {
                return res.status(200).json({ status: 'already_tracked' });
            }

            const ip = extractClientIp(req);
            const userAgent = req.headers['user-agent'] || '';
            const referrer = body.referrer || req.headers['referer'] || req.headers['referrer'] || '';

            const visitRecord = await this.trackVisit.execute({
                referrer,
                utm_source: body.utm_source,
                utm_medium: body.utm_medium,
                utm_campaign: body.utm_campaign,
                path: body.path || req.originalUrl,
                ip,
                userAgent,
                screenWidth: Number(body.screenWidth) || 0,
                headers: req.headers
            });

            res.setHeader('Set-Cookie', 'camrb_visited_today=1; Path=/; Max-Age=86400; SameSite=Lax');
            res.status(200).json({
                status: 'tracked',
                origin: visitRecord.source,
                location: `${visitRecord.city}, ${visitRecord.region}`
            });
        } catch (error) {
            console.error('[TrackVisit] Erro ao registrar visita:', error);
            res.status(500).json({ error: 'Erro ao registrar visita' });
        }
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
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            showAppBanner: true,
            cameraStreamIntervalMs: this.getStreamIntervalMs(),
            ...(this._siteConfig || {})
        });
    }

    /** POST /api/site-config */
    async updateSiteConfig(req, res) {
        try {
            const newConfig = req.body || {};
            const updates = {};

            if (typeof newConfig.showAppBanner === 'boolean') {
                updates.showAppBanner = newConfig.showAppBanner;
            }

            if (newConfig.cameraStreamIntervalMs !== undefined) {
                const interval = parseInt(newConfig.cameraStreamIntervalMs, 10);
                if (isNaN(interval) || interval < 0 || interval > 60000) {
                    return res.status(400).json({ message: 'Intervalo de câmera inválido (0 a 60.000 ms).' });
                }
                updates.cameraStreamIntervalMs = interval;
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ message: 'Nenhum parâmetro válido fornecido.' });
            }

            this._siteConfig = { ...(this._siteConfig || {}), ...updates };
            if (this._db) {
                await this._db.collection('site_config').doc('global').set(this._siteConfig, { merge: true });
            }
            res.json({ success: true, config: this._siteConfig, message: 'Configurações atualizadas com sucesso!' });
        } catch (err) {
            console.error('[SITE_CONFIG_UPDATE_ERROR]', err);
            res.status(500).json({ message: 'Erro ao salvar configuração.' });
        }
    }

    /** Injeta db para operações de config (chamado no bootstrap) */
    setDb(db) { this._db = db; return this; }
    setSiteConfig(cfg) { this._siteConfig = cfg || {}; return this; }
    getStreamIntervalMs() {
        if (this._siteConfig && typeof this._siteConfig.cameraStreamIntervalMs === 'number') {
            return this._siteConfig.cameraStreamIntervalMs;
        }
        return 0; // Padrão 0ms (velocidade máxima)
    }

    /** POST /api/update-camera-info */
    async updateCameraInfo(req, res) {
        const { admin } = require('../../../config/firebaseAdmin');
        const Camera = require('../../../domain/entities/Camera');
        const codigo = sanitizeCameraCode(req.body.codigo);
        const nome = sanitizeString(req.body.nome, { maxLength: 120 });
        const categoria = sanitizeString(req.body.categoria, { maxLength: 80, fallback: 'Sem Categoria' });
        const descricao = sanitizeMultiline(req.body.descricao, { maxLength: 500 });
        const { coords, level } = req.body;

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
            await this._db.collection('cameras').doc(codigo).set({
                updatedBy: req.user?.email || req.user?.uid || 'admin',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            await this.cameraRepo.refresh();
            res.status(200).json({ message: 'Câmera atualizada com sucesso!' });
        } catch (error) {
            console.error('[CAMERA_UPDATE_ERROR]', error);
            res.status(500).json({ message: 'Erro ao salvar câmera.' });
        }
    }

    /**
     * GET /api/admin/cameras/online-analysis
     * Retorna apenas as câmeras online com dados reais para o painel de análise.
     */
    getOnlineCamerasForAnalysis(req, res) {
        try {
            const onlineList = this.cache.getOnline().map(cam => ({
                codigo: cam.codigo,
                nome: cam.nome,
                categoria: cam.categoria || 'Sem Categoria',
                coords: cam.coords || null,
                status: cam.status || 'online',
                level: cam.level || 1,
                views: this.metrics.topCameras[cam.codigo] || 0
            }));

            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            return res.json({
                totalOnline: onlineList.length,
                cameras: onlineList
            });
        } catch (error) {
            console.error('[ONLINE_ANALYSIS_ERROR]', error);
            return res.status(500).json({ error: 'Erro ao listar câmeras online para análise.' });
        }
    }

    /**
     * GET /api/admin/cameras/contact-sheet
     * Monta e retorna uma imagem JPEG única (contact sheet) com todas as câmeras online.
     */
    async generateContactSheet(req, res) {
        try {
            const onlineCameras = this.cache.getOnline();
            if (!onlineCameras || onlineCameras.length === 0) {
                return res.status(404).json({ error: 'Nenhuma câmera online disponível no momento.' });
            }

            if (!this._contactSheetService) {
                const ContactSheetService = require('../../../infrastructure/services/ContactSheetService');
                this._contactSheetService = new ContactSheetService();
            }

            const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
            const jpegBuffer = await this._contactSheetService.generateContactSheet(onlineCameras, forceRefresh);

            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
            res.setHeader('Content-Disposition', `inline; filename="camrb-contact-sheet-${Date.now()}.jpg"`);
            return res.send(jpegBuffer);
        } catch (error) {
            console.error('[CONTACT_SHEET_ERROR]', error);
            return res.status(500).json({ error: 'Falha ao gerar o painel de análise: ' + error.message });
        }
    }
}

module.exports = CameraController;
