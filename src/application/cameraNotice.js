/**
 * Aviso de contingência sobre as imagens das câmeras, escrito direto no HTML de cada página pública.
 *
 * Plano de contingência: enquanto o bloqueio estiver ligado, TODA página pública leva o aviso, e ele não depende de
 * JavaScript, de cache do navegador nem de nenhum arquivo extra: o servidor o escreve dentro da própria página.
 *  - páginas que mostram câmeras (início, mapa, timelapses, câmera, embed): cartão que cobre a tela, sem fechar;
 *  - as demais páginas públicas: faixa no topo, sem botão de fechar.
 * Páginas do painel (/admin, /dashboard) e a API ficam de fora.
 */
const { camerasBloqueadas } = require('./cameraAccess');

const EMAIL = 'suportecamrb@gmail.com';
const INSTAGRAM = 'https://www.instagram.com/gabv_ctor/';

const TEXTO = {
    titulo: 'Imagens das câmeras suspensas',
    bloqueio: 'O acesso às imagens das câmeras está bloqueado neste site porque o assunto está sendo apurado em uma investigação. Enquanto ela durar, nenhuma imagem de câmera será exibida aqui.',
    independencia: 'não tem nenhum envolvimento com a Prefeitura de Rio Branco'
};

const CSS = `<style id="cb-ssr-style">
#camera-block-card,#camera-block-card *,#cb-banner,#cb-banner *{box-sizing:border-box}
#camera-block-card{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.88);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);overflow:auto;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
#camera-block-card .cb-card{width:100%;max-width:560px;background:#fff;color:#1f2937;border-radius:20px;padding:28px 26px;box-shadow:0 25px 60px rgba(0,0,0,.45);border-top:6px solid #dc2626}
#camera-block-card .cb-icon{width:52px;height:52px;border-radius:14px;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;margin-bottom:14px}
#camera-block-card h2{margin:0 0 10px;font-size:22px;line-height:1.25;font-weight:800;color:#111827}
#camera-block-card p{margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151}
#camera-block-card .cb-contact{margin-top:16px;padding:14px 16px;background:#f3f4f6;border-radius:12px;font-size:14px;line-height:1.55;color:#374151}
#camera-block-card .cb-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
#camera-block-card .cb-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;background:#4f46e5;color:#fff}
#camera-block-card .cb-btn.alt{background:#fff;color:#4f46e5;border:1px solid #c7d2fe}
#camera-block-card .cb-foot{margin-top:14px;font-size:13px;color:#6b7280}
#camera-block-card .cb-foot a{color:#4f46e5;font-weight:600}
#cb-banner{display:block;width:100%;background:#7f1d1d;color:#fff;padding:10px 16px;font:600 13px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:center}
#cb-banner a{color:#fecaca;font-weight:700;text-decoration:underline}
#cb-banner strong{font-weight:800}
@media (prefers-color-scheme:dark){#camera-block-card .cb-card{background:#111827;color:#e5e7eb}#camera-block-card h2{color:#f9fafb}#camera-block-card p{color:#d1d5db}#camera-block-card .cb-contact{background:#1f2937;color:#d1d5db}#camera-block-card .cb-btn.alt{background:#111827;color:#a5b4fc;border-color:#3730a3}#camera-block-card .cb-icon{background:#450a0a;color:#f87171}#camera-block-card .cb-foot{color:#9ca3af}#camera-block-card .cb-foot a{color:#a5b4fc}}
</style>`;

const MODAL = `<div id="camera-block-card" data-ssr="1" role="alertdialog" aria-modal="true" aria-labelledby="cb-title" aria-describedby="cb-desc"><div class="cb-card" role="document">
<div class="cb-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg></div>
<h2 id="cb-title">${TEXTO.titulo}</h2>
<p id="cb-desc">${TEXTO.bloqueio}</p>
<p>O CamRB é um projeto independente e <strong>${TEXTO.independencia}</strong>. Estamos abertos a prestar qualquer esclarecimento.</p>
<div class="cb-contact"><strong>Dúvidas ou esclarecimentos?</strong> Escreva para <a href="mailto:${EMAIL}" style="color:inherit;font-weight:700">${EMAIL}</a> ou envie uma mensagem direta no Instagram.
<div class="cb-actions"><a class="cb-btn" href="mailto:${EMAIL}">Enviar e-mail</a><a class="cb-btn alt" href="${INSTAGRAM}" target="_blank" rel="noopener noreferrer">Mensagem no Instagram</a></div></div>
<p class="cb-foot">O nível do Rio Acre continua disponível em <a href="/rio">Nível do Rio</a>.</p>
</div></div>`;

const BANNER = `<div id="cb-banner" role="note"><strong>Aviso:</strong> o acesso às imagens das câmeras está bloqueado neste site porque o assunto está sendo apurado em uma investigação. O CamRB é independente e ${TEXTO.independencia}. Dúvidas ou esclarecimentos: <a href="mailto:${EMAIL}">${EMAIL}</a> ou mensagem no <a href="${INSTAGRAM}" target="_blank" rel="noopener noreferrer">Instagram</a>.</div>`;

/** 'modal' (páginas com câmeras), 'banner' (demais páginas públicas) ou null (painel e API). */
function noticeModeFor(pathname) {
    const p = String(pathname || '/');
    if (/^\/(api|admin|dashboard)(\/|$)/.test(p)) return null;
    if (p === '/' || p === '/mapa' || p === '/timelapses' || p.startsWith('/camera/') || p === '/camera' || p.startsWith('/embed/')) return 'modal';
    return 'banner';
}

/** Escreve o aviso logo depois de abrir o <body>. Sem <body> (não é uma página), devolve como veio. */
function injectNotice(html, mode) {
    if (!mode || html.includes('id="cb-ssr-style"')) return html;
    const abre = /<body\b[^>]*>/i.exec(html);
    if (!abre) return html;
    const fim = abre.index + abre[0].length;
    return html.slice(0, fim) + CSS + (mode === 'modal' ? MODAL : BANNER) + html.slice(fim);
}

/**
 * Middleware: reescreve as respostas HTML das páginas públicas. Trabalha na saída (write/end), então vale para
 * res.send, res.sendFile e arquivos estáticos. Só mexe em respostas 200 de HTML; o resto passa direto.
 * @param {() => object} getConfig  devolve a configuração do site (para saber se o bloqueio está ligado)
 */
function noticeMiddleware(getConfig) {
    return (req, res, next) => {
        const mode = req.method === 'GET' ? noticeModeFor(req.path) : null;
        if (!mode) return next();

        const write = res.write.bind(res);
        const end = res.end.bind(res);
        const chunks = [];
        let decidido = false;
        let reescrever = false;

        const decidir = () => {
            if (decidido) return;
            decidido = true;
            reescrever = res.statusCode === 200 && /text\/html/i.test(String(res.getHeader('Content-Type') || '')) && camerasBloqueadas(getConfig());
            if (reescrever) res.removeHeader('Content-Length');
        };
        const bytes = (chunk, enc) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof enc === 'string' ? enc : 'utf8'));

        res.write = (chunk, enc, cb) => {
            decidir();
            if (!reescrever) return write(chunk, enc, cb);
            if (chunk != null) chunks.push(bytes(chunk, enc));
            const done = typeof enc === 'function' ? enc : cb;
            if (typeof done === 'function') done();
            return true;
        };
        res.end = (chunk, enc, cb) => {
            decidir();
            if (!reescrever) return end(chunk, enc, cb);
            if (chunk != null && typeof chunk !== 'function') chunks.push(bytes(chunk, enc));
            const corpo = injectNotice(Buffer.concat(chunks).toString('utf8'), mode);
            res.setHeader('Content-Length', Buffer.byteLength(corpo));
            return end(corpo, typeof enc === 'function' ? undefined : enc, typeof enc === 'function' ? enc : cb);
        };
        next();
    };
}

module.exports = { noticeModeFor, injectNotice, noticeMiddleware, TEXTO, EMAIL, INSTAGRAM };
