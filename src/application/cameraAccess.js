/**
 * Acesso às imagens das câmeras.
 *
 * Enquanto `camerasBloqueadas` estiver ligado na configuração do site (padrão: ligado), nenhuma imagem de câmera é
 * entregue ao público. Ficam liberados:
 *  - administradores (o painel precisa ver as câmeras);
 *  - as câmeras do rio (as da página /rio, que seguem no ar com um aviso).
 * O cartão na tela é só a parte visível: o bloqueio de verdade acontece aqui, no servidor.
 */

/** Códigos das câmeras do rio: os mesmos usados nos e-mails de alerta. */
function codigosDoRio(env = process.env) {
    return new Set(String(env.RIO_ALERT_CAMERAS || '001334,001426').split(',').map((c) => c.trim()).filter(Boolean));
}

/** Ligado por padrão: só desliga se alguém desligar de propósito (`camerasBloqueadas: false`). */
function camerasBloqueadas(config) {
    return !config || config.camerasBloqueadas !== false;
}

/**
 * @param {{ config?: object, codigo?: string, admin?: boolean, rio?: Set<string> }} p
 * @returns {boolean} true se esta pessoa pode receber a imagem desta câmera
 */
function podeVerCamera({ config, codigo, admin = false, rio = codigosDoRio() }) {
    if (!camerasBloqueadas(config)) return true;
    if (admin) return true;
    return codigo != null && rio.has(String(codigo));
}

const MENSAGEM_BLOQUEIO = 'Imagens das câmeras indisponíveis no momento.';

module.exports = { codigosDoRio, camerasBloqueadas, podeVerCamera, MENSAGEM_BLOQUEIO };
