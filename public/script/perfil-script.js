import { auth, db } from "./firebase-config.js";
import { initAuthModal, toggleLoginModal, initGlobalAuthUI } from "./auth-modal.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Initialize global auth UI (handles admin-only, logged-in/out classes)
initGlobalAuthUI();

// Initialize Auth Modal
initAuthModal();

let currentUser = null;

// Initialize Icons
if (window.lucide) window.lucide.createIcons();

// Elements
const favoritesList = document.getElementById('favorites-list');
const userNameDisplay = document.getElementById('user-name');
const userEmailDisplay = document.getElementById('user-email');

// Auth State Listener for Page Specific Logic (User Data & Favorites)
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        // Update User Info
        if (userEmailDisplay) userEmailDisplay.textContent = user.email;
        if (userNameDisplay) userNameDisplay.textContent = user.displayName || user.email.split('@')[0];
        
        loadFavorites();
    } else {
        favoritesList.innerHTML = `
            <div class="p-12 text-center text-gray-500">
                <i data-lucide="lock" class="w-12 h-12 mx-auto mb-3 text-gray-300"></i>
                <p class="text-lg font-medium text-gray-900 dark:text-white mb-1">Acesso Restrito</p>
                <p>Faça login para ver suas câmeras favoritas.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
    }
});

// Event Listeners

// Profile Login Button (Visitor Card)
const profileLoginBtn = document.getElementById('profile-login-btn');
if (profileLoginBtn) {
    profileLoginBtn.addEventListener('click', () => toggleLoginModal(true));
}

// Sidebar Logout Button
const logoutBtnCard = document.getElementById('logout-btn-card');
if (logoutBtnCard) {
    logoutBtnCard.addEventListener('click', () => {
        signOut(auth).then(() => window.location.reload());
    });
}

// Theme Toggle (Card)
const themeToggleCard = document.getElementById('theme-toggle-card');
if (themeToggleCard) {
    themeToggleCard.addEventListener('click', () => {
        if (window.toggleTheme) window.toggleTheme();
    });
}

// Theme Toggle (Navbar) - Robust Initialization
const initThemeToggle = () => {
    const themeToggleBtn = document.getElementById('toggle-theme');
    if (themeToggleBtn) {
        // Remove any existing listeners by cloning (optional, but ensures clean state if run multiple times)
        // const newBtn = themeToggleBtn.cloneNode(true);
        // themeToggleBtn.parentNode.replaceChild(newBtn, themeToggleBtn);
        // But cloning destroys lucide icons inside if not careful. Let's just add listener.
        
        themeToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.toggleTheme) window.toggleTheme();
        });
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeToggle);
} else {
    initThemeToggle();
}


// Load Favorites
const loadFavorites = async () => {
    if (!currentUser) return;

    try {
        const userRef = doc(db, 'userData', currentUser.uid);
        const userDoc = await getDoc(userRef);
        let favorites = [];

        if (userDoc.exists()) {
            const data = userDoc.data();
            favorites = data.favoriteCameras || data.favorites || [];
        }
    
        if (favorites.length === 0) {
            favoritesList.innerHTML = `
                <div class="p-12 text-center text-gray-500">
                    <i data-lucide="star-off" class="w-12 h-12 mx-auto mb-3 text-gray-300"></i>
                    <p class="text-lg font-medium text-gray-900 dark:text-white mb-1">Nenhum favorito</p>
                    <p class="mb-4">Você ainda não favoritou nenhuma câmera.</p>
                    <a href="/" class="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium">
                        Explorar câmeras <i data-lucide="arrow-right" class="w-4 h-4"></i>
                    </a>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        // Fetch all cameras to match codes
        const response = await fetch('/status-cameras');
        if (!response.ok) throw new Error('Failed to load cameras');
        const allCameras = await response.json();
        
        const favoriteCameras = allCameras.filter(cam => favorites.includes(cam.codigo));
        
        favoritesList.innerHTML = '';
        favoriteCameras.forEach(cam => {
            const isOnline = cam.status === 'online';
            const item = document.createElement('div');
            item.className = 'p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group';
            item.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="relative w-20 h-12 bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200 dark:border-gray-700">
                        <img src="${isOnline ? `/proxy/camera/${cam.codigo}` : '/assets/offline.png'}" 
                             class="w-full h-full object-cover transition-transform group-hover:scale-110" loading="lazy">
                    </div>
                    <div>
                        <h3 class="font-medium text-gray-900 dark:text-white">${cam.nome}</h3>
                        <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>${cam.categoria}</span>
                            <span>•</span>
                            <span class="${isOnline ? 'text-green-600 dark:text-green-400' : 'text-red-500'} flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}"></span>
                                ${isOnline ? 'Online' : 'Offline'}
                            </span>
                        </div>
                    </div>
                </div>
                <button class="remove-fav-btn p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all" data-code="${cam.codigo}" title="Remover dos favoritos">
                    <i data-lucide="trash-2" class="w-5 h-5"></i>
                </button>
            `;
            favoritesList.appendChild(item);
        });

        // Add event listeners for remove buttons
        document.querySelectorAll('.remove-fav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const code = e.currentTarget.dataset.code;
                removeFavorite(code);
            });
        });

        if (window.lucide) window.lucide.createIcons();

    } catch (error) {
        console.error('Error loading favorites:', error);
        favoritesList.innerHTML = `
            <div class="p-8 text-center text-red-500">
                <i data-lucide="alert-circle" class="w-8 h-8 mx-auto mb-2"></i>
                <p>Erro ao carregar favoritos.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
    }
};

const removeFavorite = async (code) => {
    if (!currentUser) return;

    // Optimistic UI update could be added here, but for now we reload
    try {
        const userRef = doc(db, 'userData', currentUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            const data = userDoc.data();
            let favorites = data.favoriteCameras || data.favorites || [];
            favorites = favorites.filter(fav => fav !== code);
            
            await setDoc(userRef, { favoriteCameras: favorites }, { merge: true });
            loadFavorites(); // Reload list
        }
    } catch (error) {
        console.error("Erro ao remover favorito:", error);
        alert("Erro ao remover favorito.");
    }
};
