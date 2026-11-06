/**
 * Cartão que cobre as páginas com imagens de câmeras enquanto o bloqueio estiver ligado.
 *
 * - Não tem botão de fechar, não fecha com Esc e prende o foco: a tela fica coberta.
 * - Liga e desliga pela configuração do site (`camerasBloqueadas`, painel de administração). Se não for possível
 *   ler a configuração, o cartão aparece (na dúvida, bloqueia).
 * - É só a parte visível: as imagens também são recusadas pelo servidor (erro 451), então remover o cartão pelo
 *   navegador não mostra nada.
 */
(function () {
    'use strict';

    var EMAIL = 'suportecamrb@gmail.com';
    var INSTAGRAM = 'https://www.instagram.com/gabv_ctor/';
    var ID = 'camera-block-card';

    var CSS = [
        '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;',
        'background:rgba(15,23,42,.88);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);overflow:auto;',
        'font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}',
        '#' + ID + ' .cb-card{width:100%;max-width:560px;background:#fff;color:#1f2937;border-radius:20px;padding:28px 26px;',
        'box-shadow:0 25px 60px rgba(0,0,0,.45);border-top:6px solid #dc2626}',
        '#' + ID + ' .cb-icon{width:52px;height:52px;border-radius:14px;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;margin-bottom:14px}',
        '#' + ID + ' h2{margin:0 0 10px;font-size:22px;line-height:1.25;font-weight:800;color:#111827}',
        '#' + ID + ' p{margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151}',
        '#' + ID + ' .cb-contact{margin-top:16px;padding:14px 16px;background:#f3f4f6;border-radius:12px;font-size:14px;line-height:1.55;color:#374151}',
        '#' + ID + ' .cb-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}',
        '#' + ID + ' .cb-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;',
        'background:#4f46e5;color:#fff}',
        '#' + ID + ' .cb-btn.alt{background:#fff;color:#4f46e5;border:1px solid #c7d2fe}',
        '#' + ID + ' .cb-foot{margin-top:14px;font-size:13px;color:#6b7280}',
        '#' + ID + ' .cb-foot a{color:#4f46e5;font-weight:600}',
        '@media (prefers-color-scheme:dark){#' + ID + ' .cb-card{background:#111827;color:#e5e7eb}#' + ID + ' h2{color:#f9fafb}#' + ID + ' p{color:#d1d5db}',
        '#' + ID + ' .cb-contact{background:#1f2937;color:#d1d5db}#' + ID + ' .cb-btn.alt{background:#111827;color:#a5b4fc;border-color:#3730a3}',
        '#' + ID + ' .cb-icon{background:#450a0a;color:#f87171}#' + ID + ' .cb-foot{color:#9ca3af}#' + ID + ' .cb-foot a{color:#a5b4fc}}'
    ].join('');

    var HTML = [
        '<div class="cb-card" role="document">',
        '<div class="cb-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg></div>',
        '<h2 id="cb-title">Imagens das câmeras suspensas</h2>',
        '<p id="cb-desc">O acesso às imagens das câmeras está bloqueado neste site porque o assunto está sendo apurado em uma investigação. ',
        'Enquanto ela durar, nenhuma imagem de câmera será exibida aqui.</p>',
        '<p>O CamRB é um projeto independente e <strong>não tem nenhum envolvimento com a Prefeitura de Rio Branco</strong>. ',
        'Estamos abertos a prestar qualquer esclarecimento.</p>',
        '<div class="cb-contact"><strong>Dúvidas ou esclarecimentos?</strong> Escreva para ',
        '<a href="mailto:' + EMAIL + '" style="color:inherit;font-weight:700">' + EMAIL + '</a> ou envie uma mensagem direta no Instagram.',
        '<div class="cb-actions">',
        '<a class="cb-btn" href="mailto:' + EMAIL + '">Enviar e-mail</a>',
        '<a class="cb-btn alt" href="' + INSTAGRAM + '" target="_blank" rel="noopener noreferrer">Mensagem no Instagram</a>',
        '</div></div>',
        '<p class="cb-foot">O nível do Rio Acre continua disponível em <a href="/rio">Nível do Rio</a>.</p>',
        '</div>'
    ].join('');

    var active = false;

    function inertOthers(card) {
        Array.prototype.forEach.call(document.body.children, function (el) {
            if (el === card || el.tagName === 'SCRIPT') return;
            try { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); } catch (e) { /* ignora */ }
        });
    }

    function show() {
        if (document.getElementById(ID)) return;
        if (!document.getElementById(ID + '-style')) {
            var st = document.createElement('style');
            st.id = ID + '-style';
            st.textContent = CSS;
            document.head.appendChild(st);
        }
        var card = document.createElement('div');
        card.id = ID;
        card.setAttribute('role', 'alertdialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'cb-title');
        card.setAttribute('aria-describedby', 'cb-desc');
        card.innerHTML = HTML;
        document.body.appendChild(card);
        document.documentElement.style.overflow = 'hidden';
        inertOthers(card);
    }

    // Esc, clique fora e voltar do teclado não fecham: o cartão só sai quando o bloqueio é desligado no painel.
    document.addEventListener('keydown', function (e) {
        if (active && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    }, true);

    function guard() {
        active = true;
        show();
        // Se alguém remover o cartão pelo inspetor do navegador, ele volta.
        new MutationObserver(function () { if (active && !document.getElementById(ID)) show(); })
            .observe(document.body, { childList: true });
    }

    function start() {
        fetch('/api/site-config', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : { camerasBloqueadas: true }; })
            .catch(function () { return { camerasBloqueadas: true }; })
            .then(function (cfg) { if (!cfg || cfg.camerasBloqueadas !== false) guard(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
