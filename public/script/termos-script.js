import { initAuthModal, initGlobalAuthUI } from "./auth-modal.js";
import { initFooter } from "./footer-component.js";

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Auth UI
    initAuthModal();
    initGlobalAuthUI();

    // Initialize Footer
    initFooter();

    // Initialize Lucide icons
    if (window.lucide) window.lucide.createIcons();

    // Theme toggle logic
    const themeBtn = document.getElementById('toggle-theme');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            if (window.toggleTheme) window.toggleTheme();
        });
    }

    fetchTermos();
});

async function fetchTermos() {
    const container = document.getElementById('termos-content');
    const dateSpan = document.getElementById('last-updated');

    try {
        const response = await fetch('/termos.json');
        if (!response.ok) throw new Error('Falha ao carregar termos');
        
        const data = await response.json();
        
        if (data.lastUpdated && dateSpan) {
            dateSpan.textContent = `Versão ${data.version || '3.0'} — Atualizado em ${data.lastUpdated}`;
        }

        container.innerHTML = ''; // Clear loader

        let currentList = null;

        data.content.forEach(item => {
            if (item.type === 'listItem') {
                if (!currentList) {
                    currentList = document.createElement('ul');
                    currentList.className = "space-y-3 mb-6 pl-2";
                    container.appendChild(currentList);
                }
                const li = document.createElement('li');
                li.className = "flex items-start gap-2.5 text-sm sm:text-base";
                
                const dot = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 mt-2 flex-shrink-0"></span>`;
                if (item.boldPrefix) {
                    li.innerHTML = `${dot}<div><strong class="font-bold text-gray-900 dark:text-white">${item.boldPrefix}</strong> <span class="text-gray-600 dark:text-gray-300">${item.text}</span></div>`;
                } else {
                    li.innerHTML = `${dot}<span class="text-gray-600 dark:text-gray-300">${item.text}</span>`;
                }
                currentList.appendChild(li);
            } else {
                currentList = null;

                if (item.type === 'title') {
                    const h2 = document.createElement('h2');
                    h2.className = "text-lg sm:text-xl font-extrabold text-gray-900 dark:text-white mt-8 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700/80 flex items-center gap-2";
                    h2.textContent = item.text;
                    container.appendChild(h2);
                } else if (item.type === 'paragraph') {
                    const p = document.createElement('p');
                    p.className = "text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed mb-4";
                    if (item.boldPrefix) {
                        p.innerHTML = `<strong class="font-bold text-gray-900 dark:text-white">${item.boldPrefix}</strong> ${item.text}`;
                    } else {
                        p.textContent = item.text;
                    }
                    container.appendChild(p);
                }
            }
        });

        if (window.lucide) window.lucide.createIcons();

    } catch (error) {
        console.error(error);
        container.innerHTML = `
            <div class="text-center py-8 text-red-500">
                <p>Erro ao carregar os termos. Por favor, recarregue a página.</p>
            </div>
        `;
    }
}
