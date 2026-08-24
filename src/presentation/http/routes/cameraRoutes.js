const express = require('express');
const { verifyAdmin, verifyOptionalAdmin } = require('../../../middlewares/security');

/**
 * @routes cameraRoutes
 * Rotas de câmeras, status e métricas — sem lógica, apenas middleware + controller.
 *
 * @param {import('../controllers/CameraController')} cameraController
 */
function cameraRoutes(cameraController) {
    const router = express.Router();

    router.get('/status-cameras',     verifyOptionalAdmin,  cameraController.getStatuses);
    router.post('/api/track-visit',                         cameraController.trackVisitRoute);
    router.get('/api/traffic',                              cameraController.getTraffic);
    router.get('/api/simple-metrics',                       cameraController.getSimpleMetrics);
    router.get('/api/site-config',                          cameraController.getSiteConfig);
    router.post('/api/site-config',   verifyAdmin,          cameraController.updateSiteConfig);
    router.post('/api/update-camera-info', verifyAdmin,     cameraController.updateCameraInfo);
    router.get('/api/rio-acre',                             cameraController.getRioAcre);
    router.get('/api/timelapse/:code',                      cameraController.getTimelapse);

    // Timelapse Admin Management
    router.get('/api/timelapse-admin/stats',        verifyAdmin, cameraController.getTimelapseAdminStats);
    router.post('/api/timelapse-admin/config',      verifyAdmin, cameraController.updateTimelapseConfig);
    router.post('/api/timelapse-admin/capture-now', verifyAdmin, cameraController.captureTimelapseNow);
    router.delete('/api/timelapse-admin/delete-all',verifyAdmin, cameraController.deleteTimelapseAll);

    return router;
}

module.exports = cameraRoutes;
