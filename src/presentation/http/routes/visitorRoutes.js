const express = require('express');
const { createRateLimiter, verifyAdmin } = require('../../../middlewares/security');

/**
 * @routes visitorRoutes
 * Perfis de visitantes (admin) e aviso de visibilidade da aba (público, leve).
 *
 * @param {import('../controllers/VisitorController')} visitorController
 */
function visitorRoutes(visitorController) {
    const router = express.Router();

    const adminLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120, message: 'Muitas requisições. Aguarde um instante.' });
    // Um aviso por mudança de aba; o limite por visitante evita abuso sem atrapalhar o uso normal.
    const visibilityLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, message: 'Muitas requisições.' });

    router.get('/api/admin/visitantes/ao-vivo', verifyAdmin, adminLimiter, visitorController.live);
    router.get('/api/admin/visitantes/resumo', verifyAdmin, adminLimiter, visitorController.summary);
    router.get('/api/admin/visitantes/sessoes', verifyAdmin, adminLimiter, visitorController.sessions);

    router.post('/api/presence/visibility', visibilityLimiter, visitorController.visibility);

    return router;
}

module.exports = visitorRoutes;
