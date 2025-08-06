document.addEventListener('DOMContentLoaded', () => {
    // Objeto para manter referências aos elementos do DOM
    const elements = {
        cameraGrid: document.getElementById('camera-grid'),
        searchInput: document.getElementById('search-input'),
        statusFilters: document.getElementById('status-filters'),
        categoryFilters: document.getElementById('category-filters'),
        initialLoader: document.getElementById('initial-loader'),
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
        // NOVO: Referências para o toggle de categorias
        categoryToggleBtn: document.getElementById('category-toggle-btn'),
        categoryToggleIcon: document.getElementById('category-toggle-icon'),
        categoryFiltersContainer: document.getElementById('category-filters-container'),
    };

    // Objeto para manter o estado da aplicação
    let state = {
        allCameras: [],
        onlineCameras: [],
        favorites: JSON.parse(localStorage.getItem('favoriteCameras')) || [],
        filteredCameras: [],
        currentSearch: '',
        currentStatusFilter: 'online',
        currentCategoryFilter: 'all',
        updateInterval: 45 * 1000, // Intervalo fixo de 45 segundos
        modalUpdateInterval: null,
        currentModalIndex: -1,
        currentPage: 1,
        itemsPerPage: 20,
    };

    /**
     * Cria um elemento HTML para um único card de câmera.
     */
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
                <div class="aspect-video w-full bg-gray-200 dark:bg-gray-700 ${isOnline ? 'cursor-pointer' : ''}">
                    <img src="${imageUrl}" alt="Câmara ${camera.nome}" class="w-full h-full object-cover">
                </div>
                <div class="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button title="Favoritar" class="favorite-btn ${isFavorite ? 'is-favorite' : ''} bg-black/50 p-2 rounded-full text-white hover:bg-black/75">
                        <i data-lucide="star" class="w-5 h-5 pointer-events-none"></i>
                    </button>
                    <a href="/camera.html?code=${camera.codigo}" target="_blank" title="Abrir em nova aba" class="bg-black/50 p-2 rounded-full text-white hover:bg-black/75">
                        <i data-lucide="external-link" class="w-5 h-5 pointer-events-none"></i>
                    </a>
                </div>
            </div>
            <div class="p-3 flex-grow flex flex-col justify-center">
                <span class="font-semibold text-sm pr-2 truncate">${camera.nome}</span>
                <div class="flex justify-between items-center mt-2">
                     <span class="text-xs text-gray-500 dark:text-gray-400 truncate">${camera.categoria}</span>
                    <span class="status-badge px-2 py-0.5 text-xs font-medium rounded-full ${isOnline ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}">
                        ${isOnline ? 'Online' : 'Offline'}
                    </span>
                </div>
            </div>
        `;
        
        if (isOnline) card.querySelector('.aspect-video').addEventListener('click', () => openModal(camera.codigo));
        
        card.querySelector('.favorite-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(camera.codigo, e.currentTarget);
        });

        return card;
    };

    /**
     * Alterna o status de favorito de uma câmera.
     */
    const toggleFavorite = (code, button) => {
        const index = state.favorites.indexOf(code);
        if (index > -1) state.favorites.splice(index, 1);
        else state.favorites.push(code);
        
        localStorage.setItem('favoriteCameras', JSON.stringify(state.favorites));
        button.classList.toggle('is-favorite');
        updateCounts();
        if (state.currentStatusFilter === 'favorites') applyFilters();
    };
    
    /**
     * Renderiza a página atual de câmeras.
     */
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
            pageItems.forEach(camera => elements.cameraGrid.appendChild(createCameraCard(camera)));
        }
        
        lucide.createIcons();
        renderPaginationControls();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    /**
     * Renderiza os controles de paginação.
     */
    const renderPaginationControls = () => {
        elements.paginationControls.innerHTML = '';
        const totalPages = Math.ceil(state.filteredCameras.length / state.itemsPerPage);

        if (totalPages <= 1) return;

        const createButton = (text, page, isDisabled = false, isActive = false) => {
            const button = document.createElement('button');
            button.innerHTML = text;
            button.disabled = isDisabled;
            button.className = `px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                isActive 
                ? 'bg-indigo-600 text-white cursor-default' 
                : 'bg-white dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
            } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`;
            if (!isDisabled && !isActive) {
                button.addEventListener('click', () => {
                    state.currentPage = page;
                    renderCurrentPage();
                });
            }
            return button;
        };

        elements.paginationControls.appendChild(createButton('Anterior', state.currentPage - 1, state.currentPage === 1));

        const pageRange = 2;
        let startPage = Math.max(1, state.currentPage - pageRange);
        let endPage = Math.min(totalPages, state.currentPage + pageRange);

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

        elements.paginationControls.appendChild(createButton('Próxima', state.currentPage + 1, state.currentPage === totalPages));
    };

    /**
     * Aplica os filtros atuais e reinicia a renderização da grade.
     */
    const applyFilters = () => {
        let filtered = state.allCameras;

        if (state.currentStatusFilter === 'favorites') {
            filtered = filtered.filter(cam => state.favorites.includes(cam.codigo));
        } else if (state.currentStatusFilter !== 'all') {
            filtered = filtered.filter(cam => cam.status === state.currentStatusFilter);
        }
        if(state.currentCategoryFilter !== 'all') {
            filtered = filtered.filter(cam => cam.categoria === state.currentCategoryFilter);
        }
        if (state.currentSearch) {
            filtered = filtered.filter(cam => cam.nome.toLowerCase().includes(state.currentSearch));
        }
        
        state.filteredCameras = filtered;
        state.currentPage = 1;
        renderCurrentPage();
    };

    /**
     * Atualiza inteligentemente os cards visíveis sem recriar tudo.
     */
    const updateVisibleCards = (newCameraData) => {
        const cameraMap = new Map(newCameraData.map(c => [c.codigo, c]));

        document.querySelectorAll('.camera-card').forEach(card => {
            const code = card.dataset.codigo;
            const newInfo = cameraMap.get(code);
            const oldStatus = card.dataset.status;

            if (!newInfo) return;

            const img = card.querySelector('img');
            const statusBadge = card.querySelector('.status-badge');
            
            if (newInfo.status !== oldStatus) {
                card.dataset.status = newInfo.status;
                if (newInfo.status === 'online') {
                    img.src = `/proxy/camera?code=${code}&t=${Date.now()}`;
                    statusBadge.textContent = 'Online';
                    statusBadge.className = 'status-badge px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
                } else {
                    img.src = `https://placehold.co/400x300/e0e0e0/757575?text=Offline`;
                    statusBadge.textContent = 'Offline';
                    statusBadge.className = 'status-badge px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
                }
            } 
            else if (newInfo.status === 'online') {
                img.src = `/proxy/camera?code=${code}&t=${Date.now()}`;
            }
        });
    };

    /**
     * Processa os dados recebidos do fetch.
     */
    const processDataUpdate = (data) => {
        const isInitialLoad = state.allCameras.length === 0;
        state.allCameras = data.allCameras;
        state.onlineCameras = data.onlineCameras;
        
        elements.initialLoader.classList.add('hidden');
        elements.cameraGrid.classList.remove('min-h-[500px]');

        updateCounts();
        updateCategoryFilters();

        if (isInitialLoad) {
            applyFilters();
        } else {
            updateVisibleCards(state.allCameras);
        }

        elements.lastUpdatedSpan.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
    };

    /**
     * Busca os status mais recentes das câmeras do servidor.
     */
    const fetchCameraStatus = async () => {
        try {
            const response = await fetch('/status-cameras');
            if (!response.ok) throw new Error('Network response was not ok');
            const cameras = await response.json();
            
            const data = {
                allCameras: cameras,
                onlineCameras: cameras.filter(c => c.status === 'online')
            };
            processDataUpdate(data);

        } catch (error) {
            console.error('Erro ao carregar status:', error);
            elements.initialLoader.innerHTML = '<p class="text-red-500">Falha ao carregar câmeras. Tentando novamente...</p>';
        }
    };
    
    /**
     * Atualiza as contagens de câmeras nos botões de filtro.
     */
    const updateCounts = () => {
        elements.countAll.textContent = state.allCameras.length;
        elements.countOnline.textContent = state.onlineCameras.length;
        elements.countOffline.textContent = state.allCameras.length - state.onlineCameras.length;
        elements.countFavorites.textContent = state.favorites.length;
    };

    /**
     * Cria e atualiza dinamicamente os botões de filtro de categoria.
     */
    const updateCategoryFilters = () => {
        const categories = [...new Set(state.allCameras.map(c => c.categoria))].filter(Boolean).sort();
        
        // Limpa os filtros existentes para evitar duplicatas
        elements.categoryFilters.innerHTML = '';

        // Adiciona o botão "Todas"
        const allButton = document.createElement('button');
        allButton.dataset.filterGroup = 'category';
        allButton.dataset.filter = 'all';
        allButton.className = 'filter-btn';
        allButton.textContent = 'Todas';
        if (state.currentCategoryFilter === 'all') {
            allButton.classList.add('active-filter');
        }
        elements.categoryFilters.appendChild(allButton);

        // Adiciona os botões de cada categoria
        categories.forEach(cat => {
            const count = state.allCameras.filter(c => c.categoria === cat).length;
            const button = document.createElement('button');
            button.dataset.filterGroup = 'category';
            button.dataset.filter = cat;
            button.className = 'filter-btn';
            button.textContent = `${cat} (${count})`;
            if (state.currentCategoryFilter === cat) {
                button.classList.add('active-filter');
            }
            elements.categoryFilters.appendChild(button);
        });
    };

    /**
     * Inicia todos os ouvintes de eventos para a página.
     */
    const initListeners = () => {
        elements.searchInput.addEventListener('input', e => {
            state.currentSearch = e.target.value.toLowerCase();
            applyFilters();
        });

        document.getElementById('filters-container').addEventListener('click', e => {
            const button = e.target.closest('.filter-btn');
            if (!button) return;

            const { filterGroup, filter } = button.dataset;
            if (filterGroup === 'status') state.currentStatusFilter = filter;
            if (filterGroup === 'category') state.currentCategoryFilter = filter;

            document.querySelectorAll(`.filter-btn[data-filter-group="${filterGroup}"]`).forEach(btn => btn.classList.remove('active-filter'));
            button.classList.add('active-filter');
            
            applyFilters();
        });

        elements.themeToggleButton.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });

        // NOVO: Listener para o botão de toggle de categorias
        elements.categoryToggleBtn.addEventListener('click', () => {
            elements.categoryFiltersContainer.classList.toggle('hidden');
            elements.categoryToggleIcon.classList.toggle('rotate-180');
        });

        // Listeners do Modal
        elements.closeModalButton.addEventListener('click', closeModal);
        elements.modal.addEventListener('click', (e) => e.target === elements.modal && closeModal());
        elements.modalPrevButton.addEventListener('click', (e) => { e.stopPropagation(); navigateModal(-1); });
        elements.modalNextButton.addEventListener('click', (e) => { e.stopPropagation(); navigateModal(1); });
        document.addEventListener('keydown', (e) => {
            if (elements.modal.classList.contains('hidden')) return;
            if (e.key === 'Escape') closeModal();
            if (e.key === 'ArrowLeft') navigateModal(-1);
            if (e.key === 'ArrowRight') navigateModal(1);
        });
    };

    /**
     * Inicia a animação da barra de progresso.
     */
    const startUpdateIndicator = (duration) => {
        if (!elements.updateProgressBar) return;
        // Reseta a animação
        elements.updateProgressBar.style.transition = 'none';
        elements.updateProgressBar.style.width = '0%';
        // Força o navegador a aplicar o reset antes de iniciar a nova animação
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                elements.updateProgressBar.style.transition = `width ${duration / 1000}s linear`;
                elements.updateProgressBar.style.width = '100%';
            });
        });
    };

    /**
     * Loop de sincronização com o servidor.
     */
    const syncLoop = async () => {
        try {
            // Inicia a barra de progresso para o próximo ciclo
            startUpdateIndicator(state.updateInterval);
            await fetchCameraStatus();
        } catch (error) {
            console.error("Erro no loop de sincronização:", error);
        } finally {
            // Agenda a próxima execução
            setTimeout(syncLoop, state.updateInterval);
        }
    };

    /**
     * Função principal de inicialização da aplicação.
     */
    const init = () => {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
        }
        lucide.createIcons();
        initListeners();
        
        // Inicia o loop de sincronização
        syncLoop();
    };

    // Funções do Modal (sem alterações)
    const openModal = (code) => {
        state.currentModalIndex = state.onlineCameras.findIndex(c => c.codigo === code);
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
        if (state.currentModalIndex < 0 || state.currentModalIndex >= state.onlineCameras.length) return;
        const camera = state.onlineCameras[state.currentModalIndex];
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
    };
    
    const navigateModal = (direction) => {
        const total = state.onlineCameras.length;
        if (total === 0) return;
        state.currentModalIndex = (state.currentModalIndex + direction + total) % total;
        updateModalContent();
    };

    // Inicia a aplicação
    init();
});
