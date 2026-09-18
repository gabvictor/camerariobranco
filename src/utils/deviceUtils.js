/**
 * @util deviceUtils
 * Identificação do tipo de dispositivo, sistema operacional e navegador
 * a partir do User-Agent e dimensões de tela do cliente.
 */

/**
 * Detecta dispositivo, SO e navegador.
 * 
 * @param {string} [userAgent='']
 * @param {number} [screenWidth=0]
 * @returns {{
 *   device: 'Mobile' | 'Desktop' | 'Tablet' | 'Outro',
 *   os: string,
 *   browser: string,
 *   isMobile: boolean
 * }}
 */
function resolveDevice(userAgent = '', screenWidth = 0) {
    const ua = String(userAgent || '').toLowerCase();

    // ─── 1. Tipo de Dispositivo ──────────────────────────────────────────────────
    let device = 'Desktop';
    let isMobile = false;

    if (/(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk)/i.test(ua)) {
        device = 'Tablet';
        isMobile = true;
    } else if (/(iphone|ipod|android.*mobile|windows phone|blackberry|bb10|mobile)/i.test(ua) || (screenWidth > 0 && screenWidth <= 768)) {
        device = 'Mobile';
        isMobile = true;
    } else if (screenWidth > 0 && screenWidth <= 1024 && screenWidth > 768) {
        device = 'Tablet';
        isMobile = true;
    }

    // ─── 2. Sistema Operacional ─────────────────────────────────────────────────
    let os = 'Outro';
    if (/android/i.test(ua)) {
        os = 'Android';
    } else if (/iphone|ipad|ipod/i.test(ua)) {
        os = 'iOS';
    } else if (/windows nt 10/i.test(ua)) {
        os = 'Windows 10/11';
    } else if (/windows/i.test(ua)) {
        os = 'Windows';
    } else if (/mac os x|macintosh/i.test(ua)) {
        os = 'macOS';
    } else if (/linux/i.test(ua)) {
        os = 'Linux';
    } else if (/cros/i.test(ua)) {
        os = 'ChromeOS';
    }

    // ─── 3. Navegador ────────────────────────────────────────────────────────────
    let browser = 'Outro';
    if (/samsungbrowser/i.test(ua)) {
        browser = 'Samsung Internet';
    } else if (/edg\//i.test(ua)) {
        browser = 'Edge';
    } else if (/opr\/|opera/i.test(ua)) {
        browser = 'Opera';
    } else if (/chrome|crios/i.test(ua) && !/edg\//i.test(ua) && !/opr\//i.test(ua)) {
        browser = 'Chrome';
    } else if (/firefox|fxios/i.test(ua)) {
        browser = 'Firefox';
    } else if (/safari/i.test(ua) && !/chrome|crios|android/i.test(ua)) {
        browser = 'Safari';
    } else if (/instagram/i.test(ua)) {
        browser = 'Instagram In-App';
    } else if (/fbav|fban/i.test(ua)) {
        browser = 'Facebook In-App';
    } else if (/whatsapp/i.test(ua)) {
        browser = 'WhatsApp In-App';
    }

    return {
        device,
        os,
        browser,
        isMobile
    };
}

module.exports = {
    resolveDevice
};
