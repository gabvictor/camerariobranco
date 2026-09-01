const express = require('express');
const { verifyAdmin, verifyOptionalAdmin, createRateLimiter } = require('../../../middlewares/security');

/**
 * @routes adminRoutes
 * Rotas administrativas — reportes, comentários, changelog, dashboard e status de autenticação.
 *
 * @param {import('../controllers/ReportController')} reportController
 * @param {import('../controllers/DashboardController')} dashboardController
 */
function adminRoutes(reportController, dashboardController) {
    const router = express.Router();

    // Rate limiter para envio público de reportes (máximo 10 por minuto por IP)
    const reportRateLimiter = createRateLimiter({
        windowMs: 60 * 1000,
        max: 10,
        message: 'Muitos reportes enviados. Aguarde um minuto antes de tentar novamente.'
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
    router.get('/comments',             verifyAdmin,       reportController.listComments);
    router.delete('/comment/:cameraId/:id', verifyAdmin,   reportController.deleteComment);

    // Changelog
    router.post('/changelog',           verifyAdmin,       reportController.createChangelog);

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
