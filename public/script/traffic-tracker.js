/**
 * @file traffic-tracker.js
 * Rastreamento universal e leve de fontes de tráfego, referrers e UTMs.
 * Executa em todas as páginas públicas de forma assíncrona e não intrusiva.
 */
(function() {
    'use strict';

    function trackVisit() {
        try {
            // Evita rastreamento em iframes de terceiros ou em ambiente de desenvolvimento excessivo
            if (window.self !== window.top && !window.location.pathname.startsWith('/embed')) {
                return;
            }

            const searchParams = new URLSearchParams(window.location.search);
            const utmSource = searchParams.get('utm_source');
            const utmMedium = searchParams.get('utm_medium');
            const utmCampaign = searchParams.get('utm_campaign');
            const hasUtm = !!(utmSource || utmMedium || utmCampaign);

            const referrer = document.referrer || '';
            const isExternalReferrer = referrer && !referrer.includes(window.location.hostname);

            // Verifica se a sessão atual já foi registrada
            const sessionKey = 'camrb_tracked_session';
            const isSessionTracked = sessionStorage.getItem(sessionKey);
            const isCookieVisited = document.cookie.includes('camrb_visited_today=1');

            // Se já rastreou a sessão e não tem UTM nova nem referrer externo novo, economiza request
            if (isSessionTracked && isCookieVisited && !hasUtm) {
                return;
            }

            const payload = {
                referrer: referrer,
                utm_source: utmSource || '',
                utm_medium: utmMedium || '',
                utm_campaign: utmCampaign || '',
                path: window.location.pathname,
                screenWidth: window.screen ? window.screen.width : (window.innerWidth || 0),
                force: hasUtm || isExternalReferrer
            };

            // Marca sessão como rastreada para evitar duplicação em navegação interna subsequente
            try {
                sessionStorage.setItem(sessionKey, '1');
            } catch (_) {}

            const url = '/api/track-visit';
            const bodyStr = JSON.stringify(payload);

            // Prioriza fetch com keepalive
            if (typeof fetch === 'function') {
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: bodyStr,
                    keepalive: true
                }).catch(function() {});
            } else if (navigator.sendBeacon) {
                const blob = new Blob([bodyStr], { type: 'application/json' });
                navigator.sendBeacon(url, blob);
            }
        } catch (_) {
            // Silencioso em caso de navegadores antigos ou restrições de privacidade
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', trackVisit);
    } else {
        trackVisit();
    }
})();
