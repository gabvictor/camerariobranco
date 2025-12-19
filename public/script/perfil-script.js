import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ADMIN_EMAIL = "vgabvictor@gmail.com";
let currentUser = null;

// Initialize Icons
if (window.lucide) window.lucide.createIcons();

// Theme Logic
const themeToggleBtn = document.getElementById('theme-toggle-switch');
const themeThumb = document.getElementById('theme-toggle-thumb');

const updateThemeUI = (isDark) => {
    if (isDark) {
        themeToggleBtn.classList.remove('bg-gray-200');
        themeToggleBtn.classList.add('bg-indigo-600');
        themeThumb.classList.remove('translate-x-1');
        themeThumb.classList.add('translate-x-6');
    } else {
        themeToggleBtn.classList.add('bg-gray-200');
        themeToggleBtn.classList.remove('bg-indigo-600');
        themeThumb.classList.add('translate-x-1');
        themeThumb.classList.remove('translate-x-6');
    }
};

const initTheme = () => {
    const isDark = document.documentElement.classList.contains('dark');
    updateThemeUI(isDark);
};

themeToggleBtn.addEventListener('click', () => {
    if (window.toggleTheme) {
        const newTheme = window.toggleTheme();
        updateThemeUI(newTheme === 'dark');
    }
});

// Auth & Favorites Logic
const favoritesList = document.getElementById('favorites-list');
const adminSection = document.getElementById('admin-section');
const adminLinkFooter = document.getElementById('admin-link');
const logoutBtn = document.getElementById('logout-btn');
const loginLink = document.getElementById('login-link');

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        logoutBtn.classList.remove('hidden');
        loginLink.classList.add('hidden');
        
        if (user.email === ADMIN_EMAIL) {
            if (adminSection) adminSection.classList.remove('hidden');
            if (adminLinkFooter) adminLinkFooter.classList.remove('hidden');
        }
        loadFavorites();
    } else {
        logoutBtn.classList.add('hidden');
        loginLink.classList.remove('hidden');
        if (adminSection) adminSection.classList.add('hidden');
        if (adminLinkFooter) adminLinkFooter.classList.add('hidden');
        favoritesList.innerHTML = '<div class="p-8 text-center text-gray-500">Faça login para ver seus favoritos.</div>';
    }
});

logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.reload();
    });
});

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
                <div class="p-8 text-center text-gray-500">
                    <i data-lucide="star-off" class="w-12 h-12 mx-auto mb-3 text-gray-300"></i>
                    <p>Você ainda não tem câmeras favoritas.</p>
                    <a href="/" class="text-indigo-600 hover:underline text-sm mt-2 block">Explorar câmeras</a>
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
            item.className = 'p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors';
            item.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="relative w-16 h-10 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden flex-shrink-0">
                        <img src="${isOnline ? `/proxy/camera/${cam.codigo}` : '/assets/offline.png'}" 
                             class="w-full h-full object-cover" loading="lazy">
                    </div>
                    <div>
                        <h3 class="font-medium text-sm">${cam.nome}</h3>
                        <p class="text-xs text-gray-500 dark:text-gray-400">${cam.categoria} • ${isOnline ? '<span class="text-green-600 font-medium">Online</span>' : '<span class="text-red-500">Offline</span>'}</p>
                    </div>
                </div>
                <button class="remove-fav-btn p-2 text-gray-400 hover:text-red-500 transition-colors" data-code="${cam.codigo}" title="Remover dos favoritos">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
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
        favoritesList.innerHTML = '<div class="p-4 text-center text-red-500">Erro ao carregar favoritos.</div>';
    }
};

const removeFavorite = async (code) => {
    if (!currentUser) return;

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

// Initialize
initTheme();
// loadFavorites call removed as it is called in auth state change
