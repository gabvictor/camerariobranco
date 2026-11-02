/**
 * Menu único do painel de administração: 6 áreas, cada uma com suas sub-abas.
 * Todas as páginas do painel têm só `<div id="admin-nav"></div>` e carregam este arquivo.
 *
 * Para criar uma página nova: acrescente-a em `sub` de uma área (ou crie a área) e coloque o div na página.
 */
const AREAS = [
    { id: 'geral', label: 'Visão geral', icon: 'bar-chart-2', sub: [{ label: 'Dashboard', href: '/dashboard', icon: 'bar-chart-2' }] },
    {
        id: 'audiencia', label: 'Audiência', icon: 'users', sub: [
            { label: 'Visitantes', href: '/admin/visitantes', icon: 'users' },
            { label: 'Origens de tráfego', href: '/admin/origens', icon: 'compass' }
        ]
    },
    {
        id: 'sistema', label: 'Sistema', icon: 'activity', sub: [
            { label: 'Monitoramento (NOC)', href: '/admin/monitor', icon: 'activity' },
            { label: 'Logs do servidor', href: '/admin/logs', icon: 'terminal' }
        ]
    },
    {
        id: 'cameras', label: 'Câmeras', icon: 'video', sub: [
            { label: 'Câmeras e configurações', href: '/admin', icon: 'video', exact: true },
            { label: 'Análise e patrocínios', href: '/admin/analise-cameras', icon: 'eye' }
        ]
    },
    {
        id: 'comunidade', label: 'Comunidade', icon: 'message-square', sub: [
            { label: 'Reportes', href: '/admin/reports', icon: 'alert-triangle' },
            { label: 'Comentários', href: '/admin/comments', icon: 'message-square' }
        ]
    },
    { id: 'alertas', label: 'Alertas do Rio', icon: 'bell-ring', sub: [{ label: 'Alertas do Rio', href: '/admin/alertas', icon: 'bell-ring' }] }
];

const TAB_BASE = 'px-4 py-2.5 rounded-xl flex items-center gap-2 whitespace-nowrap transition-colors';
const TAB_OFF = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';
const TAB_ON = 'font-bold bg-indigo-600 text-white shadow-md shadow-indigo-600/20';
const PILL_BASE = 'px-3 py-1.5 rounded-lg flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold transition-colors border';
const PILL_OFF = 'border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';
const PILL_ON = 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300';

/** A página aberta pertence a `item`? `/admin` só vale na raiz; as demais valem também com `/id` depois (comentários). */
export function matches(item, pathname) {
    const p = String(pathname || '').replace(/\/+$/, '') || '/';
    return item.exact ? p === item.href : p === item.href || p.startsWith(item.href + '/');
}

export function findArea(pathname) {
    return AREAS.find((a) => a.sub.some((s) => matches(s, pathname))) || null;
}

function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
}

export function renderAdminNav(mount, pathname = location.pathname) {
    const area = findArea(pathname);
    const wrap = el('div', 'mb-8 border-b border-gray-200 dark:border-gray-800 pb-2');

    const main = el('nav', 'flex items-center gap-2 overflow-x-auto pb-1 text-xs sm:text-sm font-semibold');
    main.setAttribute('aria-label', 'Áreas do painel');
    for (const a of AREAS) {
        const link = el('a', `${TAB_BASE} ${area && area.id === a.id ? TAB_ON : TAB_OFF}`, `<i data-lucide="${a.icon}" class="w-4 h-4"></i> ${a.label}`);
        link.href = a.sub[0].href;
        if (area && area.id === a.id) link.setAttribute('aria-current', 'page');
        main.append(link);
    }
    wrap.append(main);

    if (area && area.sub.length > 1) {
        const sub = el('nav', 'flex items-center gap-1.5 overflow-x-auto pt-2');
        sub.setAttribute('aria-label', `Páginas de ${area.label}`);
        for (const s of area.sub) {
            const on = matches(s, pathname);
            const link = el('a', `${PILL_BASE} ${on ? PILL_ON : PILL_OFF}`, `<i data-lucide="${s.icon}" class="w-3.5 h-3.5"></i> ${s.label}`);
            link.href = s.href;
            if (on) link.setAttribute('aria-current', 'page');
            sub.append(link);
        }
        wrap.append(sub);
    }

    mount.replaceChildren(wrap);
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

function init() {
    const mount = document.getElementById('admin-nav');
    if (mount) renderAdminNav(mount);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
}

export { AREAS };
