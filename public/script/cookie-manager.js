(function() {
    function getCookies() {
        const raw = document.cookie || '';
        const cookies = {};
        raw.split(';').forEach(c => {
            const parts = c.split('=');
            if (parts.length >= 2) {
                cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
            }
        });
        return cookies;
    }

    function setCookie(name, value, maxAgeSeconds) {
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
    }

    function deleteCookie(name) {
        document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
    }

    function clearAllCookies() {
        const cookies = getCookies();
        Object.keys(cookies).forEach(name => {
            deleteCookie(name);
        });
        localStorage.removeItem('theme');
        sessionStorage.removeItem('domain-banner-dismissed');
    }

    function renderInspectorList() {
        const listContainer = document.getElementById('cookie-inspector-list');
        if (!listContainer) return;

        const cookies = getCookies();
        const themeVal = cookies.theme || localStorage.getItem('theme') || 'Automático';
        const consentVal = cookies.camrb_consent;
        const visitedVal = cookies.camrb_visited_today;
        const hasSession = Boolean(cookies.__session);

        let consentLabel = '<span class="text-amber-500 font-semibold">Pendente</span>';
        if (consentVal === 'all') {
            consentLabel = '<span class="text-emerald-500 font-semibold">Todos (Personalização AdSense Ativa)</span>';
        } else if (consentVal === 'essential') {
            consentLabel = '<span class="text-blue-500 font-semibold">Apenas Essenciais</span>';
        }

        listContainer.innerHTML = `
            <!-- Cookie: theme -->
            <div class="p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700/80">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">theme</span>
                    <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">Essencial</span>
                </div>
                <div class="text-xs font-medium text-gray-800 dark:text-gray-200 mb-1">
                    Valor atual: <strong>${themeVal}</strong>
                </div>
                <p class="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Salva sua preferência de modo escuro ou claro para o servidor renderizar o site sem piscar a tela.
                </p>
            </div>

            <!-- Cookie: camrb_consent -->
            <div class="p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700/80">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">camrb_consent</span>
                    <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Privacidade / LGPD</span>
                </div>
                <div class="text-xs font-medium text-gray-800 dark:text-gray-200 mb-1">
                    Status: ${consentLabel}
                </div>
                <p class="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Armazena se você autorizou anúncios personalizados do Google AdSense e cookies de navegação.
                </p>
            </div>

            <!-- Cookie: camrb_visited_today -->
            <div class="p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700/80">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">camrb_visited_today</span>
                    <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300">Desempenho</span>
                </div>
                <div class="text-xs font-medium text-gray-800 dark:text-gray-200 mb-1">
                    Valor: <strong>${visitedVal ? '1 (Ativo hoje)' : 'Não registrado nesta sessão'}</strong>
                </div>
                <p class="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Deduplica contagens de visita no mesmo dia, economizando recursos de servidor e banco de dados.
                </p>
            </div>

            <!-- Cookie: __session (Admin) -->
            <div class="p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700/80">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">__session</span>
                    <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">Segurança Admin</span>
                </div>
                <div class="text-xs font-medium text-gray-800 dark:text-gray-200 mb-1">
                    Status: <strong>${hasSession ? 'Sessão Admin Ativa (HttpOnly)' : 'Inexistente / Deslogado'}</strong>
                </div>
                <p class="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Sessão segura criptografada pelo Firebase Admin para proteger o acesso às páginas do painel administrativo.
                </p>
            </div>
        `;
    }

    function createModal() {
        if (document.getElementById('cookie-preferences-modal')) return;

        const modalHtml = `
        <div id="cookie-preferences-modal" class="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300 opacity-0 pointer-events-none">
            <div class="relative bg-white dark:bg-gray-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 sm:p-7 overflow-hidden border border-gray-100 dark:border-gray-700 max-h-[90vh] flex flex-col">
                <!-- Header -->
                <div class="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-700">
                    <div class="flex items-center gap-2.5">
                        <span class="text-2xl">🍪</span>
                        <div>
                            <h3 class="text-lg font-bold text-gray-900 dark:text-white">Gerenciamento de Cookies</h3>
                            <p class="text-xs text-gray-500 dark:text-gray-400">Transparência sobre o que é salvo no seu navegador.</p>
                        </div>
                    </div>
                    <button id="close-cookie-modal-btn" class="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <!-- Cookie list -->
                <div id="cookie-inspector-list" class="my-4 space-y-3 overflow-y-auto pr-1"></div>

                <!-- Actions -->
                <div class="pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-2.5 justify-between items-center">
                    <button id="btn-clear-all-cookies" class="w-full sm:w-auto text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-2 rounded-xl transition-colors cursor-pointer">
                        Limpar Cookies
                    </button>
                    <div class="flex gap-2 w-full sm:w-auto">
                        <button id="btn-modal-essential-only" class="w-full sm:w-auto text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 px-3 py-2 rounded-xl transition-colors cursor-pointer">
                            Apenas Essenciais
                        </button>
                        <button id="btn-modal-accept-all" class="w-full sm:w-auto text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-colors cursor-pointer shadow-sm">
                            Aceitar Todos
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('cookie-preferences-modal');
        document.getElementById('close-cookie-modal-btn')?.addEventListener('click', window.closeCookiePreferences);
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) window.closeCookiePreferences();
        });

        document.getElementById('btn-clear-all-cookies')?.addEventListener('click', () => {
            clearAllCookies();
            window.closeCookiePreferences();
            location.reload();
        });

        document.getElementById('btn-modal-essential-only')?.addEventListener('click', () => {
            setCookie('camrb_consent', 'essential', 31536000);
            window.closeCookiePreferences();
            location.reload();
        });

        document.getElementById('btn-modal-accept-all')?.addEventListener('click', () => {
            setCookie('camrb_consent', 'all', 31536000);
            window.closeCookiePreferences();
            location.reload();
        });
    }

    window.openCookiePreferences = function() {
        createModal();
        renderInspectorList();
        const modal = document.getElementById('cookie-preferences-modal');
        if (modal) {
            modal.classList.remove('opacity-0', 'pointer-events-none');
            modal.classList.add('opacity-100', 'pointer-events-auto');
        }
    };

    window.closeCookiePreferences = function() {
        const modal = document.getElementById('cookie-preferences-modal');
        if (modal) {
            modal.classList.add('opacity-0', 'pointer-events-none');
            modal.classList.remove('opacity-100', 'pointer-events-auto');
        }
    };

    // Auto-bind click listeners on buttons with data-action="open-cookie-preferences"
    document.addEventListener('click', function(e) {
        const target = e.target.closest('[data-action="open-cookie-preferences"], #open-cookie-preferences-footer, #open-cookie-preferences-profile');
        if (target) {
            e.preventDefault();
            window.openCookiePreferences();
        }
    });
})();
