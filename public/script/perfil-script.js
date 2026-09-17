import { auth, db } from "./firebase-config.js";
import { initAuthModal, toggleLoginModal, initGlobalAuthUI } from "./auth-modal.js";
import { initFooter } from "./footer-component.js";
import { initTour } from "./tour.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

initGlobalAuthUI();
initAuthModal();
initFooter();
initTour();

let currentUser = null;

const initIcons = () => {
    if (window.lucide) window.lucide.createIcons();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIcons);
} else {
    initIcons();
}

const favoritesList = document.getElementById('favorites-list');
const userNameDisplay = document.getElementById('profile-display-name') || document.getElementById('user-name');
const userEmailDisplay = document.getElementById('profile-email') || document.getElementById('user-email');
const userRoleBadge = document.getElementById('profile-role-badge') || document.getElementById('user-role-badge');
const userInitials = document.getElementById('user-initials');
const userAvatarImg = document.getElementById('user-avatar-img');
const favCountBadge = document.getElementById('fav-count-badge');

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        const displayName = user.displayName || user.email.split('@')[0];
        if (userNameDisplay) userNameDisplay.textContent = displayName;
        if (userEmailDisplay) userEmailDisplay.textContent = user.email;
        if (userRoleBadge) {
            const isAdmin = user.email === 'gabvictor.gv@gmail.com';
            userRoleBadge.textContent = isAdmin ? 'Administrador' : 'Membro';
            if (isAdmin) {
                userRoleBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white';
            }
        }

        if (userAvatarImg && user.photoURL) {
            userAvatarImg.src = user.photoURL;
            userAvatarImg.classList.remove('hidden');
            if (userInitials) userInitials.classList.add('hidden');
        } else if (userInitials) {
            const initial = displayName.charAt(0).toUpperCase();
            userInitials.textContent = initial;
            userInitials.classList.remove('hidden');
            if (userAvatarImg) userAvatarImg.classList.add('hidden');
        }

        loadFavorites();
    } else {
        if (userNameDisplay) userNameDisplay.textContent = 'Visitante';
        if (userEmailDisplay) userEmailDisplay.textContent = 'Não autenticado';
        if (userInitials) {
            userInitials.textContent = '?';
            userInitials.classList.remove('hidden');
        }
        if (userAvatarImg) userAvatarImg.classList.add('hidden');

        if (favoritesList) {
            favoritesList.innerHTML = `
                <div class="p-10 text-center text-gray-500 dark:text-gray-400">
                    <div class="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto mb-3">
                        <i data-lucide="lock" class="w-6 h-6"></i>
                    </div>
                    <h3 class="text-base font-bold text-gray-900 dark:text-white mb-1">Acesso aos Favoritos</h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 max-w-xs mx-auto mb-4">Faça login com sua conta para salvar suas câmeras favoritas e acessar rapidamente.</p>
                    <button id="card-login-btn" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow transition-colors cursor-pointer">
                        Entrar na Conta
                    </button>
                </div>
            `;
            document.getElementById('card-login-btn')?.addEventListener('click', () => toggleLoginModal(true));
            initIcons();
        }
    }
});

// Event Listeners
document.getElementById('profile-login-btn')?.addEventListener('click', () => toggleLoginModal(true));
document.getElementById('nav-login-btn')?.addEventListener('click', () => toggleLoginModal(true));

const handleLogout = async () => {
    await signOut(auth);
    await fetch('/api/auth/session-logout', { method: 'POST' }).catch(() => {});
    localStorage.setItem('camrb_auth_cached', 'logged_out');
    window.location.reload();
};

document.getElementById('logout-btn-card')?.addEventListener('click', handleLogout);
document.getElementById('nav-logout-btn')?.addEventListener('click', handleLogout);

document.getElementById('theme-toggle-card')?.addEventListener('click', () => {
    if (window.toggleTheme) window.toggleTheme();
});

document.getElementById('toggle-theme')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.toggleTheme) window.toggleTheme();
});

const loadFavorites = async () => {
    if (!currentUser || !favoritesList) return;

    try {
        const userRef = doc(db, 'userData', currentUser.uid);
        const userDoc = await getDoc(userRef);
        let favorites = [];

        if (userDoc.exists()) {
            const data = userDoc.data();
            favorites = data.favoriteCameras || data.favorites || [];
        }

        if (favCountBadge) {
            favCountBadge.textContent = favorites.length;
        }

        if (favorites.length === 0) {
            favoritesList.innerHTML = `
                <div class="p-10 text-center text-gray-500 dark:text-gray-400">
                    <div class="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-500 flex items-center justify-center mx-auto mb-3">
                        <i data-lucide="star-off" class="w-6 h-6"></i>
                    </div>
                    <h3 class="text-base font-bold text-gray-900 dark:text-white mb-1">Nenhuma câmera favoritada</h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 max-w-xs mx-auto mb-4">Clique na estrelinha em qualquer câmera da página inicial para adicionar aos seus favoritos aqui.</p>
                    <a href="/" class="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl transition-colors">
                        <span>Explorar Câmeras</span>
                        <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                    </a>
                </div>
            `;
            initIcons();
            return;
        }

        const response = await fetch('/status-cameras');
        if (!response.ok) throw new Error('Falha ao carregar lista de status');
        const allCameras = await response.json();

        const favoriteCameras = allCameras.filter(cam => favorites.includes(cam.codigo));

        favoritesList.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
                ${favoriteCameras.map(cam => {
                    const isOnline = cam.status === 'online';
                    return `
                        <div id="fav-card-${cam.codigo}" onclick="if (!event.target.closest('.remove-fav-btn')) window.location.href='/camera/${cam.codigo}'" class="group relative bg-gray-50 dark:bg-gray-700/40 rounded-2xl p-3 border border-gray-100 dark:border-gray-700/60 hover:border-indigo-500 hover:shadow-md transition-all flex flex-col justify-between cursor-pointer">
                            <div class="relative aspect-video bg-black rounded-xl overflow-hidden mb-2.5">
                                <img src="/proxy/camera/${cam.codigo}" alt="${cam.nome}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onerror="this.src='/assets/offline.png'">
                                <div class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[10px] font-bold text-white flex items-center gap-1.5 ${isOnline ? 'bg-emerald-600/80 backdrop-blur-md' : 'bg-rose-600/80 backdrop-blur-md'}">
                                    <span class="w-1.5 h-1.5 rounded-full bg-white ${isOnline ? 'animate-pulse' : ''}"></span>
                                    <span>${isOnline ? 'Ao Vivo' : 'Offline'}</span>
                                </div>
                                <button class="remove-fav-btn absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-red-600 text-white transition-colors cursor-pointer z-10" data-code="${cam.codigo}" title="Remover dos favoritos">
                                    <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i>
                                </button>
                            </div>
                            <div>
                                <div class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">${cam.codigo}</div>
                                <h4 class="text-xs font-bold text-gray-900 dark:text-white line-clamp-1 mt-0.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">${cam.nome}</h4>
                                <p class="text-[11px] text-gray-400 truncate">${cam.bairro || cam.categoria || 'Rio Branco - AC'}</p>
                            </div>
                            <div class="mt-3 w-full py-1.5 bg-white dark:bg-gray-800 group-hover:bg-indigo-600 group-hover:text-white text-indigo-600 dark:text-indigo-300 rounded-xl text-xs font-bold transition-colors text-center border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-center gap-1">
                                <span>Ver Câmera</span>
                                <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        initIcons();

        document.querySelectorAll('.remove-fav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const code = e.currentTarget.dataset.code;
                removeFavorite(code);
            });
        });

    } catch (error) {
        console.error('Erro ao carregar favoritos:', error);
        favoritesList.innerHTML = `
            <div class="p-8 text-center text-red-500">
                <i data-lucide="alert-circle" class="w-8 h-8 mx-auto mb-2"></i>
                <p class="text-xs font-bold">Erro ao carregar câmeras favoritas.</p>
            </div>
        `;
        initIcons();
    }
};

// Toast Notification Helper
const showToast = (message, type = 'success', duration = 3200) => {
    if (window.showToast) {
        window.showToast(message, type, duration);
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
            showToast('Câmera removida dos favoritos.', 'info');
            
            // Smooth UI removal
            const card = document.getElementById(`fav-card-${code}`);
            if (card) {
                card.style.opacity = '0';
                card.style.transform = 'scale(0.95)';
                setTimeout(() => loadFavorites(), 250);
            } else {
                loadFavorites();
            }
        }
    } catch (error) {
        console.error("Erro ao remover favorito:", error);
        showToast("Erro ao remover favorito.", "error");
    }
};
