import { db } from "./firebase-config.js";
import { collection, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide Icons
    if (window.lucide) window.lucide.createIcons();

    const loader = document.getElementById('novidades-loader');
    const container = document.getElementById('timeline-container');
    const emptyState = document.getElementById('novidades-empty');
    const errorState = document.getElementById('novidades-error');

    const loadNovidades = async () => {
        try {
            const q = query(
                collection(db, 'changelog'), 
                where('active', '==', true), 
                orderBy('timestamp', 'desc')
            );
            
            const querySnapshot = await getDocs(q);
            
            loader.classList.add('hidden');

            if (querySnapshot.empty) {
                emptyState.classList.remove('hidden');
                return;
            }

            container.classList.remove('hidden');
            container.innerHTML = '';

            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const item = `
                    <div class="relative pl-8 md:pl-12 animate-fade-in-up">
                        <!-- Timeline Dot -->
                        <div class="absolute -left-[11px] top-2 w-5 h-5 bg-white dark:bg-gray-900 border-4 border-indigo-500 rounded-full z-10 shadow-sm"></div>
                        
                        <!-- Content Card -->
                        <div class="group bg-white dark:bg-gray-800/40 rounded-3xl border border-gray-100 dark:border-gray-700/50 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-300 p-6 md:p-8">
                            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                <div class="space-y-1">
                                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50 uppercase tracking-wider mb-2">
                                        ${data.date}
                                    </span>
                                    <h3 class="text-2xl font-extrabold text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-tight">
                                        ${data.title}
                                    </h3>
                                </div>
                            </div>
                            
                            <div class="prose dark:prose-invert max-w-none">
                                <p class="text-gray-600 dark:text-gray-400 whitespace-pre-line leading-relaxed text-base md:text-lg font-medium opacity-90">
                                    ${data.message}
                                </p>
                            </div>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', item);
            });

            // Re-initialize icons if any were added
            if (window.lucide) window.lucide.createIcons();

        } catch (error) {
            console.error('Erro ao carregar novidades:', error);
            loader.classList.add('hidden');
            errorState.classList.remove('hidden');
        }
    };

    loadNovidades();
});