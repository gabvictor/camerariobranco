
export function initFooter() {
    const footerContainer = document.getElementById('global-footer');
    if (!footerContainer) return;

    const isFullFooter = footerContainer.getAttribute('data-type') === 'full';

    if (isFullFooter) {
        footerContainer.innerHTML = `
            <footer class="mt-auto w-full border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 transition-colors">
                <div class="container mx-auto px-4 py-8">
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
                        <div class="col-span-1 md:col-span-2">
                            <div class="flex items-center gap-2 mb-4">
                                <div class="bg-indigo-600 p-1.5 rounded-lg">
                                    <i data-lucide="video" class="w-5 h-5 text-white"></i>
                                </div>
                                <span class="text-xl font-bold text-gray-900 dark:text-white tracking-tight">CamRB</span>
                            </div>
                            <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-xs">
                                Conectando Rio Branco em tempo real. Uma iniciativa para democratizar o acesso à
                                informação de trânsito e segurança urbana através da tecnologia.
                            </p>
                            <div class="flex gap-4 mt-6">
                                <a href="https://github.com/gabvictor/camerariobranco" target="_blank"
                                    class="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                    <span class="sr-only">GitHub</span> <i data-lucide="github" class="w-5 h-5"></i>
                                </a>
                                <a href="https://www.instagram.com/gabv_ctor/" target="_blank"
                                    class="text-gray-400 hover:text-pink-600 transition-colors">
                                    <span class="sr-only">Instagram</span>
                                    <i data-lucide="instagram" class="w-5 h-5"></i>
                                </a>
                                <a href="mailto:suportecamrb@gmail.com"
                                    class="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                    <span class="sr-only">Email</span>
                                    <i data-lucide="mail" class="w-5 h-5"></i>
                                </a>
                            </div>
                        </div>
                        <div class="col-span-1 md:col-span-2 md:text-right">
                            <h3 class="font-semibold text-gray-900 dark:text-white mb-4 text-sm uppercase tracking-wider">
                                Links Úteis</h3>
                            <ul class="space-y-3 text-sm inline-block text-left md:text-right">
                                <li><a href="https://github.com/gabvictor/camerariobranco" target="_blank"
                                        class="text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Código Fonte</a></li>
                                <li><a href="/sobre"
                                        class="text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Sobre Nós</a></li>
                                <li><a href="/novidades"
                                        class="text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Novidades</a></li>
                                <li><a href="/termos"
                                        class="text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Termos de Uso e Privacidade</a></li>
                                <li><a href="/admin"
                                        class="text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors hidden admin-only">Área Admin</a></li>
                            </ul>
                        </div>
                    </div>
                    <div class="border-t border-gray-200 dark:border-gray-700 mt-8 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
                        <p class="text-sm text-gray-500 dark:text-gray-400 text-center sm:text-left">
                            &copy; 2025 <span class="font-medium text-gray-900 dark:text-white">CamRB</span>. Todos os direitos reservados.
                        </p>
                        <div class="flex items-center gap-1 text-xs text-gray-400">
                            <span>Desenvolvido com</span>
                            <i data-lucide="heart" class="w-3 h-3 text-red-500 fill-red-500"></i>
                            <span>em Rio Branco - AC</span>
                        </div>
                    </div>
                </div>
            </footer>
        `;
    } else {
        footerContainer.innerHTML = `
            <footer class="mt-12 border-t border-gray-200 dark:border-gray-700 pt-6 pb-8">
                <div class="flex flex-col md:flex-row justify-between items-center gap-4">
                    <div class="flex flex-wrap justify-center md:justify-start gap-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                        <a href="/sobre" class="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Sobre Nós</a>
                        <a href="/novidades" class="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Novidades</a>
                        <a href="/termos" class="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Termos de Uso</a>
                        <a href="https://github.com/gabvictor/CamRB" target="_blank" class="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">GitHub</a>
                    </div>
                    <p class="text-xs text-gray-400">
                        &copy; 2025 CamRB. Todos os direitos reservados.
                    </p>
                </div>
            </footer>
        `;
    }

    if (window.lucide) {
        window.lucide.createIcons();
    }
}
