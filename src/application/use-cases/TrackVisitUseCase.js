const { admin } = require('../../config/firebaseAdmin');
const { getRioBrancoDateStr, formatRioBrancoTime, formatRioBrancoDate } = require('../../utils/dateUtils');
const { parseOrigin, sanitizeKey } = require('../../utils/originParser');
const { resolveLocation, maskIp } = require('../../utils/geoUtils');
const { resolveDevice } = require('../../utils/deviceUtils');

/**
 * @use-case TrackVisitUseCase
 * Registra e agrega métricas de tráfego, fontes de origem (referrers e UTMs),
 * distribuição geográfica e dispositivos dos visitantes no fuso do Acre.
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
            utm_campaign: visitData.utm_campaign
        });

        const geo = resolveLocation(visitData.ip, visitData.headers || {});
        const device = resolveDevice(visitData.userAgent, visitData.screenWidth);
        const ipMasked = maskIp(visitData.ip);
        const cleanPath = (typeof visitData.path === 'string' && visitData.path) ? visitData.path.slice(0, 80) : '/';

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

        const inc = admin.firestore.FieldValue.increment(1);

        // 3. Montagem dos updates atômicos
        const statsUpdate = {
            totalViews: inc,
            [`sources.${sourceKey}`]: inc,
            [`categories.${categoryKey}`]: inc,
            [`cities.${cityKey}`]: inc,
            [`regions.${regionKey}`]: inc,
            [`countries.${countryKey}`]: inc,
            [`devices.${deviceKey}`]: inc,
            [`browsers.${browserKey}`]: inc,
            [`operatingSystems.${osKey}`]: inc,
            [`paths.${pathKey}`]: inc,
            lastVisitAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const dailyUpdate = {
            views: inc,
            [`sources.${sourceKey}`]: inc,
            [`categories.${categoryKey}`]: inc,
            [`cities.${cityKey}`]: inc,
            [`regions.${regionKey}`]: inc,
            [`countries.${countryKey}`]: inc,
            [`devices.${deviceKey}`]: inc,
            [`browsers.${browserKey}`]: inc,
            [`operatingSystems.${osKey}`]: inc,
            [`paths.${pathKey}`]: inc,
            date: today,
            lastVisitAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (origin.utm.source) {
            const utmKey = sanitizeKey(origin.utm.source);
            statsUpdate[`utmSources.${utmKey}`] = inc;
            dailyUpdate[`utmSources.${utmKey}`] = inc;
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
            utm: origin.utm,
            rawReferrer: origin.rawReferrer,
            city: geo.city,
            region: geo.region,
            country: geo.country,
            device: device.device,
            os: device.os,
            browser: device.browser,
            path: cleanPath,
            ipMasked
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
     * Limpa assincronamente registros antigos de recent_visits quando ultrapassar 100 itens.
     * @private
     */
    _pruneRecentVisitsAsync(recentVisitsRef) {
        // Executa em segundo plano sem bloquear a resposta da requisição
        setImmediate(async () => {
            try {
                const snapshot = await recentVisitsRef
                    .orderBy('createdAtMs', 'desc')
                    .offset(100)
                    .limit(20)
                    .get();

                if (!snapshot.empty) {
                    const batch = this.db.batch();
                    snapshot.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                }
            } catch (_) {
                // Silencioso para não poluir logs com rotação de telemetria
            }
        });
    }

    /**
     * Obtém todas as estatísticas consolidadas e detalhadas de tráfego e origens.
     * 
     * @returns {Promise<object>}
     */
    async getStats() {
        const today = getRioBrancoDateStr();
        const statsRef = this.db.collection('stats').doc('traffic');
        const dailyRef = statsRef.collection('daily').doc(today);
        const recentVisitsRef = statsRef.collection('recent_visits');

        const [statsDoc, dailyDoc, recentSnapshot] = await Promise.all([
            statsRef.get(),
            dailyRef.get(),
            recentVisitsRef.orderBy('createdAtMs', 'desc').limit(50).get().catch(() => ({ docs: [] }))
        ]);

        const statsData = statsDoc.exists ? statsDoc.data() : {};
        const dailyData = dailyDoc.exists ? dailyDoc.data() : {};

        const recentVisits = (recentSnapshot.docs || []).map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                timeStr: d.timeStr || '--:--',
                dateStr: d.dateStr || '',
                source: d.source || 'Acesso Direto',
                category: d.category || 'Acesso Direto',
                icon: d.icon || 'globe',
                city: d.city || 'Rio Branco',
                region: d.region || 'Acre (AC)',
                country: d.country || 'Brasil',
                device: d.device || 'Mobile',
                os: d.os || 'Android',
                browser: d.browser || 'Chrome',
                path: d.path || '/',
                ipMasked: d.ipMasked || '***.***.***.***',
                utm: d.utm || null,
                isCampaign: !!d.isCampaign
            };
        });

        return {
            totalViews: statsData.totalViews || 0,
            viewsToday: dailyData.views || 0,

            // Origens & Canais
            sourcesToday: dailyData.sources || {},
            sourcesTotal: statsData.sources || {},
            categoriesToday: dailyData.categories || {},
            categoriesTotal: statsData.categories || {},

            // Geolocalização
            citiesToday: dailyData.cities || {},
            citiesTotal: statsData.cities || {},
            regionsToday: dailyData.regions || {},
            regionsTotal: statsData.regions || {},
            countriesToday: dailyData.countries || {},
            countriesTotal: statsData.countries || {},

            // Dispositivos & Navegadores
            devicesToday: dailyData.devices || {},
            devicesTotal: statsData.devices || {},
            browsersToday: dailyData.browsers || {},
            browsersTotal: statsData.browsers || {},
            operatingSystemsToday: dailyData.operatingSystems || {},
            operatingSystemsTotal: statsData.operatingSystems || {},

            // Campanhas & Páginas
            utmSourcesToday: dailyData.utmSources || {},
            utmSourcesTotal: statsData.utmSources || {},
            pathsToday: dailyData.paths || {},
            pathsTotal: statsData.paths || {},

            // Últimos Visitantes
            recentVisits
        };
    }
}

module.exports = TrackVisitUseCase;
