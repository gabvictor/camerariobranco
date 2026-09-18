/**
 * @util geoUtils
 * Identificação e resolução geográfica (País, Estado/UF e Cidade) de visitantes
 * através de IP e headers Cloudflare, com anonimização para LGPD.
 */

let geoip = null;
try {
    geoip = require('geoip-lite');
} catch (e) {
    console.warn('[geoUtils] geoip-lite não pôde ser carregado:', e.message);
}

const BR_STATES = {
    'AC': 'Acre (AC)',
    'AL': 'Alagoas (AL)',
    'AP': 'Amapá (AP)',
    'AM': 'Amazonas (AM)',
    'BA': 'Bahia (BA)',
    'CE': 'Ceará (CE)',
    'DF': 'Distrito Federal (DF)',
    'ES': 'Espírito Santo (ES)',
    'GO': 'Goiás (GO)',
    'MA': 'Maranhão (MA)',
    'MT': 'Mato Grosso (MT)',
    'MS': 'Mato Grosso do Sul (MS)',
    'MG': 'Minas Gerais (MG)',
    'PA': 'Pará (PA)',
    'PB': 'Paraíba (PB)',
    'PR': 'Paraná (PR)',
    'PE': 'Pernambuco (PE)',
    'PI': 'Piauí (PI)',
    'RJ': 'Rio de Janeiro (RJ)',
    'RN': 'Rio Grande do Norte (RN)',
    'RS': 'Rio Grande do Sul (RS)',
    'RO': 'Rondônia (RO)',
    'RR': 'Roraima (RR)',
    'SC': 'Santa Catarina (SC)',
    'SP': 'São Paulo (SP)',
    'SE': 'Sergipe (SE)',
    'TO': 'Tocantins (TO)'
};

const COUNTRY_NAMES = {
    'BR': 'Brasil',
    'US': 'Estados Unidos',
    'PT': 'Portugal',
    'ES': 'Espanha',
    'AR': 'Argentina',
    'BO': 'Bolívia',
    'PE': 'Peru',
    'CL': 'Chile',
    'UY': 'Uruguai',
    'PY': 'Paraguai',
    'FR': 'França',
    'DE': 'Alemanha',
    'GB': 'Reino Unido',
    'IT': 'Itália',
    'CA': 'Canadá',
    'JP': 'Japão'
};

/**
 * Extrai o IP real do visitante a partir de headers de proxy e conexão.
 * 
 * @param {import('express').Request} req
 * @returns {string}
 */
function extractClientIp(req) {
    if (!req) return '127.0.0.1';

    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return String(cfIp).trim();

    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        const ips = String(xForwardedFor).split(',');
        if (ips.length > 0 && ips[0].trim()) {
            return ips[0].trim();
        }
    }

    const xRealIp = req.headers['x-real-ip'];
    if (xRealIp) return String(xRealIp).trim();

    const socketIp = req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
    // Remove prefixo IPv6-mapped IPv4 (::ffff:192.168.1.1 -> 192.168.1.1)
    return socketIp.replace(/^.*:/, '') || '127.0.0.1';
}

/**
 * Verifica se um IP é privado/local (Loopback, rede local ou desenvolvimento).
 * 
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIp(ip) {
    if (!ip) return true;
    const clean = ip.replace(/^.*:/, '');
    return (
        clean === '127.0.0.1' ||
        clean === 'localhost' ||
        clean === '::1' ||
        clean.startsWith('10.') ||
        clean.startsWith('192.168.') ||
        clean.startsWith('172.16.') ||
        clean.startsWith('172.17.') ||
        clean.startsWith('172.18.') ||
        clean.startsWith('172.19.') ||
        clean.startsWith('172.2') ||
        clean.startsWith('172.30.') ||
        clean.startsWith('172.31.')
    );
}

/**
 * Mascara o IP para conformidade com a LGPD e privacidade.
 * Ex: '177.136.24.55' -> '177.136.***.***'
 * 
 * @param {string} ip
 * @returns {string}
 */
function maskIp(ip) {
    if (!ip || isPrivateIp(ip)) return 'Localhost';
    const parts = ip.split('.');
    if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.***.***`;
    }
    // IPv6 simples
    const v6Parts = ip.split(':');
    if (v6Parts.length > 2) {
        return `${v6Parts[0]}:${v6Parts[1]}:****:****`;
    }
    return '***.***.***.***';
}

/**
 * Resolve a localização geográfica do visitante.
 * Prioriza headers do Cloudflare e consulta geoip-lite.
 * 
 * @param {string} ip
 * @param {object} [headers={}]
 * @returns {{
 *   country: string,
 *   countryCode: string,
 *   region: string,
 *   regionCode: string,
 *   city: string,
 *   isLocal: boolean
 * }}
 */
function resolveLocation(ip, headers = {}) {
    // 1. Se for IP privado / desenvolvimento local
    if (isPrivateIp(ip)) {
        return {
            country: 'Brasil',
            countryCode: 'BR',
            region: 'Acre (AC)',
            regionCode: 'AC',
            city: 'Rio Branco (Local)',
            isLocal: true
        };
    }

    // 2. Cloudflare Geo Headers (se o site estiver rodando atrás do Cloudflare)
    const cfCountry = headers['cf-ipcountry'];
    const cfRegion = headers['cf-region'] || headers['cf-region-code'];
    const cfCity = headers['cf-ipcity'];

    let countryCode = cfCountry || '';
    let regionCode = cfRegion || '';
    let city = cfCity ? decodeURIComponent(cfCity) : '';

    // 3. Fallback / Consulta via geoip-lite
    if ((!city || !regionCode || !countryCode) && geoip) {
        try {
            const geo = geoip.lookup(ip);
            if (geo) {
                if (!countryCode && geo.country) countryCode = geo.country;
                if (!regionCode && geo.region) regionCode = geo.region;
                if (!city && geo.city) city = geo.city;
            }
        } catch (_) {}
    }

    // Formatação amigável
    countryCode = (countryCode || 'BR').toUpperCase();
    const country = COUNTRY_NAMES[countryCode] || countryCode || 'Brasil';

    let region = 'Outros Estados';
    if (regionCode && BR_STATES[regionCode.toUpperCase()]) {
        region = BR_STATES[regionCode.toUpperCase()];
    } else if (regionCode) {
        region = regionCode.toUpperCase();
    } else if (countryCode === 'BR') {
        region = 'Acre (AC)';
    }

    if (!city) {
        city = (regionCode === 'AC' || region.includes('Acre')) ? 'Rio Branco' : 'Não identificada';
    }

    return {
        country,
        countryCode,
        region,
        regionCode: regionCode.toUpperCase(),
        city,
        isLocal: false
    };
}

module.exports = {
    extractClientIp,
    isPrivateIp,
    maskIp,
    resolveLocation,
    BR_STATES,
    COUNTRY_NAMES
};
