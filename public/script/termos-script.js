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

const SECTION_ICONS = {
    "1": "video",
    "2": "alert-triangle",
    "3": "user-check",
    "4": "cookie",
    "5": "shield-check",
    "6": "mail",
    "7": "history"
};

async function fetchTermos() {
    const container = document.getElementById('termos-content');
    const tocContainer = document.getElementById('table-of-contents');
    const dateSpan = document.getElementById('last-updated');

    try {
        const response = await fetch('/termos.json?v=' + Date.now());
        if (!response.ok) throw new Error('Falha ao carregar termos');
        
        const data = await response.json();
        
        if (data.lastUpdated && dateSpan) {
            dateSpan.innerHTML = `<i data-lucide="calendar" class="w-3.5 h-3.5 text-indigo-500"></i><span>Versão <strong>${data.version || '3.0'}</strong> • Atualizado em <strong>${data.lastUpdated}</strong></span>`;
        }

        container.innerHTML = ''; // Clear loader
        if (tocContainer) tocContainer.innerHTML = '';

        let currentSectionId = null;
        let currentSectionCard = null;
        let currentList = null;
        let sectionCount = 0;
        const sectionsList = [];

        data.content.forEach((item, index) => {
            if (item.type === 'title') {
                sectionCount++;
                currentSectionId = `secao-${sectionCount}`;
                
                // Extract section number if present
                const numMatch = item.text.match(/^(\d+)/);
                const num = numMatch ? numMatch[1] : String(sectionCount);
                const iconName = SECTION_ICONS[num] || "file-text";

                // Create a distinct section card wrapper
                currentSectionCard = document.createElement('section');
                currentSectionCard.id = currentSectionId;
                currentSectionCard.className = "termos-section-card pt-6 first:pt-0 pb-6 border-b border-gray-100 dark:border-gray-800 last:border-none";
                
                // Header of section
                const header = document.createElement('div');
                header.className = "flex items-center gap-3 mb-4";
                header.innerHTML = `
                    <div class="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40 flex-shrink-0">
                        <i data-lucide="${iconName}" class="w-5 h-5"></i>
                    </div>
                    <h2 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white tracking-tight">${item.text}</h2>
                `;
                currentSectionCard.appendChild(header);
                container.appendChild(currentSectionCard);
                currentList = null;

                // Add to TOC
                sectionsList.push({ id: currentSectionId, text: item.text, num });

            } else if (item.type === 'paragraph') {
                const p = document.createElement('p');
                p.className = "text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-3";
                if (item.boldPrefix) {
                    p.innerHTML = `<strong class="font-bold text-gray-900 dark:text-white">${item.boldPrefix}</strong> ${item.text}`;
                } else {
                    p.textContent = item.text;
                }
                
                if (currentSectionCard) {
                    currentSectionCard.appendChild(p);
                } else {
                    container.appendChild(p);
                }
                currentList = null;

            } else if (item.type === 'listItem') {
                if (!currentList) {
                    currentList = document.createElement('ul');
                    currentList.className = "space-y-2 mb-4 pl-1";
                    if (currentSectionCard) {
                        currentSectionCard.appendChild(currentList);
                    } else {
                        container.appendChild(currentList);
                    }
                }

                const li = document.createElement('li');
                li.className = "flex items-start gap-2.5 text-xs sm:text-sm text-gray-600 dark:text-gray-300";
                const dot = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400 mt-2 flex-shrink-0"></span>`;
                
                if (item.boldPrefix) {
                    li.innerHTML = `${dot}<div><strong class="font-bold text-gray-900 dark:text-white">${item.boldPrefix}</strong> <span>${item.text}</span></div>`;
                } else {
                    li.innerHTML = `${dot}<span>${item.text}</span>`;
                }
                currentList.appendChild(li);
            }
        });

        // Render Table of Contents
        if (tocContainer && sectionsList.length > 0) {
            tocContainer.innerHTML = sectionsList.map(sec => `
                <a href="#${sec.id}" class="toc-link block px-2.5 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 transition-all truncate text-[11.5px]">
                    ${sec.text}
                </a>
            `).join('');

            setupTocObserver();
        }

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

function setupTocObserver() {
    const links = document.querySelectorAll('.toc-link');
    const sections = document.querySelectorAll('.termos-section-card');
    if (!sections.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const id = entry.target.id;
                links.forEach(link => {
                    const href = link.getAttribute('href');
                    if (href === `#${id}`) {
                        link.classList.add('bg-indigo-50', 'dark:bg-indigo-950/60', 'text-indigo-600', 'dark:text-indigo-400', 'font-bold');
                    } else {
                        link.classList.remove('bg-indigo-50', 'dark:bg-indigo-950/60', 'text-indigo-600', 'dark:text-indigo-400', 'font-bold');
                    }
                });
            }
        });
    }, { rootMargin: '-20% 0px -70% 0px' });

    sections.forEach(sec => observer.observe(sec));
}
