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
            const utmContent = searchParams.get('utm_content');
            const utmTerm = searchParams.get('utm_term');
            const hasUtm = !!(utmSource || utmMedium || utmCampaign || utmContent || utmTerm);

            const referrer = document.referrer || '';
            const isExternalReferrer = !!(referrer && !referrer.includes(window.location.hostname));

            // Atribuição de Entrada (Landing Page & Canal Original da Sessão)
            const entryPathKey = 'camrb_entry_path';
            const entrySourceKey = 'camrb_entry_source';
            let storedEntryPath = '';
            let storedEntrySource = '';
            try {
                if (!sessionStorage.getItem(entryPathKey)) {
                    sessionStorage.setItem(entryPathKey, window.location.pathname);
                }
                storedEntryPath = sessionStorage.getItem(entryPathKey) || window.location.pathname;

                if (hasUtm) {
                    storedEntrySource = utmSource || '';
                    sessionStorage.setItem(entrySourceKey, storedEntrySource);
                } else if (isExternalReferrer) {
                    storedEntrySource = referrer;
                    sessionStorage.setItem(entrySourceKey, storedEntrySource);
                } else {
                    storedEntrySource = sessionStorage.getItem(entrySourceKey) || '';
                }
            } catch (_) {}

            // Verifica se a sessão atual já foi registrada
            const sessionKey = 'camrb_tracked_session';
            const isSessionTracked = sessionStorage.getItem(sessionKey);
            const isCookieVisited = document.cookie.includes('camrb_visited_today=1');

            // Se já rastreou a sessão e não tem UTM nova nem referrer externo novo, economiza request
            if (isSessionTracked && isCookieVisited && !hasUtm) {
                return;
            }

            function getGpuRenderer() {
                try {
                    var canvas = document.createElement('canvas');
                    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                    if (!gl) return '';
                    var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    if (!debugInfo) return '';
                    var renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
                    return String(renderer).replace(/ANGLE \((.*)\)/, '$1').substring(0, 60).trim();
                } catch (_) {
                    return '';
                }
            }

            var screenRes = window.screen ? (window.screen.width + 'x' + window.screen.height) : '';
            var tz = '';
            try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
            var lang = navigator.language || (navigator.languages && navigator.languages[0]) || '';
            var conn = (navigator.connection && navigator.connection.effectiveType) || '';

            const payload = {
                referrer: referrer,
                utm_source: utmSource || '',
                utm_medium: utmMedium || '',
                utm_campaign: utmCampaign || '',
                utm_content: utmContent || '',
                utm_term: utmTerm || '',
                entryPath: storedEntryPath || window.location.pathname,
                entrySource: storedEntrySource || '',
                path: window.location.pathname,
                screenWidth: window.screen ? window.screen.width : (window.innerWidth || 0),
                screen: screenRes,
                pixelRatio: window.devicePixelRatio || 1,
                timezone: tz,
                language: lang,
                gpu: getGpuRenderer(),
                cores: navigator.hardwareConcurrency || 0,
                connection: conn,
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
