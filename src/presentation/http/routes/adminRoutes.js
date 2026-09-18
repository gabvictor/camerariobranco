const express = require('express');
const { verifyAuth, verifyAdmin, verifyOptionalAdmin, createRateLimiter } = require('../../../middlewares/security');

/**
 * @routes adminRoutes
 * Rotas administrativas — reportes, comentários, changelog, dashboard e status de autenticação.
 *
 * @param {import('../controllers/ReportController')} reportController
 * @param {import('../controllers/DashboardController')} dashboardController
 * @param {Object} [deps] Dependências adicionais para monitoramento e operações
 */
function adminRoutes(reportController, dashboardController, deps = {}) {
    const router = express.Router();
    const {
        healthCheckService,
        scheduler,
        cameraRepo,
        cameraCache,
        resourceMonitor,
        mjpegStreams,
        metrics,
        timelapseScheduler,
        rioAcreService
    } = deps;

    // Rate limiter para envio público de reportes (máximo 10 por minuto por IP)
    const reportRateLimiter = createRateLimiter({
        windowMs: 60 * 1000,
        max: 10,
        message: 'Muitos reportes enviados. Aguarde um minuto antes de tentar novamente.'
    });

    // Rate limiter para envio de comentários (máximo 15 por minuto por IP/usuário)
    const commentRateLimiter = createRateLimiter({
        windowMs: 60 * 1000,
        max: 15,
        message: 'Muitos comentários enviados recentemente. Aguarde um momento antes de enviar outro.'
    });

    // Reports
    router.post('/report',              reportRateLimiter, reportController.create);
    router.get('/reports',              verifyAdmin,       reportController.list);
    router.put('/report/:id/status',    verifyAdmin,       reportController.updateStatus);
    router.delete('/report/:id',        verifyAdmin,       reportController.delete);

    // Suggestions / Contato
    router.get('/suggestions',          verifyAdmin,       reportController.listSuggestions);
    router.put('/suggestion/:id/status', verifyAdmin,      reportController.updateSuggestionStatus);
    router.delete('/suggestion/:id',    verifyAdmin,       reportController.deleteSuggestion);

    // Comments
    router.post('/comment',                 commentRateLimiter, verifyAuth, reportController.createComment);
    router.get('/comments/:cameraId',       reportController.listCameraComments);
    router.get('/comments',                 verifyAdmin,        reportController.listComments);
    router.delete('/comment/:cameraId/:id', verifyAuth,         reportController.deleteComment);

    // Changelog
    router.post('/changelog',           verifyAdmin,       reportController.createChangelog);

    // Dashboard
    router.get('/dashboard-data',       verifyAdmin,       dashboardController.getDashboard);

    // ─── Central de Monitoramento & NOC ──────────────────────────────────────────

    // Diagnóstico ativo de dependências e subsistemas
    router.get('/admin/ops/diagnostic', verifyAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            if (!healthCheckService) {
                const HealthCheckService = require('../../../application/services/HealthCheckService');
                const tempHealth = new HealthCheckService(rioAcreService, cameraRepo);
                const diagnostic = await tempHealth.runFullDiagnostic();
                return res.json(diagnostic);
            }
            const diagnostic = await healthCheckService.runFullDiagnostic();
            res.json(diagnostic);
        } catch (error) {
            console.error('[DIAGNOSTIC_ERROR]', error);
            res.status(500).json({ error: error.message || 'Erro ao executar diagnóstico' });
        }
    });

    // Forçar varredura manual de câmeras sob demanda
    router.post('/admin/ops/trigger-scan', verifyAdmin, async (req, res) => {
        try {
            if (!scheduler) {
                return res.status(500).json({ error: 'Serviço de agendamento não disponível.' });
            }
            if (scheduler.isScanning) {
                return res.json({ success: true, message: 'Varredura já está em andamento.' });
            }
            // Dispara assincronamente e retorna status
            scheduler.triggerNow().catch(err => console.error('[TRIGGER_SCAN_ERR]', err));
            res.json({ success: true, message: 'Varredura de câmeras disparada com sucesso!' });
        } catch (error) {
            console.error('[TRIGGER_SCAN_ERROR]', error);
            res.status(500).json({ error: error.message || 'Erro ao disparar varredura' });
        }
    });

    // Recarregar/limpar cache de câmeras
    router.post('/admin/ops/clear-cache', verifyAdmin, async (req, res) => {
        try {
            if (cameraRepo && cameraRepo.refresh) {
                await cameraRepo.refresh();
            }
            if (cameraCache && cameraRepo) {
                const all = await cameraRepo.findAll();
                cameraCache.update([], all);
            }
            res.json({ success: true, message: 'Cache de câmeras recarregado com sucesso a partir do banco de dados!' });
        } catch (error) {
            console.error('[CLEAR_CACHE_ERROR]', error);
            res.status(500).json({ error: error.message || 'Erro ao recarregar cache' });
        }
    });

    // Logs & Resource Monitor (SSE Stream e REST)
    router.get('/admin/logs/stream', verifyAdmin, (req, res) => {
        const logger = require('../../../infrastructure/logging/SystemLogger');
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        // Envia os logs existentes na conexão inicial
        const initialData = {
            logs: logger.getLogs({ limit: 250 }),
            stats: logger.getStats()
        };
        res.write(`event: init\ndata: ${JSON.stringify(initialData)}\n\n`);

        // Transmite cada novo log assim que ele acontece
        const onLog = (entry) => {
            try {
                if (!res.writableEnded && !res.closed) {
                    res.write(`event: log\ndata: ${JSON.stringify({ entry, stats: logger.getStats() })}\n\n`);
                }
            } catch (_) {}
        };

        logger.on('log', onLog);

        req.on('close', () => {
            logger.off('log', onLog);
        });
    });

    router.get('/admin/logs', verifyAdmin, (req, res) => {
        const logger = require('../../../infrastructure/logging/SystemLogger');
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            logs: logger.getLogs(req.query),
            stats: logger.getStats()
        });
    });

    router.delete('/admin/logs', verifyAdmin, (req, res) => {
        const logger = require('../../../infrastructure/logging/SystemLogger');
        logger.clear();
        res.json({ success: true, message: 'Logs limpos com sucesso.' });
    });

    // Config & Auth Status
    router.get('/config',               reportController.getConfig);
    router.get('/auth/me',              verifyOptionalAdmin, reportController.getMe);

    return router;
}

module.exports = adminRoutes;
