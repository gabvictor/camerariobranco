import { db } from "./firebase-config.js";
import { collection, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const initChangelog = () => {
    const navChangelogBtn = document.getElementById('nav-changelog-btn');
    const changelogModal = document.getElementById('changelog-modal');
    const closeChangelogBtn = document.getElementById('close-changelog-modal');
    const changelogBadge = document.getElementById('changelog-badge');
    const changelogContent = document.getElementById('changelog-content');

    if (!navChangelogBtn || !changelogModal) return;

    const checkChangelogNotification = async () => {
        const lastViewed = localStorage.getItem('lastViewedChangelog');
        
        try {
            const q = query(collection(db, 'changelog'), where('active', '==', true), orderBy('timestamp', 'desc'));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) return;
            
            const docs = querySnapshot.docs;
            if (docs.length === 0) return;

            const latestDoc = docs[0].data();
            let latestTimestamp = null;
            
            if (latestDoc.timestamp) {
                if (latestDoc.timestamp.toDate) {
                    latestTimestamp = latestDoc.timestamp.toDate().toISOString();
                } else {
                    latestTimestamp = new Date(latestDoc.timestamp).toISOString();
                }
            }
            
            if (!lastViewed || (latestTimestamp && new Date(latestTimestamp) > new Date(lastViewed))) {
                changelogBadge.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Erro ao verificar notificações:', error);
        }
    };

    const openChangelogModal = async () => {
        changelogModal.classList.remove('hidden');
        changelogBadge.classList.add('hidden');
        localStorage.setItem('lastViewedChangelog', new Date().toISOString());
        
        changelogContent.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 animate-pulse">
                <div class="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p class="text-sm text-gray-500 font-medium">Buscando novidades...</p>
            </div>
        `;
        
        try {
            const q = query(collection(db, 'changelog'), where('active', '==', true), orderBy('timestamp', 'desc'));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                changelogContent.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-12 text-center">
                        <div class="bg-gray-100 dark:bg-gray-700/50 p-4 rounded-full mb-4">
                            <i data-lucide="ghost" class="w-8 h-8 text-gray-400"></i>
                        </div>
                        <h4 class="text-lg font-bold text-gray-800 dark:text-gray-200">Nada por aqui ainda</h4>
                        <p class="text-sm text-gray-500 max-w-[200px]">Fique atento para futuras atualizações do CamRB.</p>
                    </div>
                `;
                if (window.lucide) window.lucide.createIcons();
                return;
            }
            
            changelogContent.innerHTML = '<div class="space-y-4"></div>';
            const timelineContainer = changelogContent.firstChild;

            querySnapshot.forEach((doc) => {
                const data = doc.data();
                
                // Limitador para o Título
                const fullTitle = data.title || '';
                const titleLimit = 40;
                const truncatedTitle = fullTitle.length > titleLimit 
                    ? fullTitle.substring(0, titleLimit) + '...' 
                    : fullTitle;

                // Limitador para a Mensagem
                const fullMessage = data.message || '';
                const charLimit = 150;
                const truncatedMessage = fullMessage.length > charLimit 
                    ? fullMessage.substring(0, charLimit) + '...' 
                    : fullMessage;

                const item = `
                    <div class="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 p-4 animate-fade-in-up">
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <h3 class="font-bold text-gray-900 dark:text-white truncate" title="${fullTitle}">${truncatedTitle}</h3>
                            <span class="text-[10px] font-bold text-indigo-500 uppercase tracking-wider flex-shrink-0">${data.date}</span>
                        </div>
                        <p class="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">${truncatedMessage}</p>
                    </div>
                `;
                timelineContainer.insertAdjacentHTML('beforeend', item);
            });
            
            if (window.lucide) window.lucide.createIcons();
        } catch (error) {
            console.error('Erro ao carregar changelog:', error);
            changelogContent.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 text-center">
                    <div class="bg-red-50 dark:bg-red-900/20 p-4 rounded-full mb-4">
                        <i data-lucide="alert-circle" class="w-8 h-8 text-red-500"></i>
                    </div>
                    <h4 class="text-lg font-bold text-gray-800 dark:text-gray-200">Erro ao carregar</h4>
                    <p class="text-sm text-gray-500">Não conseguimos buscar as novidades no momento.</p>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
        }
    };

    navChangelogBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openChangelogModal();
    });

    if (closeChangelogBtn) {
        closeChangelogBtn.addEventListener('click', () => changelogModal.classList.add('hidden'));
    }
    
    // Fechar ao clicar fora
    changelogModal.addEventListener('click', (e) => {
        if (e.target === changelogModal) changelogModal.classList.add('hidden');
    });

    checkChangelogNotification();
};

// Inicialização automática
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChangelog);
} else {
    initChangelog();
}
