const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GuideRenderer = require('../src/infrastructure/services/GuideRenderer');
const { GUIAS } = require('../src/content/guias');

const renderer = new GuideRenderer({ guias: GUIAS, templatePath: GuideRenderer.defaultTemplate, baseUrl: 'https://exemplo.com.br/' });

const palavras = (g) => [g.intro, ...(g.secoes || []).flatMap((s) => [...(s.p || []), ...(s.p2 || []), ...(s.list || []), s.nota || '']), ...(g.faq || []).flat()]
    .join(' ').split(/\s+/).filter(Boolean).length;

test('cada guia tem texto de verdade, título, descrição e data de revisão', () => {
    const slugs = new Set();
    for (const g of GUIAS) {
        assert.ok(!slugs.has(g.slug), `slug repetido: ${g.slug}`);
        slugs.add(g.slug);
        assert.match(g.slug, /^[a-z0-9-]+$/);
        assert.ok(palavras(g) >= 450, `${g.slug} tem só ${palavras(g)} palavras`);
        assert.ok(g.descricao.length >= 80 && g.descricao.length <= 200, `${g.slug}: descrição com ${g.descricao.length} caracteres`);
        assert.match(g.atualizado, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(g.titulo && g.curto && g.resumo && g.intro);
    }
    assert.ok(GUIAS.length >= 5);
});

test('todo link interno aponta para uma página que existe', () => {
    const rotas = new Set(['/', '/rio', '/termos', '/contato', '/patrocine', '/sobre', '/guias', ...GUIAS.map((g) => `/guias/${g.slug}`)]);
    const bruto = JSON.stringify(GUIAS);
    const links = [...bruto.matchAll(/\]\((\/[^)]*)\)/g)].map((m) => m[1]);
    assert.ok(links.length > 10);
    for (const l of links) assert.ok(rotas.has(l), `link quebrado: ${l}`);
    for (const g of GUIAS) for (const r of g.relacionados || []) assert.ok(renderer.find(r), `${g.slug}: relacionado inexistente ${r}`);
});

test('a página sai completa: sem marcadores soltos, com título, canonical, JSON-LD válido e texto visível', () => {
    for (const g of GUIAS) {
        const html = renderer.renderGuide(g.slug);
        assert.ok(!/\{\{[A-Z]+\}\}/.test(html), `${g.slug}: sobrou marcador do modelo`);
        assert.match(html, new RegExp(`<link rel="canonical" href="https://exemplo\\.com\\.br/guias/${g.slug}">`));
        assert.match(html, /<h1>/);
        assert.equal((html.match(/<h1>/g) || []).length, 1);
        const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
        const dados = JSON.parse(ld[1]);
        assert.ok(dados['@graph'].some((n) => n['@type'] === 'BreadcrumbList'));
        assert.ok(html.includes('guia-script.js'));
        assert.ok(html.includes(g.intro.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').slice(0, 40).replace(/"/g, '&quot;')));
    }
});

test('as perguntas frequentes viram FAQPage com a mesma lista que aparece na tela', () => {
    const g = GUIAS.find((x) => x.faq);
    const html = renderer.renderGuide(g.slug);
    const dados = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    const faq = dados['@graph'].find((n) => n['@type'] === 'FAQPage');
    assert.equal(faq.mainEntity.length, g.faq.length);
    assert.equal((html.match(/<details>/g) || []).length, g.faq.length);
});

test('texto vindo do conteúdo é escapado e links só aceitam rotas do próprio site', () => {
    const falso = new GuideRenderer({
        guias: [{ slug: 'x', titulo: 'T <img src=x onerror=alert(1)>', curto: 'C', resumo: 'R', descricao: 'D', atualizado: '2026-01-01',
            intro: 'Veja [aqui](/rio) e [lá](https://mal.com/x) e </script><script>alert(1)</script>', secoes: [{ h: 'S', p: ['a'] }] }],
        templatePath: GuideRenderer.defaultTemplate, baseUrl: 'https://e.com'
    });
    const html = falso.renderGuide('x');
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(html.includes('<a href="/rio">aqui</a>'));
    assert.ok(!html.includes('href="https://mal.com'));
    const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
    assert.doesNotThrow(() => JSON.parse(ld));
    assert.equal(falso.renderGuide('nao-existe'), null);
});

test('o índice lista todos os guias e a página inicial aponta para eles', () => {
    const indice = renderer.renderIndex();
    for (const g of GUIAS) assert.ok(indice.includes(`/guias/${g.slug}`));
    const home = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.ok(home.includes('/guias/cotas-do-rio-acre'), 'a home deve linkar os guias');
    const secao = home.match(/<section[^>]*aria-labelledby="home-sobre">([\s\S]*?)<\/section>/)[1];
    const textoVisivel = secao.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(textoVisivel >= 250, `a home tem só ${textoVisivel} palavras de texto próprio`);
});

test('páginas sem texto próprio (grade de câmeras e câmera individual) não têm bloco de anúncio', () => {
    const pub = path.join(__dirname, '..', 'public');
    for (const f of ['index.html', 'camera.html']) {
        assert.ok(!/<ins class="adsbygoogle/.test(fs.readFileSync(path.join(pub, f), 'utf8')), `${f} ainda tem anúncio`);
    }
    assert.ok(!fs.existsSync(path.join(pub, 'ads-test.html')));
});

test('o servidor publica /guias, cada guia e o sitemap com os guias', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(server, /app\.get\('\/guias', /);
    assert.match(server, /app\.get\('\/guias\/:slug'/);
    assert.match(server, /GUIAS\.map\(\(g\) => \(\{ path: `guias\/\$\{g\.slug\}`/);
});
