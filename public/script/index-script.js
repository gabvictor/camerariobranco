import { auth, db } from "./firebase-config.js";
import { fetchWeather } from "./weather.js";
import { initAuthModal, toggleLoginModal, initGlobalAuthUI } from "./auth-modal.js";
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Inicializa widget de clima imediatamente
fetchWeather();
initGlobalAuthUI();

// Check for login query param
const params = new URLSearchParams(window.location.search);
if (params.get('login') === 'true') {
    window.history.replaceState({}, document.title, "/");
    // Small delay to ensure modal logic is ready
    setTimeout(() => toggleLoginModal(true), 500);
}

const ADMIN_EMAIL = "vgabvictor@gmail.com";
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

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    
    // Always show content wrapper for both logged in and logged out users
    document.getElementById('content-wrapper').style.display = 'flex';
    
    // Inicia a verificação com um pequeno delay inicial
    setTimeout(() => initAdSense(), 200);
    
    // UI Elements for Login/Logout state
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    if (user) {
        document.getElementById('username-display').textContent = `, ${user.displayName || user.email}`;

        // Initialize logic after user is set, to load favorites
        if (!isAppInitialized) {
            initializeAppLogic();
            fetchWeather(); // Fetch weather data
            isAppInitialized = true;
        }
    } else {
        // Logged out state UI
        document.getElementById('username-display').textContent = '';
        
        // Initialize logic for visitors too
        if (!isAppInitialized) {
            initializeAppLogic();
            fetchWeather();
            isAppInitialized = true;
        }
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
        paginationControls: document.getElementById('pagination-controls'),
        updateProgressBar: document.getElementById('update-progress-bar'),
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
        updateInterval: 5 * 60 * 1000,
        modalUpdateInterval: null,
        currentModalIndex: -1,
        currentPage: 1,
        itemsPerPage: 18,
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
        card.className = `camera-card flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden transition-transform duration-300 transform md:hover:-translate-y-1`;
        card.dataset.codigo = camera.codigo;
        card.dataset.status = camera.status;
        const isOnline = camera.status === 'online';
        const isFavorite = state.favorites.includes(camera.codigo);
        const imageUrl = isOnline ? `/proxy/camera/${camera.codigo}` : `/assets/offline.png`;

        card.innerHTML = `
            <div class="relative group">
                <a href="/camera/${camera.codigo}" class="block aspect-video w-full bg-gray-200 dark:bg-gray-700 cursor-pointer" onclick="gtag('event', 'select_content', {'content_type': 'camera', 'item_id': '${camera.codigo}', 'item_name': '${camera.nome}'});">
                    <img src="${imageUrl}" alt="Câmera ${camera.nome}" class="w-full h-full object-cover" loading="lazy">
                </a>
                <div class="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button title="Favoritar" class="favorite-btn ${isFavorite ? 'is-favorite' : ''} bg-black/50 p-2 rounded-full text-white hover:bg-black/75" onclick="gtag('event', 'favorite_camera', {'event_category': 'engagement', 'event_label': '${camera.codigo}'});">
                        <i data-lucide="star" class="w-5 h-5 pointer-events-none"></i>
                    </button>
                </div>
            </div>
            <div class="p-3 flex-grow flex flex-col justify-center">
                <a href="/camera/${camera.codigo}" class="font-semibold text-sm pr-2 truncate hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" title="${camera.nome}" onclick="gtag('event', 'select_content', {'content_type': 'camera', 'item_id': '${camera.codigo}', 'item_name': '${camera.nome}'});">${camera.nome}</a>
                <div class="flex justify-between items-center mt-2">
                    <span class="text-xs text-gray-500 dark:text-gray-400 truncate" title="${camera.categoria}">${camera.categoria}</span>
                    <span class="status-badge px-2 py-0.5 text-xs font-medium rounded-full ${isOnline ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}">
                        ${isOnline ? 'Online' : 'Offline'}
                    </span>
                </div>
            </div>
        `;

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
            alert("Erro ao salvar favorito. Tente novamente.");

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
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
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

    const applyFilters = () => {
        let filtered = state.allCameras;

        // Simplified Status Filter
        if (state.currentStatusFilter === 'favorites') {
            filtered = filtered.filter(cam => state.favorites.includes(cam.codigo));
        } else if (state.currentStatusFilter === 'online') {
            filtered = filtered.filter(cam => cam.status === 'online');
        } else if (state.currentStatusFilter === 'offline') {
            filtered = filtered.filter(cam => cam.status !== 'online');
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

        state.filteredCameras = filtered;
        state.currentPage = 1;
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
                // console.log("No online cameras found, switching to 'all'");
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
        applyFilters();
        if (elements.lastUpdatedSpan) elements.lastUpdatedSpan.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
    };

    const fetchCameraStatus = async () => {
        try {
            // Show skeleton if grid is empty
            if (state.allCameras.length === 0 && elements.skeletonGrid) {
                elements.skeletonGrid.classList.remove('hidden');
                // Generate some skeleton items if empty
                if (elements.skeletonGrid.children.length === 0) {
                    elements.skeletonGrid.innerHTML = Array(10).fill(0).map(() => `
                        <div class="flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden animate-pulse">
                            <div class="aspect-video w-full bg-gray-200 dark:bg-gray-700"></div>
                            <div class="p-3 space-y-2">
                                <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                                <div class="flex justify-between">
                                    <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
                                    <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
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
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', e => {
                state.currentSearch = e.target.value;
                applyFilters();
            });
        }

        // Global Click Listener for Delegation
        document.addEventListener('click', e => {
            // Handle Category Filters
            const categoryBtn = e.target.closest('.filter-chip[data-filter-group="category"]');
            if (categoryBtn) {
                e.preventDefault();

                const { filter } = categoryBtn.dataset;
                state.currentCategoryFilter = filter;

                // Update UI
                const container = document.getElementById('category-filters');
                if (container) {
                    container.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active-chip'));
                    categoryBtn.classList.add('active-chip');
                }

                applyFilters();
                return;
            }

            // Handle Status Filters
            const statusBtn = e.target.closest('.filter-chip[data-filter-group="status"]');
            if (statusBtn) {
                e.preventDefault();

                const { filter } = statusBtn.dataset;
                state.currentStatusFilter = filter;

                // Update UI
                const container = document.getElementById('status-filters');
                if (container) {
                    container.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active-chip'));
                    statusBtn.classList.add('active-chip');
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

    const startUpdateIndicator = (duration) => {
        if (!elements.updateProgressBar) return;
        elements.updateProgressBar.style.transition = 'none';
        elements.updateProgressBar.style.width = '0%';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                elements.updateProgressBar.style.transition = `width ${duration / 1000}s linear`;
                elements.updateProgressBar.style.width = '100%';
            });
        });
    };

    const syncLoop = async () => {
        try {
            startUpdateIndicator(state.updateInterval);
            await fetchCameraStatus();
        } catch (error) {
            console.error("Sync loop error:", error);
        } finally {
            setTimeout(syncLoop, state.updateInterval);
        }
    };

    const init = () => {
        if (window.lucide) window.lucide.createIcons();
        initListeners();
        fetchFavorites();
        syncLoop();
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
            elements.modalCameraFeed.src = `/proxy/camera/${camera.codigo}?t=${Date.now()}`;
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


