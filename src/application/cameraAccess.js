/**
 * Acesso às imagens das câmeras.
 *
 * Enquanto `camerasBloqueadas` estiver ligado na configuração do site (padrão: ligado), NENHUMA imagem de câmera é
 * entregue ao público, inclusive as câmeras do rio: as páginas mostram o aviso no lugar. Só passam os pedidos que
 * partem do painel de administração (ver `pedidoDoPainel`).
 * O cartão na tela é só a parte visível: o bloqueio de verdade acontece aqui, no servidor.
 */

/** Ligado por padrão: só desliga se alguém desligar de propósito (`camerasBloqueadas: false`). */
function camerasBloqueadas(config) {
    return !config || config.camerasBloqueadas !== false;
}

/**
 * @param {{ config?: object, admin?: boolean }} p   `admin`: o pedido é de um administrador vindo do painel
 * @returns {boolean} true se esta pessoa pode receber a imagem de câmera
 */
function podeVerCamera({ config, admin = false } = {}) {
    return !camerasBloqueadas(config) || Boolean(admin);
}

/**
 * O pedido vem do PAINEL? A isenção de administrador só vale para imagens pedidas pelas páginas do painel
 * (têm `token` no endereço ou saem de uma página /admin ou /dashboard). Um administrador navegando nas páginas
 * públicas, ou abrindo o endereço da imagem direto, recebe o mesmo bloqueio que todo mundo: o cookie de sessão
 * dele não abre as câmeras para o público.
 */
function pedidoDoPainel(req) {
    if (req && req.query && req.query.token) return true;
    const ref = String((req && req.headers && (req.headers.referer || req.headers.referrer)) || '');
    return /^https?:\/\/[^/]+\/(admin|dashboard)(\/|\?|#|$)/i.test(ref);
}

const MENSAGEM_BLOQUEIO = 'Imagens das câmeras indisponíveis no momento.';

module.exports = { camerasBloqueadas, podeVerCamera, pedidoDoPainel, MENSAGEM_BLOQUEIO };
