import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ADMIN_EMAIL = "vgabvictor@gmail.com";

onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('content-wrapper').style.display = 'block';
        document.getElementById('username-display').textContent = user.displayName || user.email;

        if (user.email === ADMIN_EMAIL) {
            const adminLink = document.getElementById('admin-link');
            if (adminLink) adminLink.style.display = 'inline-block';
            
            const dashboardLink = document.getElementById('dashboard-link');
            if (dashboardLink) dashboardLink.classList.remove('hidden');
        }

        initializeAppLogic();
    } else {
        window.location.href = '/login.html';
    }
});

function initializeAppLogic() {
    const elements = {
        cameraGrid: document.getElementById('camera-grid'),
        searchInput: document.getElementById('search-input'),
        initialLoader: document.getElementById('initial-loader'),
        noResults: document.getElementById('no-results'),
        countAll: document.getElementById('count-all'),
        countOnline: document.getElementById('count-online'),
        countOffline: document.getElementById('count-offline'),
        countFavorites: document.getElementById('count-favorites'),
        lastUpdatedSpan: document.getElementById('last-updated'),
        themeToggleButton: document.getElementById('toggle-theme'),
        logoutBtn: document.getElementById('logout-btn'),
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
        favorites: JSON.parse(localStorage.getItem('favoriteCameras')) || [],
        filteredCameras: [],
        currentSearch: '',
        currentStatusFilter: 'online',
        currentCategoryFilter: 'all',
        updateInterval: 5 * 60 * 1000,
        modalUpdateInterval: null,
        currentModalIndex: -1,
        currentPage: 1,
        itemsPerPage: 20,
    };

    const createCameraCard = (camera) => {
        const card = document.createElement('div');
        card.className = `camera-card flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden transition-transform duration-300 transform md:hover:-translate-y-1`;
        card.dataset.codigo = camera.codigo;
        card.dataset.status = camera.status;
        const isOnline = camera.status === 'online';
        const isFavorite = state.favorites.includes(camera.codigo);
        const imageUrl = isOnline ? `/proxy/camera?code=${camera.codigo}` : `https://placehold.co/400x300/e0e0e0/757575?text=Offline`;
        
        card.innerHTML = `
            <div class="relative group">
                <a href="/camera/${camera.codigo}" class="block aspect-video w-full bg-gray-200 dark:bg-gray-700 cursor-pointer">
                    <img src="${imageUrl}" alt="Câmara ${camera.nome}" class="w-full h-full object-cover" loading="lazy">
                </a>
                <div class="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button title="Favoritar" class="favorite-btn ${isFavorite ? 'is-favorite' : ''} bg-black/50 p-2 rounded-full text-white hover:bg-black/75">
                        <i data-lucide="star" class="w-5 h-5 pointer-events-none"></i>
                    </button>
                </div>
            </div>
            <div class="p-3 flex-grow flex flex-col justify-center">
                <a href="/camera/${camera.codigo}" class="font-semibold text-sm pr-2 truncate hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" title="${camera.nome}">${camera.nome}</a>
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

    const toggleFavorite = (code, button) => {
        const index = state.favorites.indexOf(code);
        if (index > -1) {
            state.favorites.splice(index, 1);
        } else {
            state.favorites.push(code);
        }
        localStorage.setItem('favoriteCameras', JSON.stringify(state.favorites));
        button.classList.toggle('is-favorite');
        updateCounts();
        if (state.currentStatusFilter === 'favorites') applyFilters();
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
            pageItems.forEach(camera => fragment.appendChild(createCameraCard(camera)));
            elements.cameraGrid.appendChild(fragment);
        }
        
        if (window.lucide) window.lucide.createIcons();
        renderPaginationControls();
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
        
        if (state.currentStatusFilter === 'favorites') {
            filtered = filtered.filter(cam => state.favorites.includes(cam.codigo));
        } else if (state.currentStatusFilter !== 'all') {
            filtered = filtered.filter(cam => cam.status === state.currentStatusFilter);
        }
        
        if (state.currentCategoryFilter !== 'all') {
            filtered = filtered.filter(cam => cam.categoria === state.currentCategoryFilter);
        }
        
        if (state.currentSearch) {
            const searchTerm = state.currentSearch.toLowerCase();
            filtered = filtered.filter(cam => cam.nome.toLowerCase().includes(searchTerm) || cam.codigo.includes(searchTerm));
        }
        
        state.filteredCameras = filtered;
        state.currentPage = 1;
        renderCurrentPage();
    };

    const processDataUpdate = (data) => {
        state.allCameras = data;
        elements.initialLoader.classList.add('hidden');
        elements.cameraGrid.classList.remove('min-h-[500px]');
        updateCounts();
        updateCategoryFilters();
        applyFilters();
        if (elements.lastUpdatedSpan) elements.lastUpdatedSpan.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
    };

    const fetchCameraStatus = async () => {
        try {
            const response = await fetch('/status-cameras');
            if (!response.ok) throw new Error('Network response was not ok');
            processDataUpdate(await response.json());
        } catch (error) {
            console.error('Error loading status:', error);
            elements.initialLoader.innerHTML = '<p class="text-red-500">Failed to load cameras. Retrying...</p>';
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
        const categories = [...new Set(state.allCameras.map(c => c.categoria))].filter(Boolean).sort();
        const categoryFilters = document.getElementById('category-filters');
        if (!categoryFilters) return;
        
        categoryFilters.innerHTML = '';
        
        const createFilterButton = (name, filter, count) => {
            const button = document.createElement('button');
            button.dataset.filterGroup = 'category';
            button.dataset.filter = filter;
            button.className = 'filter-btn';
            button.textContent = count ? `${name} (${count})` : name;
            
            if (state.currentCategoryFilter === filter) {
                button.classList.add('active-filter');
            }
            return button;
        };
        
        categoryFilters.appendChild(createFilterButton('Todas', 'all'));
        
        categories.forEach(cat => {
            const count = state.allCameras.filter(c => c.categoria === cat).length;
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
        
        const filtersContainer = document.getElementById('filters-container');
        if (filtersContainer) {
            filtersContainer.addEventListener('click', e => {
                const button = e.target.closest('.filter-btn');
                if (!button) return;
                
                const { filterGroup, filter } = button.dataset;
                if (filterGroup === 'status') state.currentStatusFilter = filter;
                if (filterGroup === 'category') state.currentCategoryFilter = filter;
                
                document.querySelectorAll(`.filter-btn[data-filter-group="${filterGroup}"]`).forEach(btn => btn.classList.remove('active-filter'));
                button.classList.add('active-filter');
                
                applyFilters();
            });
        }

        if (elements.themeToggleButton) {
            elements.themeToggleButton.addEventListener('click', () => {
                if (window.toggleTheme) window.toggleTheme();
            });
        }
        
        if (elements.logoutBtn) {
            elements.logoutBtn.addEventListener('click', () => { signOut(auth); });
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
            elements.modalCameraFeed.src = `/proxy/camera?code=${camera.codigo}&t=${Date.now()}`;
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
