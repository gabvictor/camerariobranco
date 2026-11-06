const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { camerasBloqueadas, podeVerCamera, codigosDoRio, MENSAGEM_BLOQUEIO } = require('../src/application/cameraAccess');

const ROOT = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('bloqueio vem ligado por padrão e só desliga quando alguém desliga de propósito', () => {
    assert.equal(camerasBloqueadas(undefined), true);
    assert.equal(camerasBloqueadas({}), true);
    assert.equal(camerasBloqueadas({ camerasBloqueadas: true }), true);
    assert.equal(camerasBloqueadas({ camerasBloqueadas: 'false' }), true);   // texto não vale: só o booleano false
    assert.equal(camerasBloqueadas({ camerasBloqueadas: false }), false);
});

test('com o bloqueio ligado: câmeras do rio e administradores passam, o resto não', () => {
    const rio = codigosDoRio({ RIO_ALERT_CAMERAS: '001334, 001426' });
    assert.deepEqual([...rio], ['001334', '001426']);
    const cfg = {};
    assert.equal(podeVerCamera({ config: cfg, codigo: '001334', rio }), true);
    assert.equal(podeVerCamera({ config: cfg, codigo: '001426', rio }), true);
    assert.equal(podeVerCamera({ config: cfg, codigo: '001302', rio }), false);
    assert.equal(podeVerCamera({ config: cfg, codigo: '001302', rio, admin: true }), true);
    assert.equal(podeVerCamera({ config: cfg, codigo: null, rio }), false);   // sem câmera (lista de timelapses): bloqueado
    assert.equal(podeVerCamera({ config: { camerasBloqueadas: false }, codigo: '001302', rio }), true);
    assert.match(MENSAGEM_BLOQUEIO, /indispon/i);
});

test('o servidor recusa imagem, stream e quadros de timelapse antes de entregar qualquer coisa', () => {
    const server = ler('server.js');
    for (const nome of ['proxyCameraHandler', 'streamCameraHandler']) {
        const corpo = server.slice(server.indexOf(`const ${nome} = async`));
        const antes = corpo.slice(0, corpo.indexOf('cameraRepo.getCached()'));
        assert.match(antes, /cameraImageAllowed\(req, code\)/, `${nome} precisa checar o bloqueio logo no começo`);
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

test('a configuração pública informa sempre o estado do bloqueio, e o painel consegue ligar e desligar', async () => {
    let r = resposta();
    controlador(undefined).getSiteConfig({}, r);
    assert.equal(r.corpo.camerasBloqueadas, true);
    r = resposta();
    controlador({ camerasBloqueadas: false }).getSiteConfig({}, r);
    assert.equal(r.corpo.camerasBloqueadas, false);

    const c = controlador({});
    r = resposta();
    await c.updateSiteConfig({ body: { camerasBloqueadas: false } }, r);
    assert.equal(c._siteConfig.camerasBloqueadas, false);
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

test('o cartão está nas páginas que mostram câmeras e o /rio só leva um aviso', () => {
    for (const f of ['index.html', 'camera.html', 'timelapses.html', 'mapa.html', 'embed.html']) {
        assert.match(ler('public', f), /src="\/script\/camera-block\.js/, `${f} precisa do cartão`);
    }
    const rio = ler('public', 'rio.html');
    assert.ok(!rio.includes('camera-block.js'), '/rio não leva o cartão que cobre a tela');
    assert.match(rio, /id="aviso-cameras-rio"/);
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

test('o painel tem o interruptor do bloqueio e pede confirmação antes de liberar', () => {
    const admin = ler('src', 'views', 'admin', 'admin.html');
    assert.match(admin, /id="cameras-block-toggle"/);
    assert.match(admin, /camerasBloqueadas: novo/);
    assert.match(admin, /LIBERAR as imagens das câmeras/);
});
