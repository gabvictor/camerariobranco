export function initCookieConsent() {
    if (document.getElementById('cookie-consent-banner')) return;
    
    // Check if consent cookie already exists
    const match = document.cookie.match(/(^|;\s*)camrb_consent=([^;]+)/);
    if (match) return;

    const bannerHtml = `
        <div id="cookie-consent-banner" class="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-[9999] bg-slate-900 text-white p-5 rounded-xl shadow-xl border border-slate-700/80 transition-all duration-300">
            <div class="flex items-start gap-3">
                <div class="p-2 rounded-lg bg-slate-800 text-indigo-400 flex-shrink-0">
                    <i data-lucide="shield-check" class="w-5 h-5"></i>
                </div>
                <div class="flex-1">
                    <div class="flex items-center justify-between mb-1">
                        <h4 class="font-bold text-sm text-white">Privacidade e Cookies</h4>
                        <button type="button" data-action="open-cookie-preferences" class="text-[11px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer">
                            Preferências
                        </button>
                    </div>
                    <p class="text-xs text-slate-300 leading-relaxed mb-3.5">
                        Utilizamos cookies essenciais para manter preferências do portal (tema e monitoramento). Consulte nossos <a href="/termos" class="text-indigo-400 underline hover:text-indigo-300">Termos de Uso e Privacidade</a>.
                    </p>
                    <div class="flex items-center gap-2 flex-wrap">
                        <button id="btn-accept-all-cookies" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-xs transition-colors cursor-pointer">
                            Aceitar Todos
                        </button>
                        <button id="btn-essential-cookies" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-lg border border-slate-700 transition-colors cursor-pointer">
                            Apenas Essenciais
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', bannerHtml);

    const banner = document.getElementById('cookie-consent-banner');
    const closeConsent = (type) => {
        document.cookie = `camrb_consent=${type}; path=/; max-age=31536000; SameSite=Lax`;
        if (banner) {
            banner.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(12px)';
            setTimeout(() => banner.remove(), 250);
        }
    };

    document.getElementById('btn-accept-all-cookies')?.addEventListener('click', () => closeConsent('all'));
    document.getElementById('btn-essential-cookies')?.addEventListener('click', () => closeConsent('essential'));

    if (window.lucide) window.lucide.createIcons();
}

export function initFooter() {
    initCookieConsent();

    let footerContainer = document.getElementById('global-footer');
    if (!footerContainer) {
        footerContainer = document.createElement('div');
        footerContainer.id = 'global-footer';
        document.body.appendChild(footerContainer);
    }

    footerContainer.innerHTML = `
        <footer class="mt-12 w-full border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors">
            <div class="container mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 max-w-6xl">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-8">
                    
                    <!-- Coluna 1: Marca & Missão (2 colunas em telas grandes) -->
                    <div class="lg:col-span-2 space-y-3">
                        <div class="flex items-center gap-2.5">
                            <a href="/" class="flex items-center gap-2 group">
                                <div class="bg-indigo-600 p-1.5 rounded-lg text-white">
                                    <i data-lucide="video" class="w-4 h-4"></i>
                                </div>
                                <span class="text-lg font-bold text-slate-900 dark:text-white tracking-tight">CamRB</span>
                            </a>
                            <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400 border-l border-slate-200 dark:border-slate-700 pl-2.5">
                                Rio Branco • AC
                            </span>
                        </div>
                        
                        <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm">
                            Plataforma de monitoramento público com transmissão de câmeras urbanas e telemetria hidrológica contínua do Rio Acre (estação Ponte Metálica / CPRM / ANA).
                        </p>

                        <!-- Links de Contato e Código -->
                        <div class="flex items-center gap-2 pt-1 text-slate-500 dark:text-slate-400">
                            <a href="https://github.com/gabvictor/camerariobranco" target="_blank" rel="noopener noreferrer"
                                class="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                                title="Código Fonte no GitHub">
                                <span class="sr-only">GitHub</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.2c3-.3 6-1.5 6-6.5a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 5 3 6.2 6 6.5a4.8 4.8 0 0 0-1 3.2v4"/><path d="M9 18c-4.5 1.5-5-2.5-7-3"/></svg>
                            </a>
                            <a href="https://www.instagram.com/gabv_ctor/" target="_blank" rel="noopener noreferrer"
                                class="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                                title="Instagram">
                                <span class="sr-only">Instagram</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>
                            </a>
                            <a href="mailto:suportecamrb@gmail.com"
                                class="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                                title="Contato por E-mail">
                                <span class="sr-only">Email</span>
                                <i data-lucide="mail" class="w-4 h-4"></i>
                            </a>
                        </div>
                    </div>

                    <!-- Coluna 2: Monitoramento & Câmeras -->
                    <div>
                        <h3 class="font-semibold text-xs uppercase tracking-wider text-slate-900 dark:text-slate-200 mb-3">
                            Monitoramento
                        </h3>
                        <ul class="space-y-2 text-xs">
                            <li>
                                <a href="/rio" class="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center justify-between">
                                    <span>Nível do Rio Acre</span>
                                    <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500">ANA/CPRM</span>
                                </a>
                            </li>
                            <li>
                                <a href="/timelapses" class="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center justify-between">
                                    <span>Timelapses 24h</span>
                                </a>
                            </li>
                            <li>
                                <a href="/mapa" class="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                    Mapa das Câmeras
                                </a>
                            </li>
                            <li>
                                <a href="/" class="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                    Grade de Câmeras
                                </a>
                            </li>
                        </ul>
                    </div>

                    <!-- Coluna 3: Institucional -->
                    <div>
                        <h3 class="font-semibold text-xs uppercase tracking-wider text-slate-900 dark:text-slate-200 mb-3">
                            Institucional
                        </h3>
                        <ul class="space-y-2 text-xs">
                            <li>
                                <a href="/sobre" class="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                    Sobre o Projeto
                                </a>
                            </li>
                            <li>
                                <a href="/novidades" class="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                    Registro de Atualizações
                                </a>
                            </li>
                        </ul>
                    </div>

                    <!-- Coluna 4: Transparência & Termos -->
                    <div>
                        <h3 class="font-semibold text-xs uppercase tracking-wider text-slate-900 dark:text-slate-200 mb-3">
                            Termos & Acesso
                        </h3>
                        <ul class="space-y-2 text-xs">
                            <li>
                                <a href="/termos" class="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                    Termos de Uso e Privacidade
                                </a>
                            </li>
                            <li>
                                <button type="button" data-action="open-cookie-preferences" class="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors inline-flex items-center gap-1 cursor-pointer">
                                    Gerenciar Cookies
                                </button>
                            </li>
                            <li>
                                <a href="/perfil" class="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                    Área do Usuário
                                </a>
                            </li>
                        </ul>
                    </div>

                </div>

                <!-- Bottom Bar -->
                <div class="border-t border-slate-200 dark:border-slate-800 mt-8 pt-5 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <div>
                        &copy; ${new Date().getFullYear()} CamRB. Monitoramento público de Rio Branco, Acre.
                    </div>

                    <div class="flex items-center gap-4">
                        <button onclick="window.scrollTo({ top: 0, behavior: 'smooth' })" class="hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1 cursor-pointer" title="Voltar ao topo">
                            <i data-lucide="arrow-up" class="w-3.5 h-3.5"></i>
                            <span>Início da página</span>
                        </button>
                    </div>
                </div>
            </div>
        </footer>
    `;

    if (window.lucide) {
        window.lucide.createIcons();
    }
}
