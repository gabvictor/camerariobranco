/**
 * Test script for Origin Tracking, GeoIP, and Device Telemetry.
 */
const { parseOrigin } = require('../src/utils/originParser');
const { resolveLocation, maskIp, extractClientIp } = require('../src/utils/geoUtils');
const { resolveDevice } = require('../src/utils/deviceUtils');

let passed = 0;
let total = 0;

function assert(desc, condition) {
    total++;
    if (condition) {
        console.log(`  ✅ [PASS] ${desc}`);
        passed++;
    } else {
        console.error(`  ❌ [FAIL] ${desc}`);
    }
}

console.log('🧪 Iniciando testes de Origens, GeoIP e Dispositivos...\n');

// ─── 1. Testes de Origin Parser ──────────────────────────────────────────────
console.log('📦 1. Testando originParser:');

const googleOrigin = parseOrigin({ referrer: 'https://www.google.com.br/search?q=camera+rio+branco' });
assert('Google (Busca Orgânica) detectado corretamente', googleOrigin.source === 'Google' && googleOrigin.category === 'Busca Orgânica');

const instaOrigin = parseOrigin({ referrer: 'https://l.instagram.com/' });
assert('Instagram detectado corretamente', instaOrigin.source === 'Instagram' && instaOrigin.category === 'Redes Sociais');

const waOrigin = parseOrigin({ referrer: 'https://web.whatsapp.com/' });
assert('WhatsApp detectado corretamente', waOrigin.source === 'WhatsApp' && waOrigin.category === 'Mensageiros');

const ac24Origin = parseOrigin({ referrer: 'https://ac24horas.com/2026/08/24/nivel-do-rio-acre/' });
assert('ac24horas detectado como Portal de Notícias', ac24Origin.source === 'ac24horas' && ac24Origin.category === 'Portais de Notícias');

const directOrigin = parseOrigin({ referrer: '' });
assert('Acesso Direto detectado quando referrer é vazio', directOrigin.source === 'Acesso Direto' && directOrigin.category === 'Acesso Direto');

const utmOrigin = parseOrigin({ utm_source: 'instagram', utm_medium: 'stories', utm_campaign: 'enchente2026' });
assert('Campanha UTM Instagram detectada e formatada', utmOrigin.isCampaign === true && utmOrigin.source.includes('Instagram') && utmOrigin.source.includes('enchente2026'));

const waShareOrigin = parseOrigin({ utm_source: 'whatsapp', utm_medium: 'social_share', utm_campaign: 'camera_live' });
assert('Compartilhamento WhatsApp detectado como Mensageiros', waShareOrigin.category === 'Mensageiros' && waShareOrigin.source.includes('WhatsApp'));

const tgShareOrigin = parseOrigin({ utm_source: 'telegram', utm_medium: 'social_share', utm_campaign: 'camera_live' });
assert('Compartilhamento Telegram detectado como Mensageiros', tgShareOrigin.category === 'Mensageiros' && tgShareOrigin.source.includes('Telegram'));

const qrShareOrigin = parseOrigin({ utm_source: 'qr_code', utm_medium: 'offline_scan', utm_campaign: 'camera_live' });
assert('QR Code detectado como Offline / QR Code', qrShareOrigin.category === 'Offline / QR Code' && qrShareOrigin.icon === 'qr-code');

const directShareOrigin = parseOrigin({ utm_source: 'share_link', utm_medium: 'clipboard', campaign: 'direct_share' });
assert('Link Copiado detectado como Compartilhamento Direto', directShareOrigin.category === 'Compartilhamento' && directShareOrigin.icon === 'share-2');

// ─── 2. Testes de GeoUtils & IP Masking ───────────────────────────────────────
console.log('\n🌍 2. Testando geoUtils:');

const masked = maskIp('177.136.24.55');
assert('IP mascarado para privacidade (LGPD)', masked === '177.136.***.***');

const localGeo = resolveLocation('127.0.0.1');
assert('IP Local resolvido para Rio Branco (Local)', localGeo.city.includes('Rio Branco') && localGeo.country === 'Brasil');

const cfHeadersGeo = resolveLocation('200.1.2.3', {
    'cf-ipcountry': 'BR',
    'cf-region': 'AC',
    'cf-ipcity': encodeURIComponent('Rio Branco')
});
assert('Cloudflare Geo Headers resolvidos', cfHeadersGeo.country === 'Brasil' && cfHeadersGeo.region.includes('Acre') && cfHeadersGeo.city === 'Rio Branco');

// ─── 3. Testes de DeviceUtils ───────────────────────────────────────────────
console.log('\n📱 3. Testando deviceUtils:');

const iphoneDevice = resolveDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
assert('iPhone detectado como Mobile e iOS', iphoneDevice.device === 'Mobile' && iphoneDevice.os === 'iOS' && iphoneDevice.browser === 'Safari');

const androidDevice = resolveDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
assert('Android detectado como Mobile e Chrome', androidDevice.device === 'Mobile' && androidDevice.os === 'Android' && androidDevice.browser === 'Chrome');

const windowsPc = resolveDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
assert('Windows PC detectado como Desktop e Windows', windowsPc.device === 'Desktop' && windowsPc.os.includes('Windows') && windowsPc.browser === 'Chrome');

console.log(`\n🏁 Resultado: ${passed}/${total} testes passaram com sucesso!`);

if (passed === total) {
    process.exit(0);
} else {
    process.exit(1);
}
