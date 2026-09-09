import { auth, db } from "./firebase-config.js";
import { fetchWeather } from "./weather.js";
import { initAuthModal, toggleLoginModal, initGlobalAuthUI, syncAdminSession } from "./auth-modal.js";
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initTour } from "./tour.js";

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
// Inicializa widget de clima imediatamente
fetchWeather();
initGlobalAuthUI();

// Track Visit (uma vez a cada 24h por visitante para economizar banco)
if (!document.cookie.includes('camrb_visited_today=1')) {
    fetch('/api/track-visit', { method: 'POST' })
        .catch(err => console.error('Error tracking visit:', err));
}

// Check for login query param
const params = new URLSearchParams(window.location.search);
const redirectParam = params.get('redirect');
if (params.get('login') === 'true') {
    // Small delay to ensure modal logic is ready
    setTimeout(() => {
        if (!currentUser) toggleLoginModal(true);
    }, 500);
}

let currentUser = null;
let isAppInitialized = false;

// Initialize AdSense only after content is visible to prevent "No slot size" error
const initAdSense = (attempts = 0) => {
    const adSlots = document.querySelectorAll('.adsbygoogle');
    if (adSlots.length === 0) return;

    // Check if any slot is visible
    let anyVisible = false;
    adSlots.forEach(slot => {
        if (slot.offsetWidth > 0 && slot.offsetParent !== null) {
            anyVisible = true;
        }
    });

    if (anyVisible) {
        try {
            // Initialize each uninitialized slot
            adSlots.forEach(slot => {
                if (!slot.getAttribute('data-adsbygoogle-status')) {
                    (window.adsbygoogle = window.adsbygoogle || []).push({});
                }
            });
        } catch (e) {
            console.error("AdSense error:", e);
        }
    } else {
        // Limit attempts
        if (attempts < 20) {
            setTimeout(() => initAdSense(attempts + 1), 500);
        } else {
            console.warn("AdSense: Timed out waiting for slot visibility.");
        }
    }
};

let globalFetchFavorites = null;

// Initialize app logic immediately without waiting for auth state
if (!isAppInitialized) {
    initializeAppLogic();
    fetchWeather();
    isAppInitialized = true;
}

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    
    if (user && redirectParam && redirectParam.startsWith('/')) {
        const isAdmin = await syncAdminSession(user);
        if (isAdmin) {
            window.history.replaceState({}, document.title, "/");
            window.location.replace(redirectParam);
            return;
        } else {
            window.history.replaceState({}, document.title, "/");
            console.warn("[AUTH] Usuário conectado não possui privilégios de administrador.");
        }
    }
    
    // Always show content wrapper for both logged in and logged out users
    const wrapper = document.getElementById('content-wrapper');
    if (wrapper) wrapper.style.display = 'flex';
    
    setTimeout(() => initAdSense(), 200);

    const userDisplay = document.getElementById('username-display');
    if (userDisplay) {
        userDisplay.textContent = user ? `, ${user.displayName || user.email}` : '';
    }

    if (globalFetchFavorites) {
        await globalFetchFavorites();
    }
});

function initializeAppLogic() {
    const elements = {
        cameraGrid: document.getElementById('camera-grid'),
        searchInput: document.getElementById('search-input'),
        skeletonGrid: document.getElementById('skeleton-grid'), // Replaced initialLoader
        noResults: document.getElementById('no-results'),
        countAll: document.getElementById('count-all'),
        countOnline: document.getElementById('count-online'),
        countOffline: document.getElementById('count-offline'),
        countFavorites: document.getElementById('count-favorites'),
        lastUpdatedSpan: document.getElementById('last-updated'),
        themeToggleButton: document.getElementById('toggle-theme'),
        modal: document.getElementById('camera-modal'),
        closeModalButton: document.getElementById('close-modal'),
        modalTitle: document.getElementById('modal-title'),
        modalCameraFeed: document.getElementById('modal-camera-feed'),
        modalLoader: document.getElementById('modal-loader'),
        modalPrevButton: document.getElementById('modal-prev'),
        modalNextButton: document.getElementById('modal-next'),
        embedButton: document.getElementById('embed-button'),
        paginationControls: document.getElementById('pagination-controls'),
        liveStatusText: document.getElementById('live-status-text'),
        liveCountdownText: document.getElementById('live-countdown-text'),
        refreshCamerasBtn: document.getElementById('refresh-cameras-btn'),
        refreshIcon: document.getElementById('refresh-icon'),
        categoryToggleBtn: document.getElementById('category-toggle-btn'),
        categoryToggleIcon: document.getElementById('category-toggle-icon'),
        categoryFiltersContainer: document.getElementById('category-filters-container'),
    };

    let state = {
        allCameras: [],
        favorites: [],
        filteredCameras: [],
        currentSearch: '',
        currentStatusFilter: 'online',
        currentCategoryFilter: 'all',
        sortBy: 'default', // 'default' or 'views'
        userLocation: null,
        updateInterval: 30 * 1000, // 30 seconds
        lastSnapshotTimestamp: Date.now(),
        modalUpdateInterval: null,
        currentModalIndex: -1,
        currentPage: 1,
        itemsPerPage: 18,
    };

    const deg2rad = (deg) => deg * (Math.PI / 180);

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // Radius of the earth in km
        const dLat = deg2rad(lat2 - lat1);
        const dLon = deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; // Distance in km
        return d;
    };

    const fetchFavorites = async () => {
        if (!currentUser) return;
        try {
            const userRef = doc(db, 'userData', currentUser.uid);
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
                const data = userDoc.data();
                state.favorites = data.favoriteCameras || data.favorites || [];
                updateCounts();
                // If cameras are already loaded, re-render to show stars
                if (state.allCameras.length > 0) {
                    renderCurrentPage();
                }
            }
        } catch (error) {
            console.error("Error fetching favorites:", error);
        }
    };

    const createCameraCard = (camera) => {
        const card = document.createElement('div');
        card.className = `camera-card group flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-md border border-gray-200 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-500 transition-all duration-200 overflow-hidden cursor-pointer`;
        card.dataset.codigo = camera.codigo;
        card.dataset.status = camera.status;
        const isOnline = camera.status === 'online';
        const isFavorite = state.favorites.includes(camera.codigo);
        const imageUrl = isOnline ? `/proxy/camera/${escapeHtml(camera.codigo)}?t=${state.lastSnapshotTimestamp || Date.now()}` : `/assets/offline.png`;

        let distanceBadge = '';
        if (camera.distance !== undefined) {
            distanceBadge = `<span class="px-2 py-0.5 text-[11px] font-semibold rounded bg-black/70 text-white flex items-center gap-1"><i data-lucide="map-pin" class="w-3 h-3 text-indigo-300"></i>${camera.distance.toFixed(1)} km</span>`;
        }

        let viewsBadge = '';
        if (camera.views > 0) {
             viewsBadge = `<span class="flex items-center text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded" title="${camera.views} visualizações"><i data-lucide="eye" class="w-3 h-3 mr-1 opacity-70"></i>${camera.views}</span>`;
        }

        card.innerHTML = `
            <div class="relative w-full aspect-video bg-gray-900 overflow-hidden">
                <div class="w-full h-full">
                    <img src="${imageUrl}" alt="Câmera ${escapeHtml(camera.nome)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out" loading="lazy" onerror="this.src='/assets/offline.png'">
                    <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
                    <!-- Hover: "Ver câmera" label -->
                    <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                        <span class="bg-white/90 dark:bg-gray-900/90 text-gray-900 dark:text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow flex items-center gap-1.5">
                            <i data-lucide="play" class="w-3.5 h-3.5 text-indigo-600"></i>
                            Ver câmera
                        </span>
                    </div>
                </div>
                
                <!-- Status & Distance Badges (Top Left) -->
                <div class="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none z-20 flex-wrap">
                    ${isOnline ? `
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded bg-black/75 text-emerald-400 border border-emerald-500/40 shadow-sm">
                            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            Ao Vivo
                        </span>
                    ` : `
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded bg-black/75 text-red-400 border border-red-500/40 shadow-sm">
                            <span class="w-2 h-2 rounded-full bg-red-400"></span>
                            Offline
                        </span>
                    `}
                    ${['001426', '001334'].includes(camera.codigo) ? `
                        <span class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-extrabold rounded bg-blue-900/80 text-cyan-300 border border-cyan-400/40 shadow-sm">
                            <i data-lucide="waves" class="w-3 h-3 text-cyan-300"></i>
                            Rio Acre
                        </span>
                    ` : ''}
                    ${distanceBadge}
                </div>

                <!-- Favorite Button (Top Right) -->
                <div class="absolute top-2 right-2 z-20">
                    <button title="${isFavorite ? 'Remover dos favoritos' : 'Favoritar câmera'}" class="favorite-btn ${isFavorite ? 'is-favorite' : ''} p-2.5 rounded-lg bg-black/60 hover:bg-black/80 text-white shadow transition-all active:scale-95 cursor-pointer" onclick="gtag('event', 'favorite_camera', {'event_category': 'engagement', 'event_label': '${escapeHtml(camera.codigo)}'});">
                        <i data-lucide="star" class="w-4 h-4 pointer-events-none ${isFavorite ? 'text-amber-400 fill-amber-400' : 'text-white'}"></i>
                    </button>
                </div>
            </div>

            <!-- Card Bottom Info -->
            <div class="p-3.5 flex-grow flex flex-col justify-between gap-2.5 bg-white dark:bg-gray-800">
                <span class="font-semibold text-gray-900 dark:text-white truncate text-base leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" title="${escapeHtml(camera.nome)}">
                    ${escapeHtml(camera.nome)}
                </span>
                <div class="flex justify-between items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700/60">
                    <span class="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/80 px-2 py-1 rounded truncate max-w-[140px]" title="${escapeHtml(camera.categoria)}">
                        ${escapeHtml(camera.categoria)}
                    </span>
                    <div class="flex items-center gap-1.5">
                        ${viewsBadge}
                        <span class="flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/30 group-hover:bg-indigo-600 group-hover:text-white dark:group-hover:bg-indigo-600 dark:group-hover:text-white text-indigo-600 dark:text-indigo-400 text-xs font-medium transition-colors" title="Abrir câmera">
                            <span class="hidden sm:inline">Ver</span>
                            <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
                        </span>
                    </div>
                </div>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.favorite-btn')) return;
            if (window.gtag) {
                gtag('event', 'select_content', {
                    'content_type': 'camera',
                    'item_id': camera.codigo,
                    'item_name': camera.nome
                });
            }
            if (e.ctrlKey || e.metaKey || e.button === 1) {
                window.open(`/camera/${encodeURIComponent(camera.codigo)}`, '_blank');
            } else {
                window.location.href = `/camera/${encodeURIComponent(camera.codigo)}`;
            }
        });

        card.querySelector('.favorite-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(camera.codigo, e.currentTarget);
        });

        return card;
    };

    const toggleFavorite = async (code, button) => {
        if (!currentUser) {
            toggleLoginModal(true);
            return;
        }

        const index = state.favorites.indexOf(code);
        const wasFavorite = index > -1;

        // Optimistic UI update
        if (wasFavorite) {
            state.favorites.splice(index, 1);
        } else {
            state.favorites.push(code);
        }

        button.classList.toggle('is-favorite');
        updateCounts();
        if (state.currentStatusFilter === 'favorites') applyFilters();

        try {
            const userRef = doc(db, 'userData', currentUser.uid);
            await setDoc(userRef, { favoriteCameras: state.favorites }, { merge: true });
        } catch (error) {
            console.error("Error updating favorites:", error);
            showToast("Erro ao salvar favorito. Tente novamente.", "error");

            // Revert changes
            if (wasFavorite) {
                state.favorites.push(code);
                button.classList.add('is-favorite');
            } else {
                const idx = state.favorites.indexOf(code);
                if (idx > -1) state.favorites.splice(idx, 1);
                button.classList.remove('is-favorite');
            }
            updateCounts();
            if (state.currentStatusFilter === 'favorites') applyFilters();
        }
    };

    const renderCurrentPage = () => {
        elements.cameraGrid.innerHTML = '';
        elements.noResults.classList.add('hidden');

        const start = (state.currentPage - 1) * state.itemsPerPage;
        const end = start + state.itemsPerPage;
        const pageItems = state.filteredCameras.slice(start, end);

        if (pageItems.length === 0 && state.filteredCameras.length > 0) {
            state.currentPage = 1;
            renderCurrentPage();
            return;
        }

        if (pageItems.length === 0) {
            elements.noResults.classList.remove('hidden');
        } else {
            const fragment = document.createDocumentFragment();
            pageItems.forEach((camera, index) => {
                fragment.appendChild(createCameraCard(camera));

                // INSERÇÃO DE ANÚNCIO NO GRID
                // Insere um card de anúncio a cada 8 câmeras (ajustável entre 5 e 10)
                if ((index + 1) % 8 === 0) {
                    const adCard = document.createElement('div');
                    adCard.className = "camera-card flex flex-col bg-gray-50 dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden border border-dashed border-gray-300 dark:border-gray-600 justify-center items-center max-h-[280px]";
                    adCard.innerHTML = `
                        <div class="text-center w-full h-full flex flex-col items-center justify-center relative overflow-hidden">
                            <div class="absolute top-0 left-0 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px] font-bold px-2 py-0.5 rounded-br-lg z-10">
                                PUBLICIDADE
                            </div>
                            <ins class="adsbygoogle" style="display:block; width: 100%; max-height: 280px;" 
                                data-ad-client="ca-pub-3587198600314787"
                                data-ad-slot="4407171290" 
                                data-ad-format="rectangle" 
                                data-full-width-responsive="false"></ins>
                        </div>
                    `;
                    fragment.appendChild(adCard);
                }
            });
            elements.cameraGrid.appendChild(fragment);
        }

        if (window.lucide) window.lucide.createIcons();
        renderPaginationControls();
        
        // Initialize new ads
        setTimeout(() => initAdSense(), 100);
    };

    const renderPaginationControls = () => {
        elements.paginationControls.innerHTML = '';
        const totalPages = Math.ceil(state.filteredCameras.length / state.itemsPerPage);

        if (totalPages <= 1) return;

        const createButton = (text, page, isDisabled = false, isActive = false) => {
            const button = document.createElement('button');
            button.innerHTML = text;
            button.disabled = isDisabled;
            button.className = `px-3 py-1 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white cursor-default' : 'bg-white dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`;

            if (!isDisabled && !isActive) {
                button.addEventListener('click', () => {
                    state.currentPage = page;
                    renderCurrentPage();
                    if (elements.cameraGrid) {
                        elements.cameraGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                });
            }
            return button;
        };

        elements.paginationControls.appendChild(createButton('&laquo;', state.currentPage - 1, state.currentPage === 1));

        let startPage = Math.max(1, state.currentPage - 1);
        let endPage = Math.min(totalPages, state.currentPage + 1);

        if (startPage > 1) {
            elements.paginationControls.appendChild(createButton('1', 1));
            if (startPage > 2) {
                elements.paginationControls.appendChild(createButton('...', -1, true));
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            elements.paginationControls.appendChild(createButton(i, i, false, i === state.currentPage));
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                elements.paginationControls.appendChild(createButton('...', -1, true));
            }
            elements.paginationControls.appendChild(createButton(totalPages, totalPages));
        }

        elements.paginationControls.appendChild(createButton('&raquo;', state.currentPage + 1, state.currentPage === totalPages));
    };

    const applyFilters = (resetPage = true) => {
        let filtered = [...state.allCameras]; // Create a copy to avoid mutating source

        // Simplified Status Filter
        if (state.currentStatusFilter === 'favorites') {
            filtered = filtered.filter(cam => state.favorites.includes(cam.codigo));
        } else if (state.currentStatusFilter === 'online') {
            filtered = filtered.filter(cam => cam.status === 'online');
        } else if (state.currentStatusFilter === 'offline') {
            filtered = filtered.filter(cam => cam.status !== 'online');
        } else if (state.currentStatusFilter === 'near_me' && state.userLocation) {
            filtered = filtered.filter(cam => cam.coords && Array.isArray(cam.coords) && cam.coords.length === 2 && cam.status === 'online');
            filtered = filtered.map(cam => {
                const dist = calculateDistance(
                    state.userLocation.lat, state.userLocation.lng,
                    cam.coords[0], cam.coords[1]
                );
                return { ...cam, distance: dist };
            });
            filtered.sort((a, b) => a.distance - b.distance);
        }

        // Category Filter
        if (state.currentCategoryFilter !== 'all') {
            filtered = filtered.filter(cam => (cam.categoria || '').trim() === state.currentCategoryFilter);
        }

        // Search Filter
        if (state.currentSearch) {
            const normalize = (str) => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            const searchTerm = normalize(state.currentSearch.trim());
            
            filtered = filtered.filter(cam =>
                normalize(cam.nome).includes(searchTerm) ||
                normalize(cam.codigo).includes(searchTerm) ||
                normalize(cam.categoria).includes(searchTerm)
            );
        }

        // Sort Filter (Mais Vistos)
        if (state.sortBy === 'views') {
            filtered.sort((a, b) => (b.views || 0) - (a.views || 0));
        }

        state.filteredCameras = filtered;
        if (resetPage) {
            state.currentPage = 1;
        } else {
            const totalPages = Math.ceil(state.filteredCameras.length / state.itemsPerPage) || 1;
            if (state.currentPage > totalPages) state.currentPage = totalPages;
        }
        renderCurrentPage();
    };

    const processDataUpdate = (data) => {
        state.allCameras = data;
        if (elements.skeletonGrid) elements.skeletonGrid.classList.add('hidden');
        elements.cameraGrid.classList.remove('min-h-[500px]');

        // Auto-switch to 'all' if no online cameras found
        if (state.currentStatusFilter === 'online') {
            const onlineCount = state.allCameras.filter(c => c.status === 'online').length;
            if (onlineCount === 0 && state.allCameras.length > 0) {
                state.currentStatusFilter = 'all';
                const allBtn = document.querySelector('[data-filter="all"]');
                if (allBtn) {
                    document.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active-chip'));
                    allBtn.classList.add('active-chip');
                }
            }
        }

        updateCounts();
        updateCategoryFilters();
        applyFilters(false);
        refreshCardImages();
        if (elements.lastUpdatedSpan) elements.lastUpdatedSpan.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
    };

    const refreshCardImages = () => {
        state.lastSnapshotTimestamp = Date.now();
        if (!elements.cameraGrid) return;
        const cards = elements.cameraGrid.querySelectorAll('.camera-card');
        cards.forEach(card => {
            const code = card.dataset.codigo;
            const isOnline = card.dataset.status === 'online';
            const img = card.querySelector('img');
            if (img && isOnline && code) {
                img.src = `/proxy/camera/${code}?t=${state.lastSnapshotTimestamp}`;
            }
        });
    };

    const fetchCameraStatus = async () => {
        try {
            // Show skeleton if grid is empty
            if (state.allCameras.length === 0 && elements.skeletonGrid) {
                elements.skeletonGrid.classList.remove('hidden');
                // Generate some skeleton items if empty
                if (elements.skeletonGrid.children.length === 0) {
                    elements.skeletonGrid.innerHTML = Array(10).fill(0).map(() => `
                        <div class="flex flex-col bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700/60 overflow-hidden animate-pulse-subtle">
                            <div class="aspect-video w-full bg-gray-200 dark:bg-gray-700/50 relative overflow-hidden"></div>
                            <div class="p-4 space-y-3 bg-white dark:bg-gray-800">
                                <div class="h-4 bg-gray-200 dark:bg-gray-700/70 rounded-md w-3/4"></div>
                                <div class="flex justify-between pt-1">
                                    <div class="h-3 bg-gray-200 dark:bg-gray-700/70 rounded-md w-1/3"></div>
                                    <div class="h-4 bg-gray-200 dark:bg-gray-700/70 rounded-md w-8"></div>
                                </div>
                            </div>
                        </div>
                     `).join('');
                }
            }

            const response = await fetch('/status-cameras');
            if (!response.ok) throw new Error('Network response was not ok');
            processDataUpdate(await response.json());
        } catch (error) {
            console.error('Error loading status:', error);
            // Don't break UI on error, just log it. Maybe show a toast in future.
        }
    };

    const updateCounts = () => {
        const onlineCount = state.allCameras.filter(c => c.status === 'online').length;
        if (elements.countAll) elements.countAll.textContent = state.allCameras.length;
        if (elements.countOnline) elements.countOnline.textContent = onlineCount;
        if (elements.countOffline) elements.countOffline.textContent = state.allCameras.length - onlineCount;
        if (elements.countFavorites) elements.countFavorites.textContent = state.favorites.length;
        // Update header status bar
        const headerOnline = document.getElementById('count-online-header');
        const headerAll = document.getElementById('count-all-header');
        if (headerOnline) headerOnline.textContent = onlineCount;
        if (headerAll) headerAll.textContent = state.allCameras.length;
    };

    const updateCategoryFilters = () => {
        // Filter only online cameras for category list
        const onlineCameras = state.allCameras.filter(c => c.status === 'online');

        // Normalize categories: trim whitespace and remove empty ones
        const categories = [...new Set(onlineCameras.map(c => (c.categoria || '').trim()))]
            .filter(c => c.length > 0)
            .sort();

        const categoryFilters = document.getElementById('category-filters');
        if (!categoryFilters) return;

        categoryFilters.innerHTML = '';

        const createFilterButton = (name, filter, count) => {
            const button = document.createElement('button');
            button.dataset.filterGroup = 'category';
            button.dataset.filter = filter;
            button.className = 'filter-chip';
            button.textContent = count ? `${name} (${count})` : name;

            if (state.currentCategoryFilter === filter) {
                button.classList.add('active-chip');
            }
            return button;
        };

        categoryFilters.appendChild(createFilterButton('Todas', 'all'));

        categories.forEach(cat => {
            // Count matches exactly the normalized category in online cameras
            const count = onlineCameras.filter(c => (c.categoria || '').trim() === cat).length;
            categoryFilters.appendChild(createFilterButton(cat, cat, count));
        });
    };

    const initListeners = () => {
        const searchClearBtn = document.getElementById('search-clear-btn');

        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', e => {
                state.currentSearch = e.target.value;
                if (searchClearBtn) {
                    if (e.target.value.length > 0) {
                        searchClearBtn.classList.remove('hidden');
                    } else {
                        searchClearBtn.classList.add('hidden');
                    }
                }
                applyFilters();
            });

            if (searchClearBtn) {
                searchClearBtn.addEventListener('click', () => {
                    elements.searchInput.value = '';
                    state.currentSearch = '';
                    searchClearBtn.classList.add('hidden');
                    elements.searchInput.focus();
                    applyFilters();
                });
            }
        }

        // Global Click Listener for Delegation
        document.addEventListener('click', e => {
            // Handle Category Filters
            const categoryBtn = e.target.closest('.filter-chip[data-filter-group="category"]');
            if (categoryBtn) {
                e.preventDefault();
                const { filter } = categoryBtn.dataset;

                // Toggle logic
                if (state.currentCategoryFilter === filter) {
                    state.currentCategoryFilter = 'all';
                } else {
                    state.currentCategoryFilter = filter;
                }

                // Update UI
                const container = document.getElementById('category-filters');
                if (container) {
                    container.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active-chip'));
                    if (state.currentCategoryFilter !== 'all') {
                        categoryBtn.classList.add('active-chip');
                    }
                }

                applyFilters();
                return;
            }

            // Handle Status Filters
            const statusBtn = e.target.closest('.filter-chip[data-filter-group="status"]');
            if (statusBtn) {
                e.preventDefault();
                const { filter } = statusBtn.dataset;

                // Handle "Near Me" specifically
                if (filter === 'near_me') {
                    if (!state.userLocation) {
                        if ("geolocation" in navigator) {
                            const originalText = statusBtn.innerHTML;
                            statusBtn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 mr-1.5 animate-spin"></i>Localizando...`;
                            if (window.lucide) window.lucide.createIcons();

                            navigator.geolocation.getCurrentPosition(
                                (position) => {
                                    state.userLocation = {
                                        lat: position.coords.latitude,
                                        lng: position.coords.longitude
                                    };
                                    // Success
                                    state.currentStatusFilter = filter;
                                    
                                    // Update UI
                                    const container = document.getElementById('status-filters');
                                    if (container) {
                                        container.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active-chip'));
                                        statusBtn.classList.add('active-chip');
                                    }
                                    
                                    applyFilters();
                                    statusBtn.innerHTML = originalText;
                                    if (window.lucide) window.lucide.createIcons();
                                },
                                (error) => {
                                    console.error("Error getting location:", error);
                                    showToast("Não foi possível obter sua localização.", "error");
                                    statusBtn.innerHTML = originalText;
                                    if (window.lucide) window.lucide.createIcons();
                                }
                            );
                            return;
                        } else {
                            showToast("Geolocalização não suportada.", "error");
                            return;
                        }
                    }
                }

                state.currentStatusFilter = filter;

                // Update UI
                const container = document.getElementById('status-filters');
                if (container) {
                    container.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active-chip'));
                    statusBtn.classList.add('active-chip');
                }

                applyFilters();
            }

            // Handle Sort Filters
            const sortBtn = e.target.closest('.filter-chip[data-filter-group="sort"]');
            if (sortBtn) {
                e.preventDefault();
                const { sort } = sortBtn.dataset;

                // Toggle sort
                if (state.sortBy === sort) {
                    state.sortBy = 'default';
                    sortBtn.classList.remove('active-chip');
                    sortBtn.classList.remove('bg-indigo-50', 'text-indigo-700', 'border-indigo-200'); // Remove active styles
                } else {
                    state.sortBy = sort;
                    sortBtn.classList.add('active-chip');
                    sortBtn.classList.add('bg-indigo-50', 'text-indigo-700', 'border-indigo-200'); // Add active styles
                }

                applyFilters();
            }
        });

        if (elements.themeToggleButton) {
            elements.themeToggleButton.addEventListener('click', () => {
                if (window.toggleTheme) window.toggleTheme();
            });
        }

        if (elements.logoutBtn) {
            elements.logoutBtn.addEventListener('click', async () => { 
                await signOut(auth); 
                window.location.reload();
            });
        }

        if (elements.categoryToggleBtn) {
            elements.categoryToggleBtn.addEventListener('click', () => {
                elements.categoryFiltersContainer.classList.toggle('hidden');
                elements.categoryToggleIcon.classList.toggle('rotate-180');
            });
        }

        const mobileSearchTrigger = document.getElementById('mobile-search-trigger');
        if (mobileSearchTrigger && elements.searchInput) {
            mobileSearchTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                elements.searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                elements.searchInput.focus();
            });
        }

        if (new URLSearchParams(window.location.search).has('busca') && elements.searchInput) {
            setTimeout(() => {
                elements.searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                elements.searchInput.focus();
            }, 300);
        }

        if (elements.refreshCamerasBtn) {
            elements.refreshCamerasBtn.addEventListener('click', (e) => {
                e.preventDefault();
                triggerManualRefresh();
            });
        }

        if (elements.closeModalButton) elements.closeModalButton.addEventListener('click', closeModal);
        if (elements.modal) elements.modal.addEventListener('click', (e) => e.target === elements.modal && closeModal());
        if (elements.modalPrevButton) elements.modalPrevButton.addEventListener('click', (e) => { e.stopPropagation(); navigateModal(-1); });
        if (elements.modalNextButton) elements.modalNextButton.addEventListener('click', (e) => { e.stopPropagation(); navigateModal(1); });

        document.addEventListener('keydown', (e) => {
            if (!elements.modal || elements.modal.classList.contains('hidden')) return;
            if (e.key === 'Escape') closeModal();
            if (e.key === 'ArrowLeft') navigateModal(-1);
            if (e.key === 'ArrowRight') navigateModal(1);
        });
    };

    let countdownRemaining = 60;
    let countdownIntervalId = null;
    let syncTimeoutId = null;
    let isFetchingStatus = false;

    const updateCountdownUI = () => {
        if (elements.liveCountdownText) {
            elements.liveCountdownText.textContent = `(${countdownRemaining}s)`;
        }
    };

    const resetCountdown = () => {
        countdownRemaining = Math.round(state.updateInterval / 1000);
        updateCountdownUI();
    };

    const startCountdownTimer = () => {
        if (countdownIntervalId) clearInterval(countdownIntervalId);
        resetCountdown();
        countdownIntervalId = setInterval(() => {
            if (countdownRemaining > 0) {
                countdownRemaining--;
                updateCountdownUI();
            }
        }, 1000);
    };

    const triggerManualRefresh = async () => {
        if (isFetchingStatus) return;
        isFetchingStatus = true;
        if (syncTimeoutId) clearTimeout(syncTimeoutId);

        if (elements.refreshIcon) elements.refreshIcon.classList.add('animate-spin');
        if (elements.liveStatusText) elements.liveStatusText.textContent = 'Atualizando...';

        try {
            await fetchCameraStatus();
            refreshCardImages();
            if (elements.liveStatusText) elements.liveStatusText.textContent = 'Atualizado!';
            setTimeout(() => {
                if (elements.liveStatusText) elements.liveStatusText.textContent = 'Ao Vivo';
            }, 1500);
        } catch (error) {
            console.error("Manual refresh error:", error);
            if (elements.liveStatusText) elements.liveStatusText.textContent = 'Ao Vivo';
        } finally {
            if (elements.refreshIcon) elements.refreshIcon.classList.remove('animate-spin');
            isFetchingStatus = false;
            resetCountdown();
            syncTimeoutId = setTimeout(syncLoop, state.updateInterval);
        }
    };

    const syncLoop = async () => {
        if (isFetchingStatus) return;
        try {
            isFetchingStatus = true;
            resetCountdown();
            if (elements.refreshIcon) elements.refreshIcon.classList.add('animate-spin');

            await fetchCameraStatus();
            refreshCardImages();

            if (elements.refreshIcon) elements.refreshIcon.classList.remove('animate-spin');
        } catch (error) {
            console.error("Sync loop error:", error);
            if (elements.refreshIcon) elements.refreshIcon.classList.remove('animate-spin');
        } finally {
            isFetchingStatus = false;
            syncTimeoutId = setTimeout(syncLoop, state.updateInterval);
        }
    };

    const init = () => {
        globalFetchFavorites = fetchFavorites;
        if (window.lucide) window.lucide.createIcons();
        initListeners();
        
        // Immediate 0ms render from SSR if available
        if (Array.isArray(window.INITIAL_CAMERAS) && window.INITIAL_CAMERAS.length > 0) {
            processDataUpdate(window.INITIAL_CAMERAS);
        }

        fetchFavorites();
        startCountdownTimer();
        syncLoop();
        initTour();
    };

    const getOnlineCamerasForModal = () => state.filteredCameras.filter(c => c.status === 'online');

    const openModal = (code) => {
        const onlineCameras = getOnlineCamerasForModal();
        state.currentModalIndex = onlineCameras.findIndex(c => c.codigo === code);
        if (state.currentModalIndex === -1) return;

        updateModalContent();
        elements.modal.classList.remove('hidden');
        setTimeout(() => {
            elements.modal.classList.add('opacity-100');
            elements.modal.querySelector('.transform').classList.remove('scale-95');
        }, 10);
        document.body.style.overflow = 'hidden';

        try {
            window.dispatchEvent(new CustomEvent('camrb-camera-modal-open'));
        } catch (e) {}
    };

    const closeModal = () => {
        clearInterval(state.modalUpdateInterval);
        elements.modal.classList.remove('opacity-100');
        elements.modal.querySelector('.transform').classList.add('scale-95');
        setTimeout(() => elements.modal.classList.add('hidden'), 300);
        document.body.style.overflow = '';
    };

    const updateModalContent = () => {
        const onlineCameras = getOnlineCamerasForModal();
        if (state.currentModalIndex < 0 || state.currentModalIndex >= onlineCameras.length) return;

        const camera = onlineCameras[state.currentModalIndex];
        elements.modalTitle.textContent = camera.nome;
        elements.modalLoader.classList.remove('hidden');
        elements.modalCameraFeed.style.visibility = 'hidden';

        const updateFeed = () => {
            elements.modalCameraFeed.src = `/proxy/camera/${escapeHtml(camera.codigo)}?t=${Date.now()}`;
        };

        elements.modalCameraFeed.onload = () => {
            elements.modalLoader.classList.add('hidden');
            elements.modalCameraFeed.style.visibility = 'visible';
        };

        clearInterval(state.modalUpdateInterval);
        updateFeed();
        state.modalUpdateInterval = setInterval(updateFeed, 1500);

        elements.modalPrevButton.disabled = onlineCameras.length <= 1;
        elements.modalNextButton.disabled = onlineCameras.length <= 1;

        if (elements.embedButton) {
            elements.embedButton.onclick = async () => {
                const iframeCode = `<iframe src="https://camerasriobranco.com.br/embed/${escapeHtml(camera.codigo)}" width="100%" height="450" frameborder="0" allowfullscreen></iframe>`;
                let copied = false;

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    try {
                        await navigator.clipboard.writeText(iframeCode);
                        copied = true;
                    } catch (err) {
                        copied = false;
                    }
                }

                if (!copied) {
                    try {
                        const textarea = document.createElement('textarea');
                        textarea.value = iframeCode;
                        textarea.style.position = 'fixed';
                        textarea.style.opacity = '0';
                        textarea.style.pointerEvents = 'none';
                        document.body.appendChild(textarea);
                        textarea.focus();
                        textarea.select();
                        copied = document.execCommand('copy');
                        document.body.removeChild(textarea);
                    } catch (err) {
                        copied = false;
                    }
                }

                if (copied) {
                    if (window.showToast) {
                        window.showToast('Código de incorporação copiado!', 'success');
                    }
                } else {
                    if (window.showToast) {
                        window.showToast('Não foi possível copiar o código. Copie manualmente.', 'error');
                    }
                }
            };
        }
    };

    const navigateModal = (direction) => {
        const onlineCameras = getOnlineCamerasForModal();
        const total = onlineCameras.length;
        if (total === 0) return;

        state.currentModalIndex = (state.currentModalIndex + direction + total) % total;
        updateModalContent();
    };

    init();
}

// --- Login Modal Logic ---
initAuthModal();

// Toast Notification System
window.showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg shadow-black/5 transform transition-all duration-300 translate-y-8 opacity-0 min-w-[300px] backdrop-blur-md border border-white/10 ${
        type === 'error' 
            ? 'bg-red-500/90 text-white' 
            : 'bg-gray-900/90 text-white dark:bg-white/90 dark:text-gray-900'
    }`;

    const icon = type === 'error' ? 'alert-circle' : 'check-circle-2';
    
    toast.innerHTML = `
        <i data-lucide="${icon}" class="w-5 h-5 flex-shrink-0"></i>
        <p class="text-sm font-medium">${message}</p>
    `;

    container.appendChild(toast);
    if(window.lucide) window.lucide.createIcons();

    // Animate In
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-8', 'opacity-0');
    });

    // Remove after delay
    setTimeout(() => {
        toast.classList.add('translate-y-4', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};
