const { getRioBrancoDateStr } = require('../src/utils/dateUtils');
const CONFIG = require('../src/config/appConfig');

const escapeXml = (unsafe) => {
    if (!unsafe) return '';
    return String(unsafe).replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

function generateTestSitemap() {
    const baseUrl = CONFIG.SITE_BASE_URL;
    const lastMod = getRioBrancoDateStr();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';

    const staticPages = [
        { path: '', changefreq: 'daily', priority: '1.0', img: `${baseUrl}/assets/camrb.png`, title: 'Câmeras Rio Branco Ao Vivo 24h', caption: 'Monitoramento de trânsito e segurança em tempo real em Rio Branco, Acre' },
        { path: 'rio', changefreq: 'hourly', priority: '0.9', img: `${baseUrl}/proxy/camera/001426`, title: 'Nível do Rio Acre em Tempo Real', caption: 'Telemetria oficial da ANA/CPRM e câmera ao vivo da Ponte Metálica' },
        { path: 'timelapses', changefreq: 'daily', priority: '0.8', img: `${baseUrl}/assets/camrb.png`, title: 'Galeria de Timelapses 24h de Rio Branco' },
        { path: 'mapa', changefreq: 'weekly', priority: '0.8', img: `${baseUrl}/assets/camrb.png`, title: 'Mapa Interativo de Câmeras de Rio Branco' },
        { path: 'sobre', changefreq: 'monthly', priority: '0.7' },
        { path: 'novidades', changefreq: 'weekly', priority: '0.7' },
        { path: 'contato', changefreq: 'monthly', priority: '0.6' },
        { path: 'termos', changefreq: 'monthly', priority: '0.5' }
    ];

    staticPages.forEach(p => {
        const loc = p.path ? `${baseUrl}/${p.path}` : `${baseUrl}/`;
        xml += '  <url>\n';
        xml += `    <loc>${loc}</loc>\n`;
        xml += `    <lastmod>${lastMod}</lastmod>\n`;
        xml += `    <changefreq>${p.changefreq}</changefreq>\n`;
        xml += `    <priority>${p.priority}</priority>\n`;
        if (p.img) {
            xml += '    <image:image>\n';
            xml += `      <image:loc>${p.img}</image:loc>\n`;
            xml += `      <image:title>${escapeXml(p.title)}</image:title>\n`;
            if (p.caption) {
                xml += `      <image:caption>${escapeXml(p.caption)}</image:caption>\n`;
            }
            xml += '    </image:image>\n';
        }
        xml += '  </url>\n';
    });

    const mockCameras = [
        { codigo: '001426', nome: 'Ponte Metálica & Centro', status: 'online', level: 1 },
        { codigo: '001334', nome: 'De Olho no Rio <Acre>', status: 'offline', level: 1 },
        { codigo: '001999', nome: 'Admin Secret', status: 'online', level: 3 }
    ];

    mockCameras.forEach(camera => {
        if (!camera.codigo || camera.level === 3) return;
        const isOnline = camera.status === 'online';
        const camName = escapeXml(camera.nome || `Câmera ${camera.codigo}`);
        const camUrl = `${baseUrl}/camera/${camera.codigo}`;
        const imgUrl = `${baseUrl}/proxy/camera/${camera.codigo}`;

        xml += '  <url>\n';
        xml += `    <loc>${camUrl}</loc>\n`;
        xml += `    <lastmod>${lastMod}</lastmod>\n`;
        xml += `    <changefreq>${isOnline ? 'always' : 'daily'}</changefreq>\n`;
        xml += `    <priority>${isOnline ? '0.9' : '0.6'}</priority>\n`;
        xml += '    <image:image>\n';
        xml += `      <image:loc>${imgUrl}</image:loc>\n`;
        xml += `      <image:title>Câmera Ao Vivo: ${camName}</image:title>\n`;
        xml += `      <image:caption>Transmissão ao vivo de trânsito e segurança em Rio Branco - AC: ${camName}</image:caption>\n`;
        xml += '    </image:image>\n';
        xml += '  </url>\n';
    });

    xml += '</urlset>';
    return xml;
}

const xml = generateTestSitemap();
console.log('Tamanho do XML gerado:', xml.length, 'bytes');

// Validar se tem caracteres ilegais em XML (como '& ' ou '<' dentro de texto não escapado)
if (xml.includes('& Centro') || xml.includes('<Acre>')) {
    console.error('❌ XML contém texto sem escape!');
    process.exit(1);
}

if (!xml.includes('&amp; Centro') || !xml.includes('&lt;Acre&gt;')) {
    console.error('❌ escapeXml falhou ao escapar caracteres especiais!');
    process.exit(1);
}

if (xml.includes('001999')) {
    console.error('❌ Câmera level 3 vazou no sitemap!');
    process.exit(1);
}

console.log('✔ Validação do XML gerado: caracteres especiais escapados corretamente, level 3 filtrado.');
console.log('✔ Amostra do XML gerado:\n', xml.slice(0, 500), '...\n', xml.slice(-300));
