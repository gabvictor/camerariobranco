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

    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : null;
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

    function getTheme() {
        const cookieTheme = getCookie('theme');
        if (cookieTheme) return cookieTheme;
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) return savedTheme;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }

    const theme = getTheme();
    applyTheme(theme);
    setCookie('theme', theme, 31536000);

    // Expose toggle function globally with debounce protection against double-clicks
    let lastToggleTimestamp = 0;
    window.toggleTheme = function() {
        const now = Date.now();
        if (now - lastToggleTimestamp < 250) {
            return getTheme();
        }
        lastToggleTimestamp = now;

        const currentTheme = getTheme();
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        localStorage.setItem('theme', newTheme);
        setCookie('theme', newTheme, 31536000);
        applyTheme(newTheme);
        
        if (window.lucide) {
            try { window.lucide.createIcons(); } catch (_) {}
        }
        
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: newTheme } }));
        return newTheme;
    };

    // ─── Global Standardized Toast Notification System ─────────────────────────
    window.showToast = function(message, type = 'success', duration = 3200) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'fixed bottom-20 sm:bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        
        let bgClass = 'bg-indigo-600/95 text-white border-indigo-400/30 shadow-indigo-950/25';
        let defaultIcon = 'check-circle-2';

        if (type === 'error') {
            bgClass = 'bg-red-600/95 text-white border-red-400/30 shadow-red-950/25';
            defaultIcon = 'alert-circle';
        } else if (type === 'info') {
            bgClass = 'bg-gray-900/95 text-white dark:bg-gray-800/95 dark:text-white border-white/10 dark:border-gray-700 shadow-black/25';
            defaultIcon = 'info';
        } else if (type === 'warning') {
            bgClass = 'bg-amber-600/95 text-white border-amber-400/30 shadow-amber-950/25';
            defaultIcon = 'alert-triangle';
        }

        const hasStar = typeof message === 'string' && message.includes('⭐');
        const icon = hasStar ? 'star' : defaultIcon;
        const cleanMessage = hasStar ? message.replace(/⭐/g, '').trim() : message;

        toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl transform transition-all duration-300 translate-y-8 opacity-0 min-w-[280px] sm:min-w-[320px] max-w-sm backdrop-blur-md border ${bgClass}`;
        toast.innerHTML = `
            <i data-lucide="${icon}" class="w-5 h-5 flex-shrink-0 ${hasStar ? 'text-amber-300 fill-amber-300' : ''}"></i>
            <p class="text-xs sm:text-sm font-semibold leading-snug">${cleanMessage}</p>
        `;

        container.appendChild(toast);
        if (window.lucide) {
            try { window.lucide.createIcons(); } catch (_) {}
        }

        requestAnimationFrame(() => {
            toast.classList.remove('translate-y-8', 'opacity-0');
        });

        setTimeout(() => {
            toast.classList.add('translate-y-4', 'opacity-0');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    };

    // ─── Cookie Inspector & Preferences Modal ─────────────────────────────────
    function renderInspectorList() {
        const listContainer = document.getElementById('cookie-inspector-list');
        if (!listContainer) return;

        const cookies = getCookies();
        const rawTheme = cookies.theme || localStorage.getItem('theme');
        const isDark = rawTheme === 'dark' || (!rawTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const themeLabel = isDark ? 'Modo Escuro 🌙' : 'Modo Claro ☀️';
        const consentVal = cookies.camrb_consent;
        const visitedVal = cookies.camrb_visited_today;
        const hasSession = Boolean(cookies.__session);

        let consentBadge = '<span class="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Aguardando Escolha</span>';
        let consentDetail = 'Ainda não definido. Você pode escolher abaixo.';
        if (consentVal === 'all') {
            consentBadge = '<span class="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Experiência Completa</span>';
            consentDetail = 'Autorizado para anúncios personalizados mais úteis e preferências completas.';
        } else if (consentVal === 'essential') {
            consentBadge = '<span class="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Apenas o Básico</span>';
            consentDetail = 'Apenas os recursos essenciais de funcionamento estão ativos.';
        }

        let adminCardHtml = '';
        if (hasSession) {
            adminCardHtml = `
            <div class="p-4 rounded-2xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/50">
                <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                        <span class="text-base">🔐</span>
                        <span class="text-xs font-bold text-gray-900 dark:text-white">Sessão Segura de Administrador</span>
                    </div>
                    <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">Segurança</span>
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-300 mb-1">
                    Status: <strong class="text-purple-600 dark:text-purple-400">Conta Administrativa Conectada</strong>
                </div>
                <p class="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Chave segura criptografada que mantém seu painel administrativo conectado sem expor suas credenciais.
                </p>
            </div>
            `;
        }

        listContainer.innerHTML = `
            <!-- Card 1: Aparência -->
            <div class="p-4 rounded-2xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700/80">
                <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                        <span class="text-base">🎨</span>
                        <span class="text-xs font-bold text-gray-900 dark:text-white">Aparência e Conforto Visual</span>
                    </div>
                    <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">Essencial</span>
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-300 mb-1">
                    Sua preferência: <strong class="text-indigo-600 dark:text-indigo-400 font-bold">${themeLabel}</strong>
                </div>
                <p class="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Lembra se você prefere o site no modo escuro ou claro, para que a tela não pisque ao abrir novas páginas e não canse sua visão à noite.
                </p>
            </div>

            <!-- Card 2: Privacidade e Anúncios -->
            <div class="p-4 rounded-2xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700/80">
                <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                        <span class="text-base">🛡️</span>
                        <span class="text-xs font-bold text-gray-900 dark:text-white">Privacidade e Anúncios</span>
                    </div>
                    ${consentBadge}
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-300 mb-1">
                    ${consentDetail}
                </div>
                <p class="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Nos ajuda a manter o serviço gratuito e no ar exibindo anúncios mais adequados para você, respeitando suas escolhas e a Lei Geral de Proteção de Dados (LGPD).
                </p>
            </div>

            <!-- Card 3: Desempenho e Velocidade -->
            <div class="p-4 rounded-2xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700/80">
                <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                        <span class="text-base">⚡</span>
                        <span class="text-xs font-bold text-gray-900 dark:text-white">Velocidade de Carregamento</span>
                    </div>
                    <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Desempenho</span>
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-300 mb-1">
                    Status: <strong>${visitedVal ? 'Otimizado para hoje' : 'Ativo'}</strong>
                </div>
                <p class="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Evita que o seu celular gaste internet recarregando repetidamente as mesmas informações estáticas durante o seu dia.
                </p>
            </div>

            ${adminCardHtml}
        `;
    }

    function createPreferencesModal() {
        if (document.getElementById('cookie-preferences-modal')) return;

        const modalHtml = `
        <div id="cookie-preferences-modal" class="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300 opacity-0 pointer-events-none">
            <div class="relative bg-white dark:bg-gray-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 sm:p-7 overflow-hidden border border-gray-100 dark:border-gray-700 max-h-[90vh] flex flex-col">
                <!-- Header -->
                <div class="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-700">
                    <div class="flex items-center gap-2.5">
                        <span class="text-2xl">🍪</span>
                        <div>
                            <h3 class="text-lg font-bold text-gray-900 dark:text-white">Transparência de Dados e Cookies</h3>
                            <p class="text-xs text-gray-500 dark:text-gray-400">Entenda exatamente o que é salvo no seu navegador.</p>
                        </div>
                    </div>
                    <button id="close-cookie-modal-btn" class="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer" aria-label="Fechar">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <!-- Cookie list -->
                <div id="cookie-inspector-list" class="my-4 space-y-3 overflow-y-auto pr-1 max-h-[52vh]"></div>

                <!-- Actions -->
                <div class="pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-2.5 justify-between items-center">
                    <button id="btn-clear-all-cookies" class="w-full sm:w-auto text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 px-3.5 py-2.5 rounded-xl transition-colors cursor-pointer">
                        Limpar Meus Dados
                    </button>
                    <div class="flex gap-2 w-full sm:w-auto">
                        <button id="btn-modal-essential-only" class="w-full sm:w-auto text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 px-3.5 py-2.5 rounded-xl transition-colors cursor-pointer">
                            Apenas o Básico
                        </button>
                        <button id="btn-modal-accept-all" class="w-full sm:w-auto text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl transition-colors cursor-pointer shadow-sm">
                            Salvar e Aceitar Todos
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
        createPreferencesModal();
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

    // ─── Cookie Consent Banner (LGPD & Monetização AdSense) ───────────────────
    function initCookieConsent() {
        if (getCookie('camrb_consent')) return;
        if (document.getElementById('cookie-consent-banner')) return;
        if (!document.body) {
            setTimeout(initCookieConsent, 50);
            return;
        }

        const bannerHtml = `
            <div id="cookie-consent-banner" class="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-[9999] bg-gray-900/95 dark:bg-gray-800/95 text-white p-5 rounded-2xl shadow-2xl backdrop-blur-md border border-gray-700/80 transition-all duration-300">
                <div class="flex items-start gap-3.5">
                    <div class="text-2xl flex-shrink-0">🍪</div>
                    <div class="flex-1">
                        <div class="flex items-center justify-between mb-1">
                            <h4 class="font-bold text-sm text-white">Sua Privacidade e Preferências</h4>
                            <button type="button" data-action="open-cookie-preferences" class="text-[11px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer">
                                Ver o que é salvo
                            </button>
                        </div>
                        <p class="text-xs text-gray-300 leading-relaxed mb-3.5">
                            Utilizamos pequenos dados para lembrar seu tema (escuro/claro), manter o site rápido e exibir conteúdos relevantes. Você tem total controle sobre suas escolhas. Veja nossos <a href="/termos" class="text-indigo-400 underline hover:text-indigo-300">Termos de Uso</a>.
                        </p>
                        <div class="flex items-center gap-2 flex-wrap">
                            <button id="btn-accept-all-cookies" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-sm transition-all transform active:scale-95 cursor-pointer">
                                Aceitar Todos
                            </button>
                            <button id="btn-essential-cookies" class="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-gray-200 font-medium text-xs rounded-xl border border-white/15 transition-all cursor-pointer">
                                Apenas o Básico
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', bannerHtml);

        const banner = document.getElementById('cookie-consent-banner');
        const closeConsent = (type) => {
            setCookie('camrb_consent', type, 31536000); // 1 ano
            if (banner) {
                banner.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                banner.style.opacity = '0';
                banner.style.transform = 'translateY(20px)';
                setTimeout(() => banner.remove(), 300);
            }
        };

        const acceptAllBtn = document.getElementById('btn-accept-all-cookies');
        const essentialBtn = document.getElementById('btn-essential-cookies');

        if (acceptAllBtn) acceptAllBtn.addEventListener('click', () => closeConsent('all'));
        if (essentialBtn) essentialBtn.addEventListener('click', () => closeConsent('essential'));
    }

    function onReady(fn) {
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
            fn();
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }

    // ─── Domain Migration Banner & Global Listeners ───────────────────────────
    onReady(function() {
        initCookieConsent();

        // Global click delegator for theme toggles across all pages
        document.addEventListener('click', function(e) {
            const themeBtn = e.target.closest('#toggle-theme, [data-action="toggle-theme"], .toggle-theme-btn, #theme-toggle-card');
            if (themeBtn) {
                e.preventDefault();
                window.toggleTheme();
            }
        });

        // Global click delegator for cookie preferences
        document.addEventListener('click', function(e) {
            const target = e.target.closest('[data-action="open-cookie-preferences"], #open-cookie-preferences-footer, #open-cookie-preferences-profile');
            if (target) {
                e.preventDefault();
                window.openCookiePreferences();
            }
        });

        const hostname = window.location.hostname;
        const isLocal = ['localhost', '127.0.0.1', '10.', '192.168.', '172.', '::1'].some(h => hostname.includes(h));
        const isSiteDomain = hostname.includes('.site') || hostname.includes('camerasriobranco.site');
        const isNewDomain = hostname === 'camerasriobranco.com.br' || hostname.endsWith('.camerasriobranco.com.br');
        const shouldShow = isSiteDomain || (!isLocal && !isNewDomain) || isLocal;
        
        if (shouldShow && !sessionStorage.getItem('domain-banner-dismissed')) {
            showMigrationBanner(isLocal);
        }
    });

    function showMigrationBanner(isLocal) {
        if (!document.body) {
            setTimeout(() => showMigrationBanner(isLocal), 50);
            return;
        }

        const style = document.createElement('style');
        style.textContent = `
            #domain-migration-banner {
                background: linear-gradient(135deg, #f59e0b, #d97706);
                color: #ffffff;
                font-family: 'Inter', sans-serif;
                font-size: 14px;
                padding: 12px 16px;
                position: relative;
                z-index: 10000;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                text-align: center;
                transition: all 0.3s ease-in-out;
            }
            @media (min-width: 768px) {
                #domain-migration-banner {
                    flex-direction: row;
                    justify-content: space-between;
                    text-align: left;
                    gap: 20px;
                    padding: 8px 24px;
                }
            }
            #domain-migration-banner .banner-message {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 500;
                line-height: 1.4;
            }
            #domain-migration-banner .banner-message strong {
                font-weight: 700;
            }
            #domain-migration-banner .banner-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                justify-content: center;
            }
            #domain-migration-banner button, #domain-migration-banner a {
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                padding: 6px 12px;
                cursor: pointer;
                transition: all 0.2s ease;
                border: none;
                text-decoration: none;
                display: inline-flex;
                align-items: center;
            }
            #domain-migration-banner .btn-primary {
                background-color: #ffffff;
                color: #d97706;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            #domain-migration-banner .btn-primary:hover {
                background-color: #f3f4f6;
                transform: translateY(-1px);
            }
            #domain-migration-banner .btn-secondary {
                background-color: rgba(255, 255, 255, 0.2);
                color: #ffffff;
            }
            #domain-migration-banner .btn-secondary:hover {
                background-color: rgba(255, 255, 255, 0.3);
            }
            #domain-migration-banner .btn-close {
                background: transparent;
                color: rgba(255, 255, 255, 0.8);
                font-size: 20px;
                padding: 4px 8px;
                font-weight: 300;
            }
            #domain-migration-banner .btn-close:hover {
                color: #ffffff;
            }
            #domain-migration-banner .pulse-icon {
                animation: pulse 2s infinite;
                flex-shrink: 0;
            }
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.15); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);

        const banner = document.createElement('div');
        banner.id = 'domain-migration-banner';
        
        const targetUrl = 'https://camerasriobranco.com.br' + window.location.pathname + window.location.search + window.location.hash;
        
        let secondsLeft = 15;
        let countdownInterval;

        banner.innerHTML = `
            <div class="banner-message">
                <svg class="pulse-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>
                    O domínio antigo <strong>camerasriobranco.site</strong> expira dia <strong>27/06</strong>. 
                    Redirecionando para o novo oficial em <strong id="migration-timer">${secondsLeft}s</strong>...
                </span>
            </div>
            <div class="banner-actions">
                <a href="${targetUrl}" class="btn-primary">Acessar Novo Site</a>
                <button id="btn-pause-migration" class="btn-secondary">Pausar</button>
                <button id="btn-close-migration" class="btn-close" title="Dispensar aviso">&times;</button>
            </div>
        `;

        document.body.prepend(banner);

        const timerEl = document.getElementById('migration-timer');
        const pauseBtn = document.getElementById('btn-pause-migration');
        const closeBtn = document.getElementById('btn-close-migration');

        const startCountdown = () => {
            countdownInterval = setInterval(() => {
                secondsLeft--;
                if (secondsLeft <= 0) {
                    clearInterval(countdownInterval);
                    if (isLocal) {
                        timerEl.innerHTML = `<span style="background: rgba(0,0,0,0.25); padding: 3px 6px; border-radius: 4px; font-size: 11px;">Simulado (localhost)</span>`;
                        console.log("[MIGRATION REDIRECT] Redirecionaria para:", targetUrl);
                    } else {
                        window.location.href = targetUrl;
                    }
                } else {
                    timerEl.textContent = `${secondsLeft}s`;
                }
            }, 1000);
        };

        const stopCountdown = () => {
            clearInterval(countdownInterval);
            timerEl.parentElement.innerHTML = `O domínio antigo <strong>camerasriobranco.site</strong> expira dia <strong>27/06</strong>. Por favor, salve o novo endereço oficial: <strong>camerasriobranco.com.br</strong>.`;
            pauseBtn.style.display = 'none';
        };

        pauseBtn.addEventListener('click', stopCountdown);

        closeBtn.addEventListener('click', () => {
            clearInterval(countdownInterval);
            sessionStorage.setItem('domain-banner-dismissed', 'true');
            banner.style.opacity = '0';
            banner.style.height = '0';
            banner.style.padding = '0';
            setTimeout(() => {
                banner.remove();
            }, 300);
        });

        startCountdown();
    }

    // ─── Global Real-Time Presence System (Todas as Páginas) ──────────────────
    function initGlobalPresence() {
        const currentPath = window.location.pathname.toLowerCase();
        // Na página dedicada de câmera individual ou embed, o player de vídeo MJPEG (/stream/camera/:code) já gerencia o espectador ao vivo
        if (currentPath.startsWith('/camera') || currentPath.startsWith('/embed')) {
            return;
        }

        let presenceEventSource = null;
        let currentUserToken = null;
        let syncDebounceTimer = null;

        function getOrCreateTabId() {
            try {
                let tabId = sessionStorage.getItem('camrb_tab_id');
                if (!tabId) {
                    tabId = 'tab_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
                    sessionStorage.setItem('camrb_tab_id', tabId);
                }
                return tabId;
            } catch (_) {
                return 'tab_' + Math.random().toString(36).substring(2, 11);
            }
        }

        function getPageInfo() {
            const rawPath = window.location.pathname.toLowerCase();
            const path = rawPath.replace(/\/$/, '') || '/';
            
            let title = document.title ? document.title.split('|')[0].split(' - ')[0].trim() : 'Página';
            let code = 'PAGE';
            let category = 'Navegação Web';

            if (path === '/' || path === '/index.html') {
                title = 'Tela Inicial (Início)';
                code = 'HOME';
                category = 'Página Principal';
            } else if (path === '/rio' || path === '/rio.html') {
                title = 'Nível do Rio Acre';
                code = 'RIO';
                category = 'Telemetria';
            } else if (path === '/mapa' || path === '/mapa.html') {
                title = 'Mapa Interativo';
                code = 'MAPA';
                category = 'Geolocalização';
            } else if (path === '/timelapses' || path === '/timelapses.html') {
                title = 'Central de Timelapses';
                code = 'TIMELAPSE';
                category = 'Multimídia';
            } else if (path === '/sobre' || path === '/sobre.html') {
                title = 'Sobre o CamRB';
                code = 'SOBRE';
                category = 'Institucional';
            } else if (path === '/contato' || path === '/contato.html') {
                title = 'Contato & Suporte';
                code = 'CONTATO';
                category = 'Atendimento';
            } else if (path === '/perfil' || path === '/perfil.html') {
                title = 'Meu Perfil';
                code = 'PERFIL';
                category = 'Usuário';
            } else if (path === '/novidades' || path === '/novidades.html') {
                title = 'Novidades & Changelog';
                code = 'NOVIDADES';
                category = 'Informativo';
            } else if (path === '/patrocine' || path === '/patrocine.html') {
                title = 'Seja um Patrocinador';
                code = 'PATROCINE';
                category = 'Comercial';
            } else if (path === '/termos' || path === '/termos.html') {
                title = 'Termos de Uso';
                code = 'TERMOS';
                category = 'Legal';
            } else if (path === '/metrics' || path === '/metrics.html') {
                title = 'Métricas Públicas';
                code = 'METRICS';
                category = 'Estatísticas';
            } else if (path.startsWith('/admin') || path.startsWith('/dashboard')) {
                title = 'Painel Administrativo';
                code = 'ADMIN';
                category = 'Administração';
            } else if (path.startsWith('/camera/')) {
                const parts = path.split('/');
                const camCode = parts[2] || '';
                title = `Câmera ${camCode}`;
                code = camCode || 'CAMERA';
                category = 'Câmera ao Vivo';
            }

            return { path: window.location.pathname, title, code, category };
        }

        function _connectPresenceStream() {
            if (presenceEventSource) {
                try { presenceEventSource.close(); } catch (_) {}
                presenceEventSource = null;
            }

            const info = getPageInfo();
            const tabId = getOrCreateTabId();
            const queryParams = new URLSearchParams({
                path: info.path,
                title: info.title,
                code: info.code,
                category: info.category,
                tabId: tabId
            });

            if (currentUserToken) {
                queryParams.set('token', currentUserToken);
            }

            try {
                presenceEventSource = new EventSource(`/api/presence/stream?${queryParams.toString()}`);

                presenceEventSource.onerror = () => {
                    if (presenceEventSource) {
                        try { presenceEventSource.close(); } catch (_) {}
                        presenceEventSource = null;
                    }
                    setTimeout(() => {
                        _connectPresenceStream();
                    }, 5000);
                };
            } catch (_) {}
        }

        function syncPresence(token = null) {
            if (token !== undefined) currentUserToken = token;

            if (syncDebounceTimer) {
                clearTimeout(syncDebounceTimer);
            }

            // Debounce curto de 80ms para consolidar DOMContentLoaded e autenticação do Firebase sem criar conexões duplas
            syncDebounceTimer = setTimeout(() => {
                _connectPresenceStream();
            }, 80);
        }

        window.syncGlobalPresenceAuth = function(token) {
            syncPresence(token);
        };

        // Conecta na inicialização da página
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => syncPresence());
        } else {
            syncPresence();
        }

        const cleanupPresence = () => {
            if (syncDebounceTimer) {
                clearTimeout(syncDebounceTimer);
                syncDebounceTimer = null;
            }
            if (presenceEventSource) {
                try { presenceEventSource.close(); } catch (_) {}
                presenceEventSource = null;
            }
        };

        window.addEventListener('beforeunload', cleanupPresence);
        window.addEventListener('pagehide', cleanupPresence);
    }

    initGlobalPresence();
})();
