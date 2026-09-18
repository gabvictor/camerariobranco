/**
 * @util originParser
 * Classifica e normaliza a origem do tráfego (Referrer, UTMs e canais).
 * Suporta identificação de redes sociais, busca orgânica, portais de notícias
 * locais do Acre, acessos diretos e campanhas de marketing.
 */

/**
 * Mapeamento de domínios conhecidos para nomes amigáveis e categorias.
 */
const DOMAIN_MAP = [
    // ─── Busca Orgânica ──────────────────────────────────────────────────────────
    { regex: /google\./i, name: 'Google', category: 'Busca Orgânica', icon: 'search' },
    { regex: /bing\.com/i, name: 'Bing', category: 'Busca Orgânica', icon: 'search' },
    { regex: /yahoo\./i, name: 'Yahoo', category: 'Busca Orgânica', icon: 'search' },
    { regex: /duckduckgo\.com/i, name: 'DuckDuckGo', category: 'Busca Orgânica', icon: 'search' },
    { regex: /ecosia\.org/i, name: 'Ecosia', category: 'Busca Orgânica', icon: 'search' },

    // ─── Redes Sociais & Mensageiros ─────────────────────────────────────────────
    { regex: /(instagram\.com|l\.instagram\.com)/i, name: 'Instagram', category: 'Redes Sociais', icon: 'instagram' },
    { regex: /(facebook\.com|m\.facebook\.com|l\.facebook\.com|fb\.me)/i, name: 'Facebook', category: 'Redes Sociais', icon: 'facebook' },
    { regex: /(whatsapp\.com|wa\.me|web\.whatsapp\.com|api\.whatsapp\.com)/i, name: 'WhatsApp', category: 'Mensageiros', icon: 'message-circle' },
    { regex: /(t\.co|twitter\.com|x\.com)/i, name: 'X (Twitter)', category: 'Redes Sociais', icon: 'twitter' },
    { regex: /tiktok\.com/i, name: 'TikTok', category: 'Redes Sociais', icon: 'video' },
    { regex: /(youtube\.com|youtu\.be)/i, name: 'YouTube', category: 'Redes Sociais', icon: 'youtube' },
    { regex: /threads\.net/i, name: 'Threads', category: 'Redes Sociais', icon: 'at-sign' },
    { regex: /linkedin\.com/i, name: 'LinkedIn', category: 'Redes Sociais', icon: 'linkedin' },
    { regex: /t\.me/i, name: 'Telegram', category: 'Mensageiros', icon: 'send' },
    { regex: /pinterest\./i, name: 'Pinterest', category: 'Redes Sociais', icon: 'image' },

    // ─── Portais de Notícias & Mídia do Acre ──────────────────────────────────────
    { regex: /ac24horas\.com/i, name: 'ac24horas', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /contilnetnoticias\.com\.br/i, name: 'ContilNet Notícias', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /g1\.globo\.com/i, name: 'G1 Acre / Globo', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /(agazeta\.net|agazetadoacre\.com)/i, name: 'A Gazeta do Acre', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /oaltoacre\.com/i, name: 'O Alto Acre', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /noticiasdahora\.com\.br/i, name: 'Notícias da Hora', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /oriobranco\.net/i, name: 'O Rio Branco', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /acreagora\.com/i, name: 'Acre Agora', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /acreado\.com\.br/i, name: 'Acre Ao Vivo', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /(acre\.gov\.br|riobranco\.ac\.gov\.br)/i, name: 'Portais Oficiais / Gov', category: 'Governo & Institucional', icon: 'landmark' }
];

/**
 * Analisa o referrer, UTMs e headers para categorizar a origem do visitante.
 * 
 * @param {object} params
 * @param {string} [params.referrer] - URL do referrer (ex: 'https://l.instagram.com/')
 * @param {string} [params.utm_source] - UTM Source (ex: 'instagram', 'facebook', 'qr_placa')
 * @param {string} [params.utm_medium] - UTM Medium (ex: 'stories', 'bio', 'cpc')
 * @param {string} [params.utm_campaign] - Nome da campanha (ex: 'enchente2026')
 * @param {string} [params.siteDomain] - Domínio do próprio site para ignorar links internos
 * @returns {{
 *   source: string,
 *   category: string,
 *   icon: string,
 *   isCampaign: boolean,
 *   utm: { source: string|null, medium: string|null, campaign: string|null },
 *   rawReferrer: string|null
 * }}
 */
function parseOrigin({ referrer = '', utm_source = '', utm_medium = '', utm_campaign = '', siteDomain = 'camerariobranco.com.br' } = {}) {
    const cleanUtmSource = typeof utm_source === 'string' ? utm_source.trim() : '';
    const cleanUtmMedium = typeof utm_medium === 'string' ? utm_medium.trim() : '';
    const cleanUtmCampaign = typeof utm_campaign === 'string' ? utm_campaign.trim() : '';
    const cleanReferrer = typeof referrer === 'string' ? referrer.trim() : '';

    const utmData = {
        source: cleanUtmSource || null,
        medium: cleanUtmMedium || null,
        campaign: cleanUtmCampaign || null
    };

    // 1. Se tiver UTM Source explícito
    if (cleanUtmSource) {
        let label = cleanUtmSource;
        let category = 'Campanhas / UTM';
        let icon = 'tag';

        // Mapeamento amigável de UTMs comuns
        const lowerSource = cleanUtmSource.toLowerCase();
        if (lowerSource.includes('insta')) {
            label = 'Instagram (Campanha)';
            category = 'Redes Sociais';
            icon = 'instagram';
        } else if (lowerSource.includes('face') || lowerSource === 'fb') {
            label = 'Facebook (Campanha)';
            category = 'Redes Sociais';
            icon = 'facebook';
        } else if (lowerSource.includes('whats') || lowerSource === 'wa') {
            label = 'WhatsApp (Link/Grupo)';
            category = 'Mensageiros';
            icon = 'message-circle';
        } else if (lowerSource.includes('telegram') || lowerSource === 'tg') {
            label = 'Telegram (Canal/Grupo)';
            category = 'Mensageiros';
            icon = 'send';
        } else if (lowerSource.includes('twitter') || lowerSource.includes('x.com') || lowerSource === 'x') {
            label = 'X / Twitter (Post/Share)';
            category = 'Redes Sociais';
            icon = 'twitter';
        } else if (lowerSource.includes('tiktok')) {
            label = 'TikTok (Vídeo/Bio)';
            category = 'Redes Sociais';
            icon = 'video';
        } else if (lowerSource.includes('linkedin')) {
            label = 'LinkedIn (Publicação)';
            category = 'Redes Sociais';
            icon = 'linkedin';
        } else if (lowerSource.includes('share') || lowerSource.includes('copiar') || lowerSource.includes('native') || lowerSource.includes('compartilh')) {
            label = 'Compartilhamento Direto';
            category = 'Compartilhamento';
            icon = 'share-2';
        } else if (lowerSource.includes('qr') || lowerSource.includes('qrcode')) {
            label = `QR Code (${cleanUtmMedium || 'Placa/Adesivo'})`;
            category = 'Offline / QR Code';
            icon = 'qr-code';
        } else if (lowerSource.includes('google')) {
            label = 'Google (Anúncio/Campanha)';
            category = 'Busca Orgânica';
            icon = 'search';
        }

        if (cleanUtmCampaign) {
            label += ` [${cleanUtmCampaign}]`;
        }

        return {
            source: label,
            category,
            icon,
            isCampaign: true,
            utm: utmData,
            rawReferrer: cleanReferrer || null
        };
    }

    // 2. Se não houver Referrer ou for vazio
    if (!cleanReferrer) {
        return {
            source: 'Acesso Direto',
            category: 'Acesso Direto',
            icon: 'globe',
            isCampaign: false,
            utm: utmData,
            rawReferrer: null
        };
    }

    // 3. Analisa a URL do Referrer
    try {
        let hostname = '';
        if (cleanReferrer.startsWith('http://') || cleanReferrer.startsWith('https://')) {
            const parsedUrl = new URL(cleanReferrer);
            hostname = parsedUrl.hostname.toLowerCase();
        } else {
            hostname = cleanReferrer.toLowerCase().split('/')[0];
        }

        // Ignora se o referrer for o próprio site (navegação interna)
        if (hostname.includes(siteDomain) || hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
            return {
                source: 'Acesso Direto',
                category: 'Acesso Direto',
                icon: 'globe',
                isCampaign: false,
                utm: utmData,
                rawReferrer: cleanReferrer
            };
        }

        // Checa mapeamento conhecido
        for (const item of DOMAIN_MAP) {
            if (item.regex.test(hostname)) {
                return {
                    source: item.name,
                    category: item.category,
                    icon: item.icon,
                    isCampaign: false,
                    utm: utmData,
                    rawReferrer: cleanReferrer
                };
            }
        }

        // Se for outro domínio externo desconhecido
        const cleanHost = hostname.replace(/^www\./, '');
        return {
            source: cleanHost || 'Site Externo',
            category: 'Outros Sites',
            icon: 'external-link',
            isCampaign: false,
            utm: utmData,
            rawReferrer: cleanReferrer
        };

    } catch (_) {
        return {
            source: 'Acesso Direto',
            category: 'Acesso Direto',
            icon: 'globe',
            isCampaign: false,
            utm: utmData,
            rawReferrer: cleanReferrer
        };
    }
}

/**
 * Sanitiza chave para uso seguro como chave de objeto no Firestore
 * (remove pontos, barras e caracteres especiais que o Firestore rejeita em field paths).
 * 
 * @param {string} str
 * @returns {string}
 */
function sanitizeKey(str) {
    if (!str || typeof str !== 'string') return 'Desconhecido';
    return str
        .replace(/[.~*/[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
}

module.exports = {
    parseOrigin,
    sanitizeKey,
    DOMAIN_MAP
};
