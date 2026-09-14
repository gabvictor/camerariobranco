export function initCookieConsent() {
    if (document.getElementById('cookie-consent-banner')) return;
    
    // Check if consent cookie already exists
    const match = document.cookie.match(/(^|;\s*)camrb_consent=([^;]+)/);
    if (match) return;

    const bannerHtml = `
        <div id="cookie-consent-banner" class="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-[9999] bg-gray-900/95 dark:bg-gray-800/95 text-white p-5 rounded-3xl shadow-2xl backdrop-blur-md border border-gray-700/80 transition-all duration-300">
            <div class="flex items-start gap-3.5">
                <div class="text-2xl flex-shrink-0">🍪</div>
                <div class="flex-1">
                    <div class="flex items-center justify-between mb-1">
                        <h4 class="font-bold text-sm text-white">Privacidade e Cookies</h4>
                        <button type="button" data-action="open-cookie-preferences" class="text-[11px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer">
                            Ver detalhes
                        </button>
                    </div>
                    <p class="text-xs text-gray-300 leading-relaxed mb-3.5">
                        Utilizamos cookies para salvar suas preferências (tema escuro e favoritas) e exibir anúncios personalizados mais relevantes. Veja nossos <a href="/termos" class="text-indigo-400 underline hover:text-indigo-300">Termos de Uso</a>.
                    </p>
                    <div class="flex items-center gap-2 flex-wrap">
                        <button id="btn-accept-all-cookies" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-sm transition-all transform active:scale-95 cursor-pointer">
                            Aceitar Todos
                        </button>
                        <button id="btn-essential-cookies" class="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-gray-200 font-medium text-xs rounded-xl border border-white/15 transition-all cursor-pointer">
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
            banner.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(20px)';
            setTimeout(() => banner.remove(), 300);
        }
    };

    document.getElementById('btn-accept-all-cookies')?.addEventListener('click', () => closeConsent('all'));
    document.getElementById('btn-essential-cookies')?.addEventListener('click', () => closeConsent('essential'));
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
        <footer class="mt-8 w-full border-t border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl transition-colors">
            <!-- Top Accent Gradient Line -->
            <div class="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-80"></div>

            <div class="container mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-10">
                    
                    <!-- Coluna 1: Marca & Missão (2 colunas em telas grandes) -->
                    <div class="lg:col-span-2 space-y-4">
                        <div class="flex items-center gap-2.5">
                            <a href="/" class="flex items-center gap-2.5 group">
                                <div class="bg-indigo-600 p-2 rounded-xl text-white shadow-md shadow-indigo-600/30 group-hover:scale-105 transition-transform">
                                    <i data-lucide="video" class="w-6 h-6"></i>
                                </div>
                                <span class="text-2xl font-black text-gray-900 dark:text-white tracking-tight">CamRB</span>
                            </a>
                            <span class="ml-1 px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5 shadow-sm">
                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Ao Vivo 24h
                            </span>
                        </div>
                        
                        <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-sm">
                            Plataforma independente de monitoramento urbano em tempo real para Rio Branco - AC. Acompanhe o trânsito, a segurança e as cheias do Rio Acre a qualquer momento.
                        </p>

                        <!-- Social Links & Contato Rápido -->
                        <div class="flex items-center gap-2.5 pt-1">
                            <a href="https://github.com/gabvictor/camerariobranco" target="_blank" rel="noopener noreferrer"
                                class="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all shadow-sm active:scale-95"
                                title="Código Fonte no GitHub">
                                <span class="sr-only">GitHub</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.2c3-.3 6-1.5 6-6.5a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 5 3 6.2 6 6.5a4.8 4.8 0 0 0-1 3.2v4"/><path d="M9 18c-4.5 1.5-5-2.5-7-3"/></svg>
                            </a>
                            <a href="https://www.instagram.com/gabv_ctor/" target="_blank" rel="noopener noreferrer"
                                class="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-pink-600 hover:text-white dark:hover:bg-pink-600 dark:hover:text-white transition-all shadow-sm active:scale-95"
                                title="Instagram">
                                <span class="sr-only">Instagram</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>
                            </a>
                            <a href="mailto:suportecamrb@gmail.com"
                                class="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all shadow-sm active:scale-95"
                                title="Enviar E-mail">
                                <span class="sr-only">Email</span>
                                <i data-lucide="mail" class="w-4 h-4"></i>
                            </a>
                        </div>
                    </div>

                    <!-- Coluna 2: Monitoramento & Câmeras -->
                    <div>
                        <h3 class="font-bold text-xs uppercase tracking-wider text-gray-900 dark:text-white mb-3.5 flex items-center gap-1.5">
                            <i data-lucide="activity" class="w-4 h-4 text-indigo-500"></i>
                            Monitoramento
                        </h3>
                        <ul class="space-y-2 text-xs sm:text-sm">
                            <li>
                                <a href="/rio" class="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors flex items-center justify-between group">
                                    <span>🌊 Nível do Rio Acre</span>
                                    <span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">CPRM</span>
                                </a>
                            </li>
                            <li>
                                <a href="/timelapses" class="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors flex items-center justify-between group">
                                    <span>⏱️ Timelapses 24h</span>
                                    <span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">Novo</span>
                                </a>
                            </li>
                            <li>
                                <a href="/mapa" class="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors">
                                    🗺️ Mapa Interativo
                                </a>
                            </li>
                            <li>
                                <a href="/" class="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors">
                                    📹 Câmeras da Cidade
                                </a>
                            </li>
                        </ul>
                    </div>

                    <!-- Coluna 3: Informações & Parcerias -->
                    <div>
                        <h3 class="font-bold text-xs uppercase tracking-wider text-gray-900 dark:text-white mb-3.5 flex items-center gap-1.5">
                            <i data-lucide="info" class="w-4 h-4 text-purple-500"></i>
                            Institucional
                        </h3>
                        <ul class="space-y-2 text-xs sm:text-sm">
                            <li>
                                <a href="/sobre" class="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors">
                                    ℹ️ Sobre o Projeto
                                </a>
                            </li>
                            <li>
                                <a href="/novidades" class="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors">
                                    📢 Novidades & Versões
                                </a>
                            </li>
                        </ul>
                    </div>

                    <!-- Coluna 4: Legal & Conta -->
                    <div>
                        <h3 class="font-bold text-xs uppercase tracking-wider text-gray-900 dark:text-white mb-3.5 flex items-center gap-1.5">
                            <i data-lucide="shield-check" class="w-4 h-4 text-emerald-500"></i>
                            Institucional
                        </h3>
                        <ul class="space-y-2 text-xs sm:text-sm">
                            <li>
                                <a href="/termos" class="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors">
                                    Termos e Privacidade
                                </a>
                            </li>
                            <li>
                                <button type="button" data-action="open-cookie-preferences" class="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer">
                                    <span>🍪</span> Gerenciar Cookies
                                </button>
                            </li>
                            <li>
                                <a href="/perfil" class="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors">
                                    Meu Perfil
                                </a>
                            </li>
                        </ul>
                    </div>

                </div>

                <!-- Bottom Bar -->
                <div class="border-t border-gray-200 dark:border-gray-800 mt-8 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 text-center sm:text-left">
                        <span>&copy; ${new Date().getFullYear()} <strong class="text-gray-900 dark:text-white">CamRB</strong>. Todos os direitos reservados.</span>
                    </div>

                    <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                        <div class="flex items-center gap-1">
                            <span>Feito com</span>
                            <i data-lucide="heart" class="w-3.5 h-3.5 text-red-500 fill-red-500 inline"></i>
                            <span>em Rio Branco - Acre</span>
                        </div>

                        <button onclick="window.scrollTo({ top: 0, behavior: 'smooth' })" class="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-indigo-600 hover:text-white text-gray-600 dark:text-gray-300 transition-all text-xs font-semibold flex items-center gap-1 shadow-sm cursor-pointer" title="Voltar ao topo">
                            <i data-lucide="arrow-up" class="w-3.5 h-3.5"></i>
                            <span class="hidden md:inline">Topo</span>
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
