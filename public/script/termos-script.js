
import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initAuthModal, initGlobalAuthUI, toggleLoginModal } from "./auth-modal.js";

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Auth
    initAuthModal();
    initGlobalAuthUI();



    // Initialize Lucide icons
    if (window.lucide) window.lucide.createIcons();

    // Theme toggle logic (reuse if possible, or simple implementation)
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
            dateSpan.textContent = `Última atualização: ${data.lastUpdated}`;
        }

        container.innerHTML = ''; // Clear loader

        let currentList = null;

        data.content.forEach(item => {
            // Handle List Items grouping
            if (item.type === 'listItem') {
                if (!currentList) {
                    currentList = document.createElement('ul');
                    currentList.className = "list-disc pl-6 space-y-2 mb-4";
                    container.appendChild(currentList);
                }
                const li = document.createElement('li');
                if (item.boldPrefix) {
                    li.innerHTML = `<span class="font-semibold text-gray-900 dark:text-white">${item.boldPrefix}</span> ${item.text}`;
                } else {
                    li.textContent = item.text;
                }
                currentList.appendChild(li);
            } else {
                // If we encounter non-list item, close current list
                currentList = null;

                if (item.type === 'title') {
                    const h2 = document.createElement('h2');
                    h2.className = "text-xl font-bold text-gray-900 dark:text-white mt-8 mb-4";
                    h2.textContent = item.text;
                    container.appendChild(h2);
                } else if (item.type === 'paragraph') {
                    const p = document.createElement('p');
                    if (item.boldPrefix) {
                        p.innerHTML = `<span class="font-semibold text-gray-900 dark:text-white">${item.boldPrefix}</span> ${item.text}`;
                    } else {
                        p.textContent = item.text;
                    }
                    container.appendChild(p);
                } else if (item.type === 'date') {
                    // Already handled in header, but can add here if needed
                }
            }
        });

    } catch (error) {
        console.error(error);
        container.innerHTML = `
            <div class="text-center py-8 text-red-500">
                <p>Erro ao carregar os termos. Por favor, recarregue a página.</p>
            </div>
        `;
    }
}
