const express = require('express');
const { createRateLimiter, verifyAdmin } = require('../../../middlewares/security');

/**
 * @routes alertRoutes
 * Inscrição, confirmação e cancelamento dos alertas do Rio Acre por e-mail.
 *
 * @param {import('../controllers/AlertController')} alertController
 */
function alertRoutes(alertController) {
    const router = express.Router();

    // Inscrição dispara e-mail para terceiros: limite curto por IP para não virar spam.
    const subscribeLimiter = createRateLimiter({
        windowMs: 10 * 60 * 1000,
        max: 5,
        message: 'Muitas tentativas de inscrição. Aguarde alguns minutos.'
    });
    const linkLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, message: 'Muitas requisições. Aguarde um instante.' });

    // Painel de administração: só o admin chega aqui (verifyAdmin vem antes dos limitadores).
    const adminLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, message: 'Muitas requisições. Aguarde um instante.' });
    const testLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, message: 'Muitos e-mails de teste em pouco tempo. Aguarde alguns minutos.' });
    router.get('/api/admin/alertas/resumo',  verifyAdmin, adminLimiter, alertController.adminSummary);
    router.post('/api/admin/alertas/previa', verifyAdmin, adminLimiter, alertController.adminPreview);
    router.post('/api/admin/alertas/simular', verifyAdmin, adminLimiter, alertController.adminSimulate);
    router.post('/api/admin/alertas/teste',  verifyAdmin, testLimiter,  alertController.adminSendTest);

    router.get('/api/alertas/niveis',      linkLimiter,      alertController.levels);
    router.post('/api/alertas/inscrever',  subscribeLimiter, alertController.subscribe);
    router.get('/api/alertas/confirmar',   linkLimiter,      alertController.confirm);
    router.get('/alertas/cancelar',        linkLimiter,      alertController.unsubscribePage);
    router.post('/api/alertas/cancelar',   linkLimiter,      express.urlencoded({ extended: false }), alertController.unsubscribe);

    return router;
}

module.exports = alertRoutes;
