const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { camerasBloqueadas, podeVerCamera, pedidoDoPainel, MENSAGEM_BLOQUEIO } = require('../src/application/cameraAccess');
const { noticeModeFor, injectNotice, noticeMiddleware } = require('../src/application/cameraNotice');

const ROOT = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('bloqueio vem ligado por padrão e só desliga quando alguém desliga de propósito', () => {
    assert.equal(camerasBloqueadas(undefined), true);
    assert.equal(camerasBloqueadas({}), true);
    assert.equal(camerasBloqueadas({ camerasBloqueadas: true }), true);
    assert.equal(camerasBloqueadas({ camerasBloqueadas: 'false' }), true);   // texto não vale: só o booleano false
    assert.equal(camerasBloqueadas({ camerasBloqueadas: false }), false);
});

test('com o bloqueio ligado só o painel passa: nem as câmeras do rio saem para o público', () => {
    assert.equal(podeVerCamera({ config: {} }), false);
    assert.equal(podeVerCamera({ config: undefined }), false);
    assert.equal(podeVerCamera({ config: {}, admin: true }), true);
    assert.equal(podeVerCamera({ config: { camerasBloqueadas: false } }), true);
    assert.match(MENSAGEM_BLOQUEIO, /indispon/i);
    assert.ok(!/codigosDoRio|RIO_ALERT_CAMERAS/.test(ler('src', 'application', 'cameraAccess.js')), 'sem exceção para câmeras do rio');
});

test('o servidor recusa imagem, stream e quadros de timelapse antes de entregar qualquer coisa', () => {
    const server = ler('server.js');
    for (const nome of ['proxyCameraHandler', 'streamCameraHandler']) {
        const corpo = server.slice(server.indexOf(`const ${nome} = async`));
        const antes = corpo.slice(0, corpo.indexOf('cameraRepo.getCached()'));
        assert.match(antes, /cameraImageAllowed\(req\)/, `${nome} precisa checar o bloqueio logo no começo`);
    }
    const guarda = server.indexOf("app.use('/timelapse'");
    const estatico = server.indexOf('app.use(express.static(PUBLIC_FOLDER))');
    assert.ok(guarda > 0 && guarda < estatico, 'a trava do /timelapse tem de vir antes dos arquivos estáticos');
    assert.match(server, /res\.status\(451\)/);
});

function controlador(config) {
    const CameraController = require('../src/presentation/http/controllers/CameraController');
    const c = new CameraController({}, {}, {}, () => {});
    c.setSiteConfig(config);
    c.setTimelapseScheduler({ getFrames: () => ['/timelapse/001302/a.jpg'], getAvailableCamerasWithTimelapses: () => [{ code: '001302' }] });
    return c;
}
const resposta = () => {
    const r = { headers: {}, status(n) { r.codigo = n; return r; }, json(v) { r.corpo = v; return r; }, setHeader(k, v) { r.headers[k] = v; } };
    return r;
};

test('a configuração pública informa sempre o estado do bloqueio, e nem o painel consegue desligar', async () => {
    let r = resposta();
    controlador(undefined).getSiteConfig({}, r);
    assert.equal(r.corpo.camerasBloqueadas, true);
    r = resposta();
    controlador({ camerasBloqueadas: false }).getSiteConfig({}, r);
    assert.equal(r.corpo.camerasBloqueadas, false);

    const c = controlador({});
    r = resposta();
    await c.updateSiteConfig({ body: { camerasBloqueadas: false } }, r);   // nenhum parâmetro válido: recusa
    assert.equal(r.codigo, 400);
    assert.equal(camerasBloqueadas(c._siteConfig), true);
    await c.updateSiteConfig({ body: { showAppBanner: false, camerasBloqueadas: false } }, resposta());
    assert.equal(camerasBloqueadas(c._siteConfig), true, 'outros ajustes não carregam o bloqueio junto');
});

test('timelapses: lista e quadros somem enquanto o bloqueio estiver ligado e voltam quando for desligado', () => {
    let c = controlador({});
    let r = resposta();
    c.getTimelapse({ params: { code: '001302' }, query: {} }, r);
    assert.equal(r.codigo, 451);
    assert.deepEqual(r.corpo, []);
    r = resposta();
    c.getAvailableTimelapses({}, r);
    assert.deepEqual(r.corpo, []);

    c = controlador({ camerasBloqueadas: false });
    r = resposta();
    c.getTimelapse({ params: { code: '001302' }, query: {} }, r);
    assert.deepEqual(r.corpo, ['/timelapse/001302/a.jpg']);
    r = resposta();
    c.getAvailableTimelapses({}, r);
    assert.equal(r.corpo.length, 1);
});

test('o cartão está nas páginas que mostram câmeras e o /rio troca o player pelo aviso', () => {
    for (const f of ['index.html', 'camera.html', 'timelapses.html', 'mapa.html', 'embed.html']) {
        assert.match(ler('public', f), /src="\/script\/camera-block\.js/, `${f} precisa do cartão`);
    }
    const rio = ler('public', 'rio.html');
    assert.ok(!rio.includes('camera-block.js'), '/rio não leva o cartão que cobre a tela');
    assert.match(rio, /id="aviso-cameras-rio"[^>]*data-cb-show|data-cb-show[^>]*id="aviso-cameras-rio"/);
    assert.match(rio, /<div data-cb-hide>\s*<!-- Seletor de Câmeras/);          // o player some quando o aviso entra
    assert.match(rio, /data-cb-hide id="hero-camera-secondary-thumb"/);          // e a miniatura da outra câmera também
    assert.match(rio, /nem as câmeras do rio/);
    assert.match(rio, /não tem nenhum envolvimento com a Prefeitura de Rio Branco/);
    assert.match(rio, /suportecamrb@gmail\.com/);
    assert.match(rio, /instagram\.com\/gabv_ctor/);
});

test('o cartão não tem como fechar, avisa o contato e, na dúvida, bloqueia', () => {
    const js = ler('public', 'script', 'camera-block.js');
    assert.match(js, /suportecamrb@gmail\.com/);
    assert.match(js, /instagram\.com\/gabv_ctor/);
    assert.match(js, /não tem nenhum envolvimento com a Prefeitura de Rio Branco/);
    assert.ok(!/class="cb-close"|aria-label="Fechar"|>Fechar</i.test(js), 'não pode haver botão de fechar');
    assert.match(js, /e\.key === 'Escape'/);                       // Esc é engolido
    assert.match(js, /catch\(function \(\) \{ return \{ camerasBloqueadas: true \}/); // sem config: bloqueia
    assert.match(js, /cfg\.camerasBloqueadas !== false/);          // só some quando o bloqueio é desligado de propósito
    assert.match(js, /MutationObserver/);                          // se removerem o cartão, ele volta
});

test('o painel não tem interruptor: o bloqueio só sai por ordem, mexendo na configuração do banco ou no código', () => {
    const admin = ler('src', 'views', 'admin', 'admin.html');
    assert.ok(!/cameras-block-toggle/.test(admin));
    const depois = ler('src', 'presentation', 'http', 'controllers', 'CameraController.js').split('async updateSiteConfig')[1] || '';
    assert.ok(!/camerasBloqueadas/.test(depois.slice(0, 1500)), 'o POST de configuração não aceita o bloqueio');
});

test('a isenção de administrador só vale para pedidos que partem do painel', () => {
    assert.equal(pedidoDoPainel({ query: { token: 'x' }, headers: {} }), true);
    assert.equal(pedidoDoPainel({ query: {}, headers: { referer: 'https://camerasriobranco.com.br/admin/analise-cameras' } }), true);
    assert.equal(pedidoDoPainel({ query: {}, headers: { referer: 'http://localhost:3001/dashboard' } }), true);
    assert.equal(pedidoDoPainel({ query: {}, headers: { referer: 'https://camerasriobranco.com.br/' } }), false);          // página pública
    assert.equal(pedidoDoPainel({ query: {}, headers: { referer: 'https://camerasriobranco.com.br/mapa' } }), false);
    assert.equal(pedidoDoPainel({ query: {}, headers: {} }), false);                                                       // endereço aberto direto
    const server = ler('server.js');
    assert.match(server, /if \(!pedidoDoPainel\(req\)\) return false;/);
    assert.match(server, /referrerPolicy: \{ policy: 'same-origin' \}/);
});

test('cada página pública leva o aviso: cartão onde há câmeras, faixa nas demais, nada no painel nem na API', () => {
    for (const p of ['/', '/mapa', '/timelapses', '/camera/001302', '/embed/001302']) assert.equal(noticeModeFor(p), 'modal', p);
    for (const p of ['/rio', '/guias', '/guias/cotas-do-rio-acre', '/sobre', '/termos', '/contato', '/novidades', '/patrocine', '/perfil', '/login', '/qualquer-coisa']) assert.equal(noticeModeFor(p), 'banner', p);
    for (const p of ['/admin', '/admin/logs', '/dashboard', '/api/site-config']) assert.equal(noticeModeFor(p), null, p);

    const html = '<!DOCTYPE html><html><head><title>x</title></head><body class="a"><main>conteúdo</main></body></html>';
    const modal = injectNotice(html, 'modal');
    assert.match(modal, /<body class="a"><style id="cb-ssr-style">/);
    assert.match(modal, /id="camera-block-card"/);
    assert.match(modal, /não tem nenhum envolvimento com a Prefeitura de Rio Branco/);
    assert.match(modal, /suportecamrb@gmail\.com/);
    assert.ok(!/Fechar|cb-close/i.test(modal), 'sem botão de fechar');
    const faixa = injectNotice(html, 'banner');
    assert.match(faixa, /id="cb-banner"/);
    assert.ok(!faixa.includes('id="camera-block-card"'));
    assert.equal(injectNotice(modal, 'modal'), modal, 'não duplica');
    assert.equal(injectNotice('só texto', 'modal'), 'só texto');
});

test('o servidor escreve o aviso no HTML de verdade (send, sendFile e arquivos), sem tocar no que não é página', async () => {
    const express = require('express');
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-'));
    fs.writeFileSync(path.join(dir, 'estatica.html'), '<html><body><p>arquivo</p></body></html>');
    fs.writeFileSync(path.join(dir, 'dados.json'), '{"ok":true}');
    let cfg = {};
    const app = express();
    app.use(noticeMiddleware(() => cfg));
    app.get('/', (req, res) => res.send('<html><body><p>inicio</p></body></html>'));
    app.get('/sobre', (req, res) => res.sendFile(path.join(dir, 'estatica.html')));
    app.get('/admin', (req, res) => res.send('<html><body><p>painel</p></body></html>'));
    app.get('/dados', (req, res) => res.sendFile(path.join(dir, 'dados.json')));
    app.get('/vazio', (req, res) => res.status(204).end());
    const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
        const r = await fetch(base + '/');
        let t = await r.text();
        assert.match(t, /id="camera-block-card"/);
        assert.equal(Number(r.headers.get('content-length')), Buffer.byteLength(t), 'o tamanho declarado acompanha o HTML novo');
        t = await (await fetch(base + '/sobre')).text();
        assert.match(t, /id="cb-banner"/);
        assert.match(t, /<p>arquivo<\/p>/);
        assert.ok(!(await (await fetch(base + '/admin')).text()).includes('cb-ssr-style'), 'painel fica de fora');
        assert.equal(await (await fetch(base + '/dados')).text(), '{"ok":true}');
        assert.equal((await fetch(base + '/vazio')).status, 204);
        // Navegador que guardou a página ANTES do aviso: o ETag do HTML original é o mesmo, mas não pode virar "304 não mudou".
        const velho = await fetch(base + '/', { headers: { 'If-None-Match': r.headers.get('etag') || 'W/"qualquer"', 'If-Modified-Since': new Date().toUTCString() } });
        assert.equal(velho.status, 200);
        assert.match(await velho.text(), /id="camera-block-card"/);
        assert.match(r.headers.get('cache-control'), /no-store/);
        cfg = { camerasBloqueadas: false };                                             // bloqueio desligado: página limpa
        assert.ok(!(await (await fetch(base + '/')).text()).includes('cb-ssr-style'));
    } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a página Sobre não mostra miniaturas quebradas quando as câmeras estão bloqueadas', () => {
    assert.match(ler('public', 'script', 'sobre-script.js'), /camerasBloqueadas !== false[\s\S]{0,300}suspensas/);
});

test('o perfil e o /rio trocam a imagem de câmera pelo aviso, e o servidor marca a página como bloqueada', () => {
    const perfil = ler('public', 'script', 'perfil-script.js');
    assert.match(perfil, /window\.CAMERAS_BLOQUEADAS === true/);
    assert.match(perfil, /Imagens das câmeras suspensas/);
    assert.match(perfil, /bloqueadas \? 'Suspensa'/);                       // nada de selo "Ao vivo" sobre o aviso
    const modal = injectNotice('<html><body></body></html>', 'banner');
    assert.match(modal, /window\.CAMERAS_BLOQUEADAS=true/);
    assert.match(modal, /\[data-cb-hide\]\{display:none!important\}/);
});

test('e-mails de alerta saem sem fotos de câmera e as fotos guardadas deixam de ser entregues; o gráfico segue', () => {
    const server = ler('server.js');
    assert.match(server, /capture: \(tag\) => \(camerasBloqueadas\(cameraCtrl\._siteConfig\) \? Promise\.resolve\(\{ images: \[\], skipped: \[\] \}\)/);
    const guarda = server.indexOf("app.use('/uploads/alertas'");
    assert.ok(guarda > 0 && guarda < server.indexOf('app.use(express.static(PUBLIC_FOLDER))'));
    assert.match(server, /rio-grafico-/);
});

test('imagem recusada pelo bloqueio (451) não vira alerta no painel de logs', () => {
    assert.match(ler('src', 'infrastructure', 'logging', 'SystemLogger.js'), /status === 451\) return \{ skip: true \}/);
});
