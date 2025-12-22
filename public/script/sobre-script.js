import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initAuthModal, initGlobalAuthUI, toggleLoginModal } from "./auth-modal.js";

// Initialize Auth
initAuthModal();
initGlobalAuthUI();



// Initialize Icons
if (window.lucide) window.lucide.createIcons();

// Theme Toggle Logic
const themeToggleBtn = document.getElementById('toggle-theme');
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.toggleTheme) {
            window.toggleTheme();
        }
    });
}
