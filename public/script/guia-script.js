import { initAuthModal, initGlobalAuthUI } from "./auth-modal.js";

// Cabeçalho das páginas de guias: login/perfil e tema, igual às demais páginas.
initAuthModal();
initGlobalAuthUI();

const themeToggleBtn = document.getElementById('toggle-theme');
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.toggleTheme) window.toggleTheme();
    });
}

if (window.lucide) window.lucide.createIcons();
