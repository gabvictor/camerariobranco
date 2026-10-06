const { admin } = require('../../config/firebaseAdmin');
const { getRioBrancoDateStr, formatRioBrancoTime, formatRioBrancoDate } = require('../../utils/dateUtils');
const { parseOrigin, sanitizeKey } = require('../../utils/originParser');
const { resolveLocation, maskIp } = require('../../utils/geoUtils');
const { resolveDevice } = require('../../utils/deviceUtils');

/**
 * @use-case TrackVisitUseCase
 * Registra e agrega métricas de tráfego, fontes de origem (referrers e UTMs),
 * eventos de compartilhamento, distribuição geográfica e dispositivos dos visitantes no fuso do Acre.
 */
class TrackVisitUseCase {
    /**
     * @param {object} db — Firestore db instance
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Registra uma nova visita na base de dados com telemetria detalhada.
     * 
     * @param {object} [visitData={}]
     * @param {string} [visitData.referrer]
     * @param {string} [visitData.utm_source]
     * @param {string} [visitData.utm_medium]
     * @param {string} [visitData.utm_campaign]
     * @param {string} [visitData.utm_content]
     * @param {string} [visitData.utm_term]
     * @param {string} [visitData.entryPath]
     * @param {string} [visitData.entrySource]
     * @param {string} [visitData.path]
     * @param {string} [visitData.ip]
     * @param {string} [visitData.userAgent]
     * @param {number} [visitData.screenWidth]
     * @param {object} [visitData.headers]
     * @returns {Promise<object>} Dados processados da visita
     */
    async execute(visitData = {}) {
        const today = getRioBrancoDateStr();
        const now = new Date();
        const timeStr = formatRioBrancoTime(now);
        const dateStr = formatRioBrancoDate(now);

        // 1. Extração e Resolução
        const origin = parseOrigin({
            referrer: visitData.referrer,
            utm_source: visitData.utm_source,
            utm_medium: visitData.utm_medium,
            utm_campaign: visitData.utm_campaign,
            utm_content: visitData.utm_content,
            utm_term: visitData.utm_term
        });

        const geo = resolveLocation(visitData.ip, visitData.headers || {});
        const device = resolveDevice(visitData.userAgent, visitData.screenWidth);
        const ipMasked = maskIp(visitData.ip);
        const cleanPath = (typeof visitData.path === 'string' && visitData.path) ? visitData.path.slice(0, 80) : '/';
        const entryPath = (typeof visitData.entryPath === 'string' && visitData.entryPath) ? visitData.entryPath.slice(0, 80) : cleanPath;

        // 2. Chaves sanitizadas para Firestore
        const sourceKey = sanitizeKey(origin.source);
        const categoryKey = sanitizeKey(origin.category);
        const cityKey = sanitizeKey(geo.city);
        const regionKey = sanitizeKey(geo.region);
        const countryKey = sanitizeKey(geo.country);
        const deviceKey = sanitizeKey(device.device);
        const browserKey = sanitizeKey(device.browser);
        const osKey = sanitizeKey(device.os);
        const pathKey = sanitizeKey(cleanPath);
        const entryPathKey = sanitizeKey(entryPath);

        const inc = admin.firestore.FieldValue.increment(1);

        // 3. Montagem dos updates atômicos com mapas aninhados reais no Firestore
        const statsUpdate = {
            totalViews: inc,
            sources: { [sourceKey]: inc },
            categories: { [categoryKey]: inc },
            cities: { [cityKey]: inc },
            regions: { [regionKey]: inc },
            countries: { [countryKey]: inc },
            devices: { [deviceKey]: inc },
            browsers: { [browserKey]: inc },
            operatingSystems: { [osKey]: inc },
            paths: { [pathKey]: inc },
            entryPaths: { [entryPathKey]: inc },
            lastVisitAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const dailyUpdate = {
            views: inc,
            sources: { [sourceKey]: inc },
            categories: { [categoryKey]: inc },
            cities: { [cityKey]: inc },
            regions: { [regionKey]: inc },
            countries: { [countryKey]: inc },
            devices: { [deviceKey]: inc },
            browsers: { [browserKey]: inc },
            operatingSystems: { [osKey]: inc },
            paths: { [pathKey]: inc },
            entryPaths: { [entryPathKey]: inc },
            date: today,
            lastVisitAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Rastreamento específico de links que vieram de compartilhamento
        if (origin.isShared) {
            statsUpdate.referralsFromShares = inc;
            dailyUpdate.referralsFromShares = inc;

            const sharePlatformKey = sanitizeKey(origin.utm?.source || 'desconhecido');
            statsUpdate.referralsBySharePlatform = { [sharePlatformKey]: inc };
            dailyUpdate.referralsBySharePlatform = { [sharePlatformKey]: inc };
        }

        if (origin.utm && origin.utm.source) {
            const utmKey = sanitizeKey(origin.utm.source);
            statsUpdate.utmSources = { [utmKey]: inc };
            dailyUpdate.utmSources = { [utmKey]: inc };
        }

        if (origin.utm && origin.utm.content) {
            const contentKey = sanitizeKey(origin.utm.content);
            statsUpdate.utmContents = { [contentKey]: inc };
            dailyUpdate.utmContents = { [contentKey]: inc };
        }

        const statsRef = this.db.collection('stats').doc('traffic');
        const dailyRef = statsRef.collection('daily').doc(today);
        const recentVisitsRef = statsRef.collection('recent_visits');

        const visitRecord = {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            createdAtMs: Date.now(),
            timeStr,
            dateStr,
            source: origin.source,
            category: origin.category,
            icon: origin.icon,
            isCampaign: origin.isCampaign,
            isShared: !!origin.isShared,
            utm: origin.utm,
            rawReferrer: origin.rawReferrer,
            city: geo.city,
            region: geo.region,
            country: geo.country,
            device: device.device,
            os: device.os,
            browser: device.browser,
            path: cleanPath,
            entryPath,
            entrySource: visitData.entrySource || '',
            ipMasked,
            screen: (typeof visitData.screen === 'string') ? visitData.screen.slice(0, 30) : '',
            pixelRatio: Number(visitData.pixelRatio) || 1,
            timezone: (typeof visitData.timezone === 'string') ? visitData.timezone.slice(0, 50) : '',
            language: (typeof visitData.language === 'string') ? visitData.language.slice(0, 20) : '',
            gpu: (typeof visitData.gpu === 'string') ? visitData.gpu.slice(0, 80) : '',
            cores: Number(visitData.cores) || 0,
            connection: (typeof visitData.connection === 'string') ? visitData.connection.slice(0, 20) : ''
        };

        // 4. Executa gravações em paralelo
        await Promise.all([
            statsRef.set(statsUpdate, { merge: true }),
            dailyRef.set(dailyUpdate, { merge: true }),
            recentVisitsRef.add(visitRecord)
        ]);

        // 5. Rotação assíncrona leve para manter recent_visits enxuto (últimos 100)
        this._pruneRecentVisitsAsync(recentVisitsRef);

        return visitRecord;
    }

    /**
     * Registra o evento de um usuário clicando para compartilhar uma câmera/conteúdo
     * (WhatsApp, Telegram, Copiar Link, Mobile Share, Facebook, X, QR Code).
     * 
     * @param {object} shareData
     * @param {string} shareData.platform
     * @param {string} [shareData.title]
     * @param {string} [shareData.url]
     * @param {string} [shareData.campaign]
     * @param {string} [shareData.path]
     * @param {string} [shareData.ip]
     * @param {string} [shareData.userAgent]
     * @param {object} [shareData.headers]
     * @returns {Promise<object>}
     */
    async recordShare(shareData = {}) {
        const today = getRioBrancoDateStr();
        const now = new Date();
        const timeStr = formatRioBrancoTime(now);
        const dateStr = formatRioBrancoDate(now);

        const geo = resolveLocation(shareData.ip, shareData.headers || {});
        const device = resolveDevice(shareData.userAgent);
        const ipMasked = maskIp(shareData.ip);
        const cleanPath = (typeof shareData.path === 'string' && shareData.path) ? shareData.path.slice(0, 80) : '/';
        const rawPlatform = String(shareData.platform || 'desconhecido').toLowerCase().trim();

        // Mapeamento amigável da plataforma de compartilhamento
        let platformLabel = 'Outro';
        let icon = 'share-2';
        if (rawPlatform === 'whatsapp') {
            platformLabel = 'WhatsApp';
            icon = 'message-circle';
        } else if (rawPlatform === 'telegram') {
            platformLabel = 'Telegram';
            icon = 'send';
        } else if (rawPlatform === 'copy_link' || rawPlatform.includes('copiar')) {
            platformLabel = 'Link Copiado';
            icon = 'link-2';
        } else if (rawPlatform === 'native_share') {
            platformLabel = 'Compartilhamento Mobile';
            icon = 'share-2';
        } else if (rawPlatform === 'twitter' || rawPlatform.includes('x')) {
            platformLabel = 'X (Twitter)';
            icon = 'twitter';
        } else if (rawPlatform === 'facebook') {
            platformLabel = 'Facebook';
            icon = 'facebook';
        } else if (rawPlatform === 'qr_code') {
            platformLabel = 'QR Code';
            icon = 'qr-code';
        }

        const platformKey = sanitizeKey(platformLabel);
        const pathKey = sanitizeKey(cleanPath);
        const inc = admin.firestore.FieldValue.increment(1);

        const statsUpdate = {
            totalShares: inc,
            sharesByPlatform: { [platformKey]: inc },
            sharesByPath: { [pathKey]: inc },
            lastShareAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const dailyUpdate = {
            shares: inc,
            sharesByPlatform: { [platformKey]: inc },
            sharesByPath: { [pathKey]: inc },
            date: today,
            lastShareAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const statsRef = this.db.collection('stats').doc('traffic');
        const dailyRef = statsRef.collection('daily').doc(today);
        const recentSharesRef = statsRef.collection('recent_shares');

        const shareRecord = {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            createdAtMs: Date.now(),
            timeStr,
            dateStr,
            platform: rawPlatform,
            platformLabel,
            icon,
            title: String(shareData.title || '').slice(0, 100),
            path: cleanPath,
            url: String(shareData.url || '').slice(0, 200),
            campaign: String(shareData.campaign || 'camera_live').slice(0, 50),
            city: geo.city,
            region: geo.region,
            country: geo.country,
            device: device.device,
            os: device.os,
            browser: device.browser,
            ipMasked
        };

        await Promise.all([
            statsRef.set(statsUpdate, { merge: true }),
            dailyRef.set(dailyUpdate, { merge: true }),
            recentSharesRef.add(shareRecord)
        ]);

        this._pruneRecentSharesAsync(recentSharesRef);

        return shareRecord;
    }

    /**
     * Limpa assincronamente registros antigos de recent_visits quando ultrapassar 100 itens.
     * @private
     */
    _pruneRecentVisitsAsync(recentVisitsRef) {
        setImmediate(async () => {
            try {
                const snapshot = await recentVisitsRef
                    .orderBy('createdAtMs', 'desc')
                    .limit(120)
                    .get();

                if (snapshot.docs.length > 100) {
                    const toDelete = snapshot.docs.slice(100);
                    const batch = this.db.batch();
                    toDelete.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                }
            } catch (_) {}
        });
    }

    /**
     * Limpa assincronamente registros antigos de recent_shares quando ultrapassar 100 itens.
     * @private
     */
    _pruneRecentSharesAsync(recentSharesRef) {
        setImmediate(async () => {
            try {
                const snapshot = await recentSharesRef
                    .orderBy('createdAtMs', 'desc')
                    .limit(120)
                    .get();

                if (snapshot.docs.length > 100) {
                    const toDelete = snapshot.docs.slice(100);
                    const batch = this.db.batch();
                    toDelete.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                }
            } catch (_) {}
        });
    }

    /**
     * Obtém todas as estatísticas consolidadas e detalhadas de tráfego, origens e compartilhamentos.
     * Suporta nativamente leitura de mapas aninhados e compatibilidade retroativa
     * com chaves planas legadas gravadas em formato de ponto.
     * 
     * @returns {Promise<object>}
     */
    async getStats() {
        const today = getRioBrancoDateStr();
        const statsRef = this.db.collection('stats').doc('traffic');
        const dailyRef = statsRef.collection('daily').doc(today);
        const recentVisitsRef = statsRef.collection('recent_visits');
        const recentSharesRef = statsRef.collection('recent_shares');

        let statsDoc = { exists: false, data: () => ({}) };
        let dailyDoc = { exists: false, data: () => ({}) };
        let recentSnapshot = { docs: [] };
        let recentSharesSnapshot = { docs: [] };

        try {
            const [sDoc, dDoc] = await Promise.all([
                statsRef.get().catch(() => ({ exists: false, data: () => ({}) })),
                dailyRef.get().catch(() => ({ exists: false, data: () => ({}) }))
            ]);
            statsDoc = sDoc;
            dailyDoc = dDoc;
        } catch (e) {
            console.error('[TrackVisit] Erro ao buscar stats/daily:', e.message);
        }

        try {
            recentSnapshot = await recentVisitsRef.orderBy('createdAtMs', 'desc').limit(50).get();
        } catch (err) {
            console.warn('[TrackVisit] Falha ao ordenar recent_visits por createdAtMs, buscando sem ordenação:', err.message);
            try {
                recentSnapshot = await recentVisitsRef.limit(50).get();
            } catch (err2) {
                console.error('[TrackVisit] Falha ao buscar recent_visits:', err2.message);
                recentSnapshot = { docs: [] };
            }
        }

        try {
            recentSharesSnapshot = await recentSharesRef.orderBy('createdAtMs', 'desc').limit(50).get();
        } catch (_) {
            try {
                recentSharesSnapshot = await recentSharesRef.limit(50).get();
            } catch (_) {
                recentSharesSnapshot = { docs: [] };
            }
        }

        const statsData = statsDoc.exists ? (statsDoc.data() || {}) : {};
        const dailyData = dailyDoc.exists ? (dailyDoc.data() || {}) : {};

        const totalViews = statsData.totalViews || dailyData.views || 0;
        const viewsToday = dailyData.views || 0;

        const totalShares = statsData.totalShares || dailyData.shares || 0;
        const sharesToday = dailyData.shares || 0;

        const referralsFromSharesTotal = statsData.referralsFromShares || 0;
        const referralsFromSharesToday = dailyData.referralsFromShares || 0;

        /**
         * Helper que extrai valores tanto de mapas aninhados quanto de chaves legadas com notação de ponto
         */
        const extractMap = (data, key) => {
            const result = {};
            if (!data || typeof data !== 'object') return result;

            // 1. Mapa aninhado
            if (data[key] && typeof data[key] === 'object' && !Array.isArray(data[key])) {
                for (const [subKey, val] of Object.entries(data[key])) {
                    if (typeof val === 'number') {
                        result[subKey] = (result[subKey] || 0) + val;
                    }
                }
            }

            // 2. Chaves legadas com notação de ponto (ex: 'sources.Acesso Direto')
            const prefix = key + '.';
            for (const [k, v] of Object.entries(data)) {
                if (k.startsWith(prefix)) {
                    const subKey = k.slice(prefix.length);
                    if (typeof v === 'number') {
                        result[subKey] = (result[subKey] || 0) + v;
                    }
                }
            }

            return result;
        };

        const recentVisits = (recentSnapshot.docs || [])
            .map(doc => {
                const d = doc.data() || {};
                const createdMs = d.createdAtMs || (d.timestamp?.toMillis ? d.timestamp.toMillis() : 0);
                return {
                    id: doc.id,
                    createdAtMs: createdMs,
                    timeStr: d.timeStr || '--:--',
                    dateStr: d.dateStr || '',
                    source: d.source || 'Acesso Direto',
                    category: d.category || 'Acesso Direto',
                    icon: d.icon || 'globe',
                    city: d.city || 'Rio Branco',
                    region: d.region || 'Acre (AC)',
                    country: d.country || 'Brasil',
                    device: d.device || 'Desktop',
                    os: d.os || 'Windows',
                    browser: d.browser || 'Chrome',
                    path: d.path || '/',
                    entryPath: d.entryPath || d.path || '/',
                    entrySource: d.entrySource || '',
                    ipMasked: d.ipMasked || '***.***.***.***',
                    utm: d.utm || null,
                    isCampaign: !!d.isCampaign,
                    isShared: !!d.isShared,
                    screen: d.screen || '',
                    pixelRatio: d.pixelRatio || 1,
                    timezone: d.timezone || '',
                    language: d.language || '',
                    gpu: d.gpu || '',
                    cores: d.cores || 0,
                    connection: d.connection || ''
                };
            })
            .sort((a, b) => b.createdAtMs - a.createdAtMs);

        const recentShares = (recentSharesSnapshot.docs || [])
            .map(doc => {
                const d = doc.data() || {};
                const createdMs = d.createdAtMs || (d.timestamp?.toMillis ? d.timestamp.toMillis() : 0);
                return {
                    id: doc.id,
                    createdAtMs: createdMs,
                    timeStr: d.timeStr || '--:--',
                    dateStr: d.dateStr || '',
                    platform: d.platform || 'desconhecido',
                    platformLabel: d.platformLabel || 'Outro',
                    icon: d.icon || 'share-2',
                    title: d.title || '',
                    path: d.path || '/',
                    city: d.city || 'Rio Branco',
                    region: d.region || 'Acre (AC)',
                    device: d.device || 'Mobile',
                    os: d.os || '',
                    browser: d.browser || '',
                    ipMasked: d.ipMasked || '***.***.***.***'
                };
            })
            .sort((a, b) => b.createdAtMs - a.createdAtMs);

        return {
            totalViews,
            viewsToday,

            // Métricas de Compartilhamento
            totalShares,
            sharesToday,
            referralsFromSharesTotal,
            referralsFromSharesToday,
            sharesByPlatformToday: extractMap(dailyData, 'sharesByPlatform'),
            sharesByPlatformTotal: extractMap(statsData, 'sharesByPlatform'),
            sharesByPathToday: extractMap(dailyData, 'sharesByPath'),
            sharesByPathTotal: extractMap(statsData, 'sharesByPath'),
            referralsBySharePlatformToday: extractMap(dailyData, 'referralsBySharePlatform'),
            referralsBySharePlatformTotal: extractMap(statsData, 'referralsBySharePlatform'),

            // Origens & Canais
            sourcesToday: extractMap(dailyData, 'sources'),
            sourcesTotal: extractMap(statsData, 'sources'),
            categoriesToday: extractMap(dailyData, 'categories'),
            categoriesTotal: extractMap(statsData, 'categories'),

            // Geolocalização
            citiesToday: extractMap(dailyData, 'cities'),
            citiesTotal: extractMap(statsData, 'cities'),
            regionsToday: extractMap(dailyData, 'regions'),
            regionsTotal: extractMap(statsData, 'regions'),
            countriesToday: extractMap(dailyData, 'countries'),
            countriesTotal: extractMap(statsData, 'countries'),

            // Dispositivos & Navegadores
            devicesToday: extractMap(dailyData, 'devices'),
            devicesTotal: extractMap(statsData, 'devices'),
            browsersToday: extractMap(dailyData, 'browsers'),
            browsersTotal: extractMap(statsData, 'browsers'),
            operatingSystemsToday: extractMap(dailyData, 'operatingSystems'),
            operatingSystemsTotal: extractMap(statsData, 'operatingSystems'),

            // Campanhas, Páginas & Landing Pages
            utmSourcesToday: extractMap(dailyData, 'utmSources'),
            utmSourcesTotal: extractMap(statsData, 'utmSources'),
            utmContentsToday: extractMap(dailyData, 'utmContents'),
            utmContentsTotal: extractMap(statsData, 'utmContents'),
            pathsToday: extractMap(dailyData, 'paths'),
            pathsTotal: extractMap(statsData, 'paths'),
            entryPathsToday: extractMap(dailyData, 'entryPaths'),
            entryPathsTotal: extractMap(statsData, 'entryPaths'),

            // Feeds em tempo real
            recentVisits,
            recentShares
        };
    }
}

module.exports = TrackVisitUseCase;
