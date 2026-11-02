const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADMIN_DIR = path.join(ROOT, 'src', 'views', 'admin');
// O arquivo é um módulo de navegador (o package.json não é "type: module"): carrega como ESM por data URL, em qualquer versão do Node.
const load = () => {
    const code = fs.readFileSync(path.join(ROOT, 'public', 'script', 'admin-nav.js'), 'utf8');
    return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};

test('todas as páginas do painel usam o menu único e nenhuma guarda uma cópia do menu antigo', () => {
    const arquivos = fs.readdirSync(ADMIN_DIR).filter((f) => f.endsWith('.html'));
    assert.ok(arquivos.length >= 10);
    for (const f of arquivos) {
        const html = fs.readFileSync(path.join(ADMIN_DIR, f), 'utf8');
        assert.equal((html.match(/id="admin-nav"/g) || []).length, 1, `${f}: precisa de um (e só um) ponto de montagem do menu`);
        assert.equal((html.match(/src="\/script\/admin-nav\.js/g) || []).length, 1, `${f}: precisa carregar admin-nav.js`);
        assert.ok(!/<nav class="flex items-center gap-2 overflow-x-auto pb-2/.test(html), `${f}: ainda tem a cópia do menu antigo`);
    }
});

test('o menu tem 6 áreas e toda página administrativa do servidor pertence a alguma delas', async () => {
    const { AREAS, findArea } = await load();
    assert.equal(AREAS.length, 6);
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const rotas = [...server.matchAll(/app\.get\('(\/(?:admin[^':]*|dashboard))'(?:,\s*verifyAdminPageSession)/g)].map((m) => m[1]);
    assert.ok(rotas.length >= 8, `rotas encontradas: ${rotas.join(', ')}`);
    for (const r of rotas) assert.ok(findArea(r), `a rota ${r} não está em nenhuma área do menu`);
    const todas = AREAS.flatMap((a) => a.sub.map((s) => s.href));
    assert.equal(new Set(todas).size, todas.length, 'link repetido no menu');
});

test('a área ativa é achada pela página aberta, inclusive comentários com id e a raiz /admin', async () => {
    const { findArea, matches } = await load();
    assert.equal(findArea('/admin/visitantes').id, 'audiencia');
    assert.equal(findArea('/admin/origens/').id, 'audiencia');
    assert.equal(findArea('/admin/monitor').id, 'sistema');
    assert.equal(findArea('/admin/logs').id, 'sistema');
    assert.equal(findArea('/admin').id, 'cameras');                     // /admin só vale na raiz
    assert.equal(findArea('/admin/analise-cameras').id, 'cameras');
    assert.equal(findArea('/admin/comments/CAM1/abc').id, 'comunidade');
    assert.equal(findArea('/admin/reports').id, 'comunidade');
    assert.equal(findArea('/dashboard').id, 'geral');
    assert.equal(findArea('/admin/alertas').id, 'alertas');
    assert.equal(findArea('/outra-coisa'), null);
    assert.equal(matches({ href: '/admin', exact: true }, '/admin/logs'), false);
});

test('páginas que eram só redirecionamento não existem mais como arquivo', () => {
    for (const f of ['resources.html', 'suggestions.html']) assert.ok(!fs.existsSync(path.join(ADMIN_DIR, f)), f);
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.match(server, /'\/admin\/resources', \(req, res\) => res\.redirect\(301, '\/admin\/monitor'\)/);
    assert.match(server, /'\/admin\/suggestions', \(req, res\) => res\.redirect\(301, '\/admin\/origens'\)/);
});
