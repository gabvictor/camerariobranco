const fs = require('fs');
const path = require('path');

const PUBLIC_FOLDER = path.join(__dirname, '..', 'public');

console.log('=== TESTE DE VALIDAÇÃO DE SEO E JSON-LD ===');

// 1. Validar JSON-LD em todos os arquivos HTML
const htmlFiles = [
    'index.html',
    'mapa.html',
    'rio.html',
    'timelapses.html',
    'sobre.html',
    'novidades.html',
    'contato.html',
    'termos.html'
];

let hasError = false;

htmlFiles.forEach(file => {
    const filePath = path.join(PUBLIC_FOLDER, file);
    if (!fs.existsSync(filePath)) {
        console.error(`❌ Arquivo não encontrado: ${file}`);
        hasError = true;
        return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    
    // Teste de tag canonical
    const canonicalMatch = content.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
    if (!canonicalMatch) {
        console.error(`❌ ${file} está sem link canonical!`);
        hasError = true;
    } else {
        console.log(`✔ ${file} canonical: ${canonicalMatch[1]}`);
    }

    // Teste de meta robots
    const robotsMatch = content.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
    if (!robotsMatch) {
        console.error(`❌ ${file} está sem meta robots!`);
        hasError = true;
    } else {
        console.log(`✔ ${file} robots: ${robotsMatch[1]}`);
    }

    // Teste de JSON-LD
    const jsonLdMatches = [...content.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
    if (jsonLdMatches.length === 0) {
        console.warn(`⚠ ${file} não possui JSON-LD.`);
    } else {
        jsonLdMatches.forEach((match, idx) => {
            try {
                const parsed = JSON.parse(match[1]);
                console.log(`✔ ${file} JSON-LD #${idx + 1} válido (@type: ${parsed['@type'] || (parsed['@graph'] ? parsed['@graph'].map(g => g['@type']).join(', ') : 'unknown')})`);
            } catch (err) {
                console.error(`❌ ${file} JSON-LD #${idx + 1} INVÁLIDO:`, err.message);
                hasError = true;
            }
        });
    }
});

// 2. Validar páginas noindex
['embed.html', 'login.html', 'perfil.html', '404.html', 'ads-test.html'].forEach(file => {
    const filePath = path.join(PUBLIC_FOLDER, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const robotsMatch = content.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
    if (!robotsMatch || !robotsMatch[1].includes('noindex')) {
        console.error(`❌ ${file} DEVERIA conter noindex!`);
        hasError = true;
    } else {
        console.log(`✔ ${file} protegido com noindex: ${robotsMatch[1]}`);
    }
});

// 3. Validar robots.txt
const robotsTxt = fs.readFileSync(path.join(PUBLIC_FOLDER, 'robots.txt'), 'utf8');
if (!robotsTxt.includes('Sitemap: https://camerasriobranco.com.br/sitemap.xml')) {
    console.error('❌ robots.txt não contém URL do Sitemap!');
    hasError = true;
} else {
    console.log('✔ robots.txt contém apontamento correto para sitemap.xml');
}

if (!robotsTxt.includes('User-agent: Googlebot-Image')) {
    console.error('❌ robots.txt não contém regras para Googlebot-Image!');
    hasError = true;
} else {
    console.log('✔ robots.txt contém regras para Googlebot-Image');
}

// 4. Validar sitemap.xml estático
const sitemapXml = fs.readFileSync(path.join(PUBLIC_FOLDER, 'sitemap.xml'), 'utf8');
if (!sitemapXml.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')) {
    console.error('❌ sitemap.xml não contém namespace de imagem!');
    hasError = true;
} else {
    console.log('✔ sitemap.xml contém namespace de imagem do Google');
}

if (hasError) {
    console.error('\n❌ Houve falhas na validação.');
    process.exit(1);
} else {
    console.log('\n🎉 TODOS OS TESTES DE VALIDAÇÃO PASSARAM COM SUCESSO!');
}
