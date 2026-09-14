const express = require('express');
const { verifyAdmin, createRateLimiter } = require('../../../middlewares/security');

/**
 * @routes sponsorRoutes
 * Rotas de patrocinadores públicos e gestão administrativa.
 *
 * @param {import('../controllers/SponsorController')} sponsorController
 */
function sponsorRoutes(sponsorController) {
    const router = express.Router();

    const publicLimiter = createRateLimiter({
        windowMs: 60 * 1000,
        max: 60,
        message: 'Muitas requisições. Aguarde um instante.'
    });

    // ─── Rotas Públicas ───────────────────────────────────────────────────────
    router.get('/api/sponsors/public',        publicLimiter, sponsorController.getPublicData);
    router.get('/api/sponsors/camera/:code',  publicLimiter, sponsorController.getSponsorForCamera);
    router.get('/api/sponsors/plans',         publicLimiter, sponsorController.getPublicPlans);

    // ─── Rotas Administrativas (Protegidas com verifyAdmin) ───────────────────
    router.get('/api/admin/sponsors',             verifyAdmin, sponsorController.getAdminSponsors);
    router.get('/api/admin/sponsors/plans',       verifyAdmin, sponsorController.getAdminPlans);
    router.put('/api/admin/sponsors/plans/:id',   verifyAdmin, sponsorController.updatePlan);
    router.post('/api/admin/sponsors/upload-logo',verifyAdmin, sponsorController.uploadLogo);
    router.get('/api/admin/sponsors/:id',         verifyAdmin, sponsorController.getAdminSponsorById);
    router.post('/api/admin/sponsors',            verifyAdmin, sponsorController.createSponsor);
    router.put('/api/admin/sponsors/:id',         verifyAdmin, sponsorController.updateSponsor);
    router.post('/api/admin/sponsors/:id/renew',  verifyAdmin, sponsorController.renewSponsor);
    router.patch('/api/admin/sponsors/:id/status',verifyAdmin, sponsorController.toggleStatus);
    router.delete('/api/admin/sponsors/:id',      verifyAdmin, sponsorController.deleteSponsor);

    return router;
}

module.exports = sponsorRoutes;
