const express = require('express');
const { verifyAdmin } = require('../../../middlewares/security');

/**
 * @routes adminRoutes
 * Rotas administrativas — reportes, comentários, changelog, dashboard.
 *
 * @param {import('../controllers/ReportController')} reportController
 * @param {import('../controllers/DashboardController')} dashboardController
 */
function adminRoutes(reportController, dashboardController) {
    const router = express.Router();

    // Reports
    router.post('/report',              reportController.create);
    router.get('/reports',  verifyAdmin, reportController.list);
    router.put('/report/:id/status', verifyAdmin, reportController.updateStatus);
    router.delete('/report/:id',     verifyAdmin, reportController.delete);

    // Comments
    router.get('/comments',  verifyAdmin, reportController.listComments);
    router.delete('/comment/:cameraId/:id', verifyAdmin, reportController.deleteComment);

    // Changelog
    router.post('/changelog', verifyAdmin, reportController.createChangelog);

    // Dashboard
    router.get('/dashboard-data', verifyAdmin, dashboardController.getDashboard);

    // Config
    router.get('/config', reportController.getConfig);

    return router;
}

module.exports = adminRoutes;
