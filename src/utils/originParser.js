/**
 * @util originParser
 * Classifica e normaliza a origem do tráfego (Referrer, UTMs e canais).
 * Suporta identificação de redes sociais, mensageiros, busca orgânica,
 * esquemas de aplicativos móveis android-app://, links compartilhados,
 * portais de notícias locais do Acre, acessos diretos e campanhas de marketing.
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
    { regex: /bsky\.app/i, name: 'Bluesky', category: 'Redes Sociais', icon: 'cloud' },
    { regex: /reddit\.com/i, name: 'Reddit', category: 'Redes Sociais', icon: 'message-square' },
    { regex: /(discord\.com|discord\.gg)/i, name: 'Discord', category: 'Mensageiros', icon: 'message-circle' },
    { regex: /linkedin\.com/i, name: 'LinkedIn', category: 'Redes Sociais', icon: 'linkedin' },
    { regex: /(t\.me|telegram\.me)/i, name: 'Telegram', category: 'Mensageiros', icon: 'send' },
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
    { regex: /folhadoacre\.com\.br/i, name: 'Folha do Acre', category: 'Portais de Notícias', icon: 'newspaper' },
    { regex: /(acre\.gov\.br|riobranco\.ac\.gov\.br|agencia\.ac\.gov\.br)/i, name: 'Portais Oficiais / Gov', category: 'Governo & Institucional', icon: 'landmark' }
];

/**
 * Mapeamento para esquemas android-app:// (aplicativos móveis do Android)
 */
const ANDROID_APP_MAP = [
    { regex: /com\.whatsapp/i, name: 'WhatsApp (App Android)', category: 'Mensageiros', icon: 'message-circle' },
    { regex: /com\.instagram\.android/i, name: 'Instagram (App Android)', category: 'Redes Sociais', icon: 'instagram' },
    { regex: /(org\.telegram\.messenger|org\.thunderdog\.challegram)/i, name: 'Telegram (App Android)', category: 'Mensageiros', icon: 'send' },
    { regex: /(com\.facebook\.katana|com\.facebook\.orca)/i, name: 'Facebook (App Android)', category: 'Redes Sociais', icon: 'facebook' },
    { regex: /com\.twitter\.android/i, name: 'X / Twitter (App Android)', category: 'Redes Sociais', icon: 'twitter' },
    { regex: /com\.google\.android\.googlequicksearchbox/i, name: 'Google (App Android)', category: 'Busca Orgânica', icon: 'search' },
    { regex: /(com\.zhiliaoapp\.musically|com\.ss\.android\.ugc\.trill)/i, name: 'TikTok (App Android)', category: 'Redes Sociais', icon: 'video' },
    { regex: /com\.linkedin\.android/i, name: 'LinkedIn (App Android)', category: 'Redes Sociais', icon: 'linkedin' },
    { regex: /com\.reddit\.frontpage/i, name: 'Reddit (App Android)', category: 'Redes Sociais', icon: 'message-square' }
];

/**
 * Analisa o referrer, UTMs e headers para categorizar a origem do visitante.
 * 
 * @param {object} params
 * @param {string} [params.referrer] - URL do referrer (ex: 'https://l.instagram.com/')
 * @param {string} [params.utm_source] - UTM Source (ex: 'instagram', 'facebook', 'qr_placa')
 * @param {string} [params.utm_medium] - UTM Medium (ex: 'stories', 'bio', 'cpc', 'social_share')
 * @param {string} [params.utm_campaign] - Nome da campanha (ex: 'enchente2026')
 * @param {string} [params.utm_content] - Identificador do conteúdo compartilhado (ex: id da câmera)
 * @param {string} [params.utm_term] - Termo de busca / palavra-chave
 * @param {string} [params.siteDomain] - Domínio do próprio site para ignorar links internos
 * @returns {{
 *   source: string,
 *   category: string,
 *   icon: string,
 *   isCampaign: boolean,
 *   isShared: boolean,
 *   utm: { source: string|null, medium: string|null, campaign: string|null, content: string|null, term: string|null },
 *   rawReferrer: string|null
 * }}
 */
function parseOrigin({
    referrer = '',
    utm_source = '',
    utm_medium = '',
    utm_campaign = '',
    utm_content = '',
    utm_term = '',
    siteDomain = 'camerariobranco.com.br'
} = {}) {
    const cleanUtmSource = typeof utm_source === 'string' ? utm_source.trim() : '';
    const cleanUtmMedium = typeof utm_medium === 'string' ? utm_medium.trim() : '';
    const cleanUtmCampaign = typeof utm_campaign === 'string' ? utm_campaign.trim() : '';
    const cleanUtmContent = typeof utm_content === 'string' ? utm_content.trim() : '';
    const cleanUtmTerm = typeof utm_term === 'string' ? utm_term.trim() : '';
    const cleanReferrer = typeof referrer === 'string' ? referrer.trim() : '';

    const utmData = {
        source: cleanUtmSource || null,
        medium: cleanUtmMedium || null,
        campaign: cleanUtmCampaign || null,
        content: cleanUtmContent || null,
        term: cleanUtmTerm || null
    };

    const isShareMedium = ['social_share', 'clipboard', 'mobile_share', 'offline_scan'].includes(cleanUtmMedium.toLowerCase());

    // 1. Se tiver UTM Source explícito
    if (cleanUtmSource) {
        let label = cleanUtmSource;
        let category = 'Campanhas / UTM';
        let icon = 'tag';
        const lowerSource = cleanUtmSource.toLowerCase();
        let isSharedLink = isShareMedium || lowerSource.includes('share') || lowerSource.includes('copiar');

        // Mapeamento amigável e preciso de canais e compartilhamentos
        if (lowerSource.includes('whats') || lowerSource === 'wa') {
            label = isShareMedium ? 'WhatsApp (Compartilhado)' : 'WhatsApp (Link/Grupo)';
            category = 'Mensageiros';
            icon = 'message-circle';
        } else if (lowerSource.includes('telegram') || lowerSource === 'tg') {
            label = isShareMedium ? 'Telegram (Compartilhado)' : 'Telegram (Canal/Grupo)';
            category = 'Mensageiros';
            icon = 'send';
        } else if (lowerSource.includes('insta')) {
            label = isShareMedium ? 'Instagram (Compartilhado)' : 'Instagram (Campanha)';
            category = 'Redes Sociais';
            icon = 'instagram';
        } else if (lowerSource.includes('face') || lowerSource === 'fb') {
            label = isShareMedium ? 'Facebook (Compartilhado)' : 'Facebook (Campanha)';
            category = 'Redes Sociais';
            icon = 'facebook';
        } else if (lowerSource.includes('twitter') || lowerSource.includes('x.com') || lowerSource === 'x') {
            label = isShareMedium ? 'X / Twitter (Compartilhado)' : 'X / Twitter (Post/Share)';
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
        } else if (lowerSource === 'share_link' || lowerSource.includes('copiar')) {
            label = 'Compartilhamento Direto';
            category = 'Compartilhamento';
            icon = 'share-2';
            isSharedLink = true;
        } else if (lowerSource === 'native_share') {
            label = 'Compartilhamento Nativo';
            category = 'Compartilhamento';
            icon = 'share-2';
            isSharedLink = true;
        } else if (lowerSource.includes('share') || lowerSource.includes('compartilh')) {
            label = 'Compartilhamento Direto';
            category = 'Compartilhamento';
            icon = 'share-2';
            isSharedLink = true;
        } else if (lowerSource.includes('qr') || lowerSource.includes('qrcode')) {
            label = `QR Code (${cleanUtmMedium || 'Placa/Adesivo'})`;
            category = 'Offline / QR Code';
            icon = 'qr-code';
            isSharedLink = true;
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
            isShared: isSharedLink,
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
            isShared: false,
            utm: utmData,
            rawReferrer: null
        };
    }

    // 3. Suporte específico a esquemas android-app:// (cliques dentro de apps nativos Android)
    if (cleanReferrer.startsWith('android-app://')) {
        for (const item of ANDROID_APP_MAP) {
            if (item.regex.test(cleanReferrer)) {
                return {
                    source: item.name,
                    category: item.category,
                    icon: item.icon,
                    isCampaign: false,
                    isShared: item.category === 'Mensageiros',
                    utm: utmData,
                    rawReferrer: cleanReferrer
                };
            }
        }
        return {
            source: 'App Android Externo',
            category: 'Outros Apps',
            icon: 'smartphone',
            isCampaign: false,
            isShared: false,
            utm: utmData,
            rawReferrer: cleanReferrer
        };
    }

    // 4. Analisa a URL padrão do Referrer
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
                isShared: false,
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
                    isShared: item.category === 'Mensageiros',
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
            isShared: false,
            utm: utmData,
            rawReferrer: cleanReferrer
        };

    } catch (_) {
        return {
            source: 'Acesso Direto',
            category: 'Acesso Direto',
            icon: 'globe',
            isCampaign: false,
            isShared: false,
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
    DOMAIN_MAP,
    ANDROID_APP_MAP
};
