import { auth, db } from "./firebase-config.js";
import { fetchWeather } from "./weather.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initAuthModal, initGlobalAuthUI } from "./auth-modal.js";
import { initTour } from "./tour.js";

// Initialize Auth & Tour
initAuthModal();
initGlobalAuthUI();
initTour();

// ─── State ─────────────────────────────────────────────────────────────
const state = {
    map: null,
    markersCluster: null,
    allCameras: [],          // ONLY online cameras with valid coords
    filteredCameras: [],
    markersMap: new Map(),   // code -> { marker, camera }
    activeCategory: 'all',
    searchQuery: '',
    currentLayerMode: 'auto',
    activeTileLayer: null,
    activeReferenceLayer: null,
    favorites: [],
    currentUser: null,
    userLocationMarker: null,
    userLocationCircle: null,
    userLocationTimeout: null
};

// ─── 100% Free Tile Providers (NO API KEY REQUIRED / NO WATERMARKS / NO 403) ───
const TILES = {
    esriStreets: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        options: {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri'
        }
    },
    esriSatellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri'
        }
    }
};

// ─── Standardized Camera Colors (Indigo for all, Blue for Rio Acre) ──────
const STANDARD_CAMERA_COLOR = '#4f46e5'; // Indigo padronizado para câmeras urbanas
const RIO_CAMERA_COLOR = '#0284c7';      // Azul de destaque para o Rio Acre

function isRioCamera(cameraOrCategory, code = '') {
    if (typeof cameraOrCategory === 'object' && cameraOrCategory !== null) {
        const cat = String(cameraOrCategory.categoria || '').toLowerCase();
        const name = String(cameraOrCategory.nome || '').toLowerCase();
        const desc = String(cameraOrCategory.descricao || '').toLowerCase();
        const camCode = String(cameraOrCategory.codigo || '');
        return cat.includes('rio') || cat.includes('fluvial') || 
               name.includes('rio acre') || name.includes('de olho no rio') || 
               desc.includes('rio acre') || 
               ['001426', '001334'].includes(camCode);
    }
    const str = String(cameraOrCategory || '').toLowerCase();
    const c = String(code || '');
    return str.includes('rio') || str.includes('fluvial') || ['001426', '001334'].includes(c);
}

function getCategoryColor(category, cameraCode = '') {
    if (isRioCamera(category, cameraCode)) {
        return RIO_CAMERA_COLOR;
    }
    return STANDARD_CAMERA_COLOR;
}

// ─── Helpers: Coordinates ───────────────────────────────────────────────
function parseCoords(coords) {
    if (!coords) return null;
    if (Array.isArray(coords) && coords.length === 2) {
        const lat = parseFloat(coords[0]);
        const lon = parseFloat(coords[1]);
        if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            return [lat, lon];
        }
    }
    if (typeof coords === 'string' && coords.includes(',')) {
        const parts = coords.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            return parts;
        }
    }
    return null;
}

// ─── Toast Notifications ────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bgColors = {
        success: 'bg-emerald-600 text-white',
        error: 'bg-red-600 text-white',
        info: 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
    };
    const icons = {
        success: '<i data-lucide="check-circle" class="w-4 h-4"></i>',
        error: '<i data-lucide="alert-circle" class="w-4 h-4"></i>',
        info: '<i data-lucide="info" class="w-4 h-4"></i>'
    };

    toast.className = `pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-xl text-xs sm:text-sm font-semibold transition-all duration-300 transform translate-y-2 opacity-0 ${bgColors[type] || bgColors.info}`;
    toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
    
    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
        toast.classList.add('opacity-0', '-translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ─── Favorites Handling ─────────────────────────────────────────────────
async function loadFavorites() {
    try {
        if (state.currentUser) {
            const userRef = doc(db, "users", state.currentUser.uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const data = userSnap.data();
                state.favorites = data.favoriteCameras || data.favorites || [];
                return;
            }
        }
        // Fallback local storage
        const localFavs = localStorage.getItem('camrb_favorites');
        state.favorites = localFavs ? JSON.parse(localFavs) : [];
    } catch (e) {
        console.warn('Erro ao carregar favoritos:', e);
        state.favorites = [];
    }
}

async function toggleFavorite(cameraCode) {
    const isFav = state.favorites.includes(cameraCode);
    if (isFav) {
        state.favorites = state.favorites.filter(c => c !== cameraCode);
        showToast('Câmera removida dos favoritos.', 'info');
    } else {
        state.favorites.push(cameraCode);
        showToast('Câmera salva nos favoritos!', 'success');
    }

    const isFavNow = state.favorites.includes(cameraCode);

    // 1. Update any favorite button currently inside an open popup in the DOM
    const popupFavBtn = document.getElementById(`popup-fav-btn-${cameraCode}`);
    if (popupFavBtn) {
        popupFavBtn.className = `popup-fav-btn p-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 ${isFavNow ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'} transition-all flex-shrink-0 cursor-pointer active:scale-90`;
        popupFavBtn.title = isFavNow ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
        popupFavBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${isFavNow ? '#f59e0b' : 'none'}" stroke="${isFavNow ? '#f59e0b' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
        `;
    }

    // 2. Update popup content for the marker instance
    const entry = state.markersMap.get(cameraCode);
    if (entry && entry.marker && entry.camera) {
        entry.marker.setPopupContent(buildPopupContent(entry.camera));
    }

    // 3. Save to LocalStorage
    localStorage.setItem('camrb_favorites', JSON.stringify(state.favorites));

    // 4. Save to Firestore if logged in
    if (state.currentUser) {
        try {
            const userRef = doc(db, "users", state.currentUser.uid);
            await setDoc(userRef, { favoriteCameras: state.favorites }, { merge: true });
        } catch (e) {
            console.error("Erro ao salvar favoritos no Firestore:", e);
        }
    }

    // 5. Update UI category filter pills count & drawer
    updateCategoryFiltersUI();
    if (state.activeCategory === 'favs') {
        applyFiltersAndSearch();
    }
    renderDrawerCameras();
}

window.toggleMapFavorite = function(code) {
    toggleFavorite(code);
};

window.copyMapCameraLink = function(code) {
    const url = `${window.location.origin}/mapa?code=${code}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Link do mapa copiado com sucesso!', 'success');
    }).catch(() => {
        showToast('Não foi possível copiar o link.', 'error');
    });
};

// ─── Marker Pin SVG Generator ───────────────────────────────────────────
function createPinIcon(color, isRio = false, isPulsing = false) {
    const pulseClass = (isPulsing || isRio) ? 'marker-target-pulse' : '';
    const glowFilter = isRio 
        ? 'filter: drop-shadow(0 0 10px rgba(2, 132, 199, 0.75)) drop-shadow(0 6px 14px rgba(0,0,0,0.4));' 
        : 'filter: drop-shadow(0 6px 12px rgba(0,0,0,0.35));';
    
    // Rio Acre icon glyph: river waves in blue, standard camera glyph for others
    const centerGlyph = isRio ? `
        <!-- River Waves Glyph in Azure Blue -->
        <path d="M12 15.5c1.8-1.5 3.5-1.5 5.3 0s3.5 1.5 5.3 0" stroke="${color}" stroke-width="2" stroke-linecap="round" fill="none"/>
        <path d="M12 19c1.8-1.5 3.5-1.5 5.3 0s3.5 1.5 5.3 0" stroke="${color}" stroke-width="2" stroke-linecap="round" fill="none"/>
        <circle cx="18" cy="11.5" r="2.2" fill="${color}"/>
    ` : `
        <!-- Standardized Camera Glyph -->
        <path d="M13 14h2l1-1.5h4l1 1.5h2c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H13c-.6 0-1-.4-1-1v-6c0-.6.4-1 1-1z" fill="${color}"/>
        <circle cx="18" cy="18" r="2.5" fill="white"/>
    `;

    const svg = `
        <div class="relative ${pulseClass} transition-transform hover:scale-115">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46" width="36" height="46" style="${glowFilter}">
                <!-- Pin Base -->
                <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 28 18 28s18-14.5 18-28C36 8.06 27.94 0 18 0z" fill="${color}"/>
                <!-- Inner Ring -->
                <circle cx="18" cy="18" r="14" fill="white" opacity="0.28"/>
                <!-- Center Core -->
                <circle cx="18" cy="18" r="11" fill="white"/>
                ${centerGlyph}
            </svg>
        </div>
    `;
    return L.divIcon({
        html: svg,
        className: 'custom-leaflet-icon' + (isRio ? ' river-camera-marker' : ''),
        iconSize: [36, 46],
        iconAnchor: [18, 46],
        popupAnchor: [0, -42]
    });
}

// ─── Build Rich Popup Content ────────────────────────────────────────────
function buildPopupContent(camera) {
    const isFav = state.favorites.includes(camera.codigo);
    const starFill = isFav ? '#f59e0b' : 'none';
    const starStroke = isFav ? '#f59e0b' : 'currentColor';
    const coords = parseCoords(camera.coords);
    const [lat, lon] = coords || [-9.9745, -67.8100];
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    const timestamp = Date.now();
    const isRio = isRioCamera(camera);

    const categoryBadgeHtml = isRio
        ? `<span class="map-popup-cat-badge mt-1 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/80 border border-sky-300/80 dark:border-sky-800 flex items-center gap-1 font-bold">🌊 Rio Acre</span>`
        : `<span class="map-popup-cat-badge mt-1">${camera.categoria || 'Geral'}</span>`;

    const rioDirectButtonHtml = isRio ? `
        <a href="/rio" class="col-span-2 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold text-xs shadow-md shadow-sky-600/25 transition-all active:scale-95" style="grid-column: span 2;" title="Ver cota em tempo real e telemetria oficial">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>
            <span>Nível & Telemetria do Rio</span>
        </a>
    ` : '';

    return `
        <div class="map-popup-wrapper">
            <!-- Thumbnail with Live Badge -->
            <div class="map-popup-thumb-container">
                <span class="map-popup-live-badge">
                    <span class="map-popup-live-dot"></span>
                    <span>Ao Vivo</span>
                </span>
                <img
                    class="map-popup-thumb"
                    src="/proxy/camera/${camera.codigo}?t=${timestamp}"
                    alt="${camera.nome}"
                    loading="lazy"
                    onerror="this.src='/assets/offline.png'"
                >
            </div>

            <!-- Body Details -->
            <div class="map-popup-body">
                <div class="map-popup-header">
                    <div class="min-w-0 pr-2">
                        <h4 class="map-popup-name truncate" title="${camera.nome}">${camera.nome}</h4>
                        ${categoryBadgeHtml}
                    </div>
                    <button 
                        id="popup-fav-btn-${camera.codigo}"
                        onclick="window.toggleMapFavorite('${camera.codigo}')" 
                        class="popup-fav-btn p-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 ${isFav ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'} transition-all flex-shrink-0 cursor-pointer active:scale-90"
                        title="${isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${starFill}" stroke="${starStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </button>
                </div>

                <!-- Action Buttons Grid -->
                <div class="map-popup-actions-grid">
                    ${rioDirectButtonHtml}
                    <a href="/camera/${camera.codigo}" class="map-popup-btn-primary">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                        <span>Assistir Transmissão</span>
                    </a>
                    <a href="/timelapses?code=${camera.codigo}" class="map-popup-btn-secondary" title="Ver timelapse 24h">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>Timelapse</span>
                    </a>
                    <a href="${mapsUrl}" target="_blank" rel="noopener" class="map-popup-btn-secondary" title="Como chegar no Google Maps">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                        <span>Como Chegar</span>
                    </a>
                </div>
            </div>
        </div>
    `;
}

// ─── Map Initialization ─────────────────────────────────────────────────
async function initializeMapLogic() {
    if (window.lucide) window.lucide.createIcons();

    const initialZoom = window.innerWidth < 768 ? 13 : 14;
    const initialCenter = [-9.9745, -67.8100]; // Rio Branco - Centro

    state.map = L.map('map', { 
        zoomControl: false,
        fadeAnimation: true
    }).setView(initialCenter, initialZoom);

    // Zoom control at bottom-left
    L.control.zoom({ position: 'bottomleft' }).addTo(state.map);

    // Apply default tile layer according to current dark mode
    updateMapTileLayer();

    // Setup Custom Marker Cluster
    state.markersCluster = L.markerClusterGroup({
        maxClusterRadius: 45,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            return L.divIcon({
                html: `<div class="custom-cluster-icon"><span>${count}</span></div>`,
                className: 'custom-cluster-marker',
                iconSize: [44, 44]
            });
        }
    });

    state.map.addLayer(state.markersCluster);

    // Setup Event Listeners for UI Controls
    setupEventListeners();

    // Fetch Cameras & Sponsors
    await loadFavorites();
    await fetchCamerasData();

    // Check if target code passed via URL
    const params = new URLSearchParams(window.location.search);
    const targetCode = params.get('code');
    if (targetCode) {
        focusCamera(targetCode);
    }
}

// ─── Map Tile Layer Updater (Zero Watermarks / No API Key) ───────────────
function updateMapTileLayer() {
    if (!state.map) return;

    if (state.activeTileLayer) {
        state.map.removeLayer(state.activeTileLayer);
        state.activeTileLayer = null;
    }

    const isDark = document.documentElement.classList.contains('dark');
    const mapEl = document.getElementById('map');
    
    let selectedTile = TILES.esriStreets;
    let shouldApplyDarkFilter = false;

    if (state.currentLayerMode === 'auto') {
        selectedTile = TILES.esriStreets;
        shouldApplyDarkFilter = isDark;
    } else if (state.currentLayerMode === 'dark') {
        selectedTile = TILES.esriStreets;
        shouldApplyDarkFilter = true;
    } else if (state.currentLayerMode === 'streets') {
        selectedTile = TILES.esriStreets;
        shouldApplyDarkFilter = false;
    } else if (state.currentLayerMode === 'satellite') {
        selectedTile = TILES.esriSatellite;
        shouldApplyDarkFilter = false;
    }

    if (mapEl) {
        if (shouldApplyDarkFilter) {
            mapEl.classList.add('dark-tiles-filter');
        } else {
            mapEl.classList.remove('dark-tiles-filter');
        }
    }

    state.activeTileLayer = L.tileLayer(selectedTile.url, selectedTile.options).addTo(state.map);
}

// ─── Fetch Cameras Data (STRICTLY ONLINE ONLY) ───────────────────────────
async function fetchCamerasData() {
    try {
        const response = await fetch('/status-cameras');
        if (!response.ok) throw new Error('Falha na resposta das câmeras');
        
        const cameras = await response.json();
        
        // STRICT FILTER: ONLY cameras with status === 'online' and valid coordinates
        state.allCameras = cameras.filter(cam => {
            const isOnline = cam.status === 'online';
            const parsedCoords = parseCoords(cam.coords);
            return isOnline && parsedCoords !== null;
        });

        // Set total live count
        const totalLive = state.allCameras.length;
        const countTextEl = document.getElementById('map-counter-text');
        if (countTextEl) countTextEl.textContent = `${totalLive} Ao Vivo`;

        const drawerCountEl = document.getElementById('drawer-count');
        if (drawerCountEl) drawerCountEl.textContent = `${totalLive}`;

        // Render dynamic category chips from real online cameras
        updateCategoryFiltersUI();

        // Render markers on map and drawer list
        applyFiltersAndSearch();
        renderDrawerCameras();

    } catch (error) {
        console.error("Erro ao carregar câmeras:", error);
        showToast("Não foi possível carregar as câmeras no mapa.", "error");
    }
}

// ─── Dynamic Category Filters UI ─────────────────────────────────────────
function updateCategoryFiltersUI() {
    const container = document.getElementById('map-category-pills');
    if (!container) return;

    const onlineCameras = state.allCameras;
    
    // Extract distinct categories from actual online cameras
    const categories = [...new Set(onlineCameras.map(c => (c.categoria || 'Geral').trim()))]
        .filter(c => c.length > 0)
        .sort();

    const totalCount = onlineCameras.length;
    const favCount = onlineCameras.filter(c => state.favorites.includes(c.codigo)).length;

    let html = `
        <button data-cat="all" class="cat-pill ${state.activeCategory === 'all' ? 'active px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-[11px] font-bold shadow-md shadow-indigo-600/30 border border-indigo-500' : 'px-3 py-1.5 rounded-xl bg-white/90 dark:bg-slate-900/90 hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200/80 dark:border-slate-700/80 text-[11px] font-semibold backdrop-blur-md shadow-2xs'} whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer">
            <i data-lucide="video" class="w-3 h-3"></i>
            <span>Todas (${totalCount})</span>
        </button>
    `;

    categories.forEach(cat => {
        const count = onlineCameras.filter(c => (c.categoria || 'Geral').trim() === cat).length;
        const isActive = state.activeCategory === cat;
        const catColor = getCategoryColor(cat);
        html += `
            <button data-cat="${cat}" class="cat-pill ${isActive ? 'active px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-[11px] font-bold shadow-md shadow-indigo-600/30 border border-indigo-500' : 'px-3 py-1.5 rounded-xl bg-white/90 dark:bg-slate-900/90 hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200/80 dark:border-slate-700/80 text-[11px] font-semibold backdrop-blur-md shadow-2xs'} whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer">
                <span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color: ${catColor}"></span>
                <span>${cat} (${count})</span>
            </button>
        `;
    });

    html += `
        <button data-cat="favs" class="cat-pill ${state.activeCategory === 'favs' ? 'active px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-[11px] font-bold shadow-md shadow-indigo-600/30 border border-indigo-500' : 'px-3 py-1.5 rounded-xl bg-white/90 dark:bg-slate-900/90 hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200/80 dark:border-slate-700/80 text-[11px] font-semibold backdrop-blur-md shadow-2xs'} whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer">
            <i data-lucide="star" class="w-3 h-3 text-amber-400 fill-amber-400"></i>
            <span>Favoritas (${favCount})</span>
        </button>
    `;

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
}

// ─── Filter & Search Engine ─────────────────────────────────────────────
function applyFiltersAndSearch() {
    if (!state.map || !state.markersCluster) return;

    state.markersCluster.clearLayers();
    state.markersMap.clear();

    const query = state.searchQuery.trim().toLowerCase();

    state.filteredCameras = state.allCameras.filter(cam => {
        // Strict online check
        if (cam.status !== 'online') return false;

        // Exact Category Filter
        let matchesCat = true;
        if (state.activeCategory === 'favs') {
            matchesCat = state.favorites.includes(cam.codigo);
        } else if (state.activeCategory !== 'all') {
            matchesCat = (cam.categoria || 'Geral').trim() === state.activeCategory;
        }

        // Search Query Filter
        let matchesQuery = true;
        if (query) {
            const name = (cam.nome || '').toLowerCase();
            const desc = (cam.descricao || '').toLowerCase();
            const cat = (cam.categoria || '').toLowerCase();
            const code = (cam.codigo || '').toLowerCase();
            matchesQuery = name.includes(query) || desc.includes(query) || cat.includes(query) || code.includes(query);
        }

        return matchesCat && matchesQuery;
    });

    // Add markers for filtered cameras
    state.filteredCameras.forEach(cam => {
        const coords = parseCoords(cam.coords);
        if (!coords) return;

        const isRio = isRioCamera(cam);
        const color = isRio ? RIO_CAMERA_COLOR : STANDARD_CAMERA_COLOR;
        const icon = createPinIcon(color, isRio);
        const marker = L.marker(coords, { 
            icon: icon, 
            title: cam.nome,
            zIndexOffset: isRio ? 1000 : 0
        });

        const popupContent = buildPopupContent(cam);
        marker.bindPopup(popupContent, {
            maxWidth: 290,
            minWidth: 290,
            className: 'camrb-custom-popup'
        });

        marker.on('popupopen', () => {
            marker.setPopupContent(buildPopupContent(cam));
            if (window.lucide) window.lucide.createIcons();
        });

        state.markersCluster.addLayer(marker);
        state.markersMap.set(cam.codigo, { marker, camera: cam });
    });

    renderSearchResults();
}

// ─── Search Autocomplete Dropdown ───────────────────────────────────────
function renderSearchResults() {
    const resultsContainer = document.getElementById('map-search-results');
    const query = state.searchQuery.trim().toLowerCase();

    if (!resultsContainer) return;

    if (!query || state.filteredCameras.length === 0) {
        resultsContainer.classList.add('hidden');
        resultsContainer.innerHTML = '';
        return;
    }

    resultsContainer.classList.remove('hidden');
    resultsContainer.innerHTML = state.filteredCameras.slice(0, 6).map(cam => {
        const isRio = isRioCamera(cam);
        const color = isRio ? RIO_CAMERA_COLOR : STANDARD_CAMERA_COLOR;
        const catLabel = isRio ? '🌊 Rio Acre' : (cam.categoria || 'Geral');
        const catClass = isRio ? 'text-sky-600 dark:text-sky-400 font-bold' : 'text-gray-500 dark:text-slate-400';
        return `
            <div 
                class="search-item flex items-center gap-2.5 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                onclick="window.selectSearchCamera('${cam.codigo}')"
            >
                <div class="w-10 h-10 rounded-lg bg-gray-200 dark:bg-slate-800 overflow-hidden flex-shrink-0 relative">
                    <img 
                        src="/proxy/camera/${cam.codigo}?t=${Date.now()}" 
                        alt="${cam.nome}"
                        class="w-full h-full object-cover"
                        onerror="this.src='/assets/offline.png'"
                    >
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-bold text-gray-900 dark:text-slate-100 truncate">${cam.nome}</p>
                    <p class="text-[10px] ${catClass} truncate">${catLabel}</p>
                </div>
                <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${isRio ? 'shadow-sm shadow-sky-500' : ''}" style="background-color: ${color}"></span>
            </div>
        `;
    }).join('');
}

window.selectSearchCamera = function(code) {
    focusCamera(code);
    const resultsContainer = document.getElementById('map-search-results');
    if (resultsContainer) resultsContainer.classList.add('hidden');
};

// ─── Camera Drawer Rendering ────────────────────────────────────────────
function renderDrawerCameras() {
    const container = document.getElementById('drawer-cameras-list');
    const sortSelect = document.getElementById('drawer-sort-select');
    const drawerSearch = document.getElementById('drawer-search-input');

    if (!container) return;

    const drawerQuery = (drawerSearch?.value || '').trim().toLowerCase();
    const sortBy = sortSelect?.value || 'name';

    // Only online cameras
    let list = [...state.allCameras];

    if (drawerQuery) {
        list = list.filter(c => 
            (c.nome || '').toLowerCase().includes(drawerQuery) ||
            (c.categoria || '').toLowerCase().includes(drawerQuery)
        );
    }

    if (sortBy === 'name') {
        list.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    } else if (sortBy === 'category') {
        list.sort((a, b) => (a.categoria || '').localeCompare(b.categoria || ''));
    }

    if (list.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 text-gray-400 dark:text-slate-500">
                <i data-lucide="video-off" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                <p class="text-xs font-medium">Nenhuma câmera encontrada</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    container.innerHTML = list.map(cam => {
        const isFav = state.favorites.includes(cam.codigo);
        const starFill = isFav ? '#f59e0b' : 'none';
        const starStroke = isFav ? '#f59e0b' : 'currentColor';
        const isRio = isRioCamera(cam);
        const catLabel = isRio ? '🌊 Rio Acre' : (cam.categoria || 'Geral');
        const catClass = isRio ? 'text-sky-600 dark:text-sky-400 font-bold' : 'text-gray-500 dark:text-slate-400';

        return `
            <div class="p-2.5 rounded-2xl bg-gray-50 dark:bg-slate-900/90 border ${isRio ? 'border-sky-300 dark:border-sky-800 shadow-xs' : 'border-gray-200/80 dark:border-slate-800'} hover:border-indigo-500/50 hover:dark:border-indigo-500/50 hover:dark:bg-slate-800/80 transition-all flex flex-col gap-2">
                <div class="flex items-center gap-2.5">
                    <div class="w-12 h-12 rounded-xl bg-gray-200 dark:bg-slate-800 overflow-hidden flex-shrink-0 relative">
                        <img 
                            src="/proxy/camera/${cam.codigo}?t=${Date.now()}" 
                            alt="${cam.nome}"
                            class="w-full h-full object-cover"
                            onerror="this.src='/assets/offline.png'"
                        >
                        <span class="absolute bottom-1 right-1 w-2 h-2 rounded-full ${isRio ? 'bg-sky-500 shadow-xs' : 'bg-emerald-500'} border border-white dark:border-slate-900"></span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <h4 class="text-xs font-bold text-gray-900 dark:text-slate-100 truncate">${cam.nome}</h4>
                        <span class="text-[10px] font-semibold ${catClass}">${catLabel}</span>
                    </div>
                    <button 
                        id="drawer-fav-btn-${cam.codigo}"
                        onclick="window.toggleMapFavorite('${cam.codigo}')" 
                        class="p-1.5 rounded-lg ${isFav ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'} transition-all cursor-pointer active:scale-90"
                        title="${isFav ? 'Remover dos favoritos' : 'Favoritar'}"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${starFill}" stroke="${starStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </button>
                </div>

                <div class="grid ${isRio ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 pt-1 border-t border-gray-200/60 dark:border-slate-800">
                    <button 
                        onclick="window.focusCamera('${cam.codigo}', true)" 
                        class="px-2 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 hover:dark:bg-indigo-900/60 border border-transparent dark:border-indigo-800/40 font-bold text-[11px] transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                        <i data-lucide="map-pin" class="w-3 h-3"></i>
                        <span>No Mapa</span>
                    </button>
                    <a 
                        href="/camera/${cam.codigo}" 
                        class="px-2 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] transition-colors flex items-center justify-center gap-1 text-center shadow-xs"
                    >
                        <i data-lucide="play" class="w-3 h-3"></i>
                        <span>Ao Vivo</span>
                    </a>
                    ${isRio ? `
                        <a 
                            href="/rio" 
                            class="px-2 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px] transition-colors flex items-center justify-center gap-1 text-center shadow-xs"
                            title="Ver telemetria oficial do Rio"
                        >
                            <span>🌊 Nível</span>
                        </a>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
}

// ─── Camera Focus (Fly To & Open Popup) ──────────────────────────────────
window.focusCamera = function(code, closeDrawerOnMobile = false) {
    const entry = state.markersMap.get(code);
    if (!entry) {
        state.activeCategory = 'all';
        state.searchQuery = '';
        const searchInput = document.getElementById('map-search-input');
        if (searchInput) searchInput.value = '';
        updateCategoryFiltersUI();
        applyFiltersAndSearch();
    }

    const reEntry = state.markersMap.get(code);
    if (reEntry && state.map && state.markersCluster) {
        const { marker, camera } = reEntry;
        const coords = parseCoords(camera.coords);
        if (coords) {
            state.markersCluster.zoomToShowLayer(marker, () => {
                state.map.flyTo(coords, 17, { duration: 1.2 });
                setTimeout(() => marker.openPopup(), 400);
            });
        }
    }

    if (closeDrawerOnMobile && window.innerWidth < 768) {
        closeDrawer();
    }
};

// ─── Drawer UI Handlers ─────────────────────────────────────────────────
function openDrawer() {
    const drawer = document.getElementById('camera-drawer');
    const backdrop = document.getElementById('camera-drawer-backdrop');
    if (drawer) drawer.classList.remove('translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
    renderDrawerCameras();
}

function closeDrawer() {
    const drawer = document.getElementById('camera-drawer');
    const backdrop = document.getElementById('camera-drawer-backdrop');
    if (drawer) drawer.classList.add('translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
}

// ─── Setup Event Listeners ──────────────────────────────────────────────
function setupEventListeners() {
    // 1. Search Bar Input
    const searchInput = document.getElementById('map-search-input');
    const searchClear = document.getElementById('map-search-clear');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            if (searchClear) {
                if (state.searchQuery) searchClear.classList.remove('hidden');
                else searchClear.classList.add('hidden');
            }
            applyFiltersAndSearch();
        });
    }

    if (searchClear) {
        searchClear.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            state.searchQuery = '';
            searchClear.classList.add('hidden');
            applyFiltersAndSearch();
        });
    }

    // 2. Category Filter Pills Delegation
    const categoryPillsContainer = document.getElementById('map-category-pills');
    if (categoryPillsContainer) {
        categoryPillsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.cat-pill');
            if (!btn) return;
            state.activeCategory = btn.getAttribute('data-cat') || 'all';
            updateCategoryFiltersUI();
            applyFiltersAndSearch();
        });
    }

    // 3. Drawer Open / Close
    const openDrawerBtn = document.getElementById('btn-open-drawer');
    const closeDrawerBtn = document.getElementById('btn-close-drawer');
    const drawerBackdrop = document.getElementById('camera-drawer-backdrop');
    const drawerSearch = document.getElementById('drawer-search-input');
    const drawerSort = document.getElementById('drawer-sort-select');

    if (openDrawerBtn) openDrawerBtn.addEventListener('click', openDrawer);
    if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);
    if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

    if (drawerSearch) drawerSearch.addEventListener('input', renderDrawerCameras);
    if (drawerSort) drawerSort.addEventListener('change', renderDrawerCameras);

    // 4. Recenter Button
    const recenterBtn = document.getElementById('recenter-btn');
    if (recenterBtn) {
        recenterBtn.addEventListener('click', () => {
            if (state.map) {
                const initialZoom = window.innerWidth < 768 ? 13 : 14;
                state.map.flyTo([-9.9745, -67.8100], initialZoom, { duration: 1 });
            }
        });
    }

    // 5. Locate Me Logic
    const locateBtn = document.getElementById('locate-btn');
    if (locateBtn) {
        locateBtn.addEventListener('click', () => {
            if (state.userLocationTimeout) {
                clearTimeout(state.userLocationTimeout);
                state.userLocationTimeout = null;
            }
            showToast('Obtendo sua localização GPS...', 'info');
            state.map.locate({ setView: true, maxZoom: 16 });
        });

        state.map.on('locationfound', (e) => {
            if (state.userLocationMarker) state.map.removeLayer(state.userLocationMarker);
            if (state.userLocationCircle) state.map.removeLayer(state.userLocationCircle);

            const userIcon = L.divIcon({
                html: `
                    <div class="relative flex items-center justify-center">
                        <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-blue-400 opacity-75"></span>
                        <div class="w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-md"></div>
                    </div>
                `,
                className: 'user-location-pulse',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            state.userLocationMarker = L.marker(e.latlng, { icon: userIcon }).addTo(state.map)
                .bindPopup('<div class="p-2 font-bold text-xs text-center">📍 Sua Localização Atual</div>').openPopup();
            
            state.userLocationCircle = L.circle(e.latlng, e.accuracy, {
                color: '#3b82f6',
                fillColor: '#93c5fd',
                fillOpacity: 0.15,
                weight: 1.5
            }).addTo(state.map);

            showToast('Localização encontrada!', 'success');

            state.userLocationTimeout = setTimeout(() => {
                if (state.userLocationMarker) state.map.removeLayer(state.userLocationMarker);
                if (state.userLocationCircle) state.map.removeLayer(state.userLocationCircle);
            }, 60000);
        });

        state.map.on('locationerror', () => {
            showToast('Não foi possível obter sua localização. Verifique as permissões.', 'error');
        });
    }

    // 6. Layer Switcher Popover & Options
    const layerBtn = document.getElementById('layer-switcher-btn');
    const layerMenu = document.getElementById('layer-switcher-menu');

    if (layerBtn && layerMenu) {
        layerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            layerMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!layerMenu.contains(e.target) && e.target !== layerBtn) {
                layerMenu.classList.add('hidden');
            }
        });

        layerMenu.querySelectorAll('.layer-opt').forEach(opt => {
            opt.addEventListener('click', () => {
                const mode = opt.getAttribute('data-layer');
                state.currentLayerMode = mode;
                
                layerMenu.querySelectorAll('.layer-opt').forEach(o => {
                    o.classList.remove('active');
                    const check = o.querySelector('.layer-check');
                    if (check) check.classList.add('hidden');
                });
                opt.classList.add('active');
                const check = opt.querySelector('.layer-check');
                if (check) check.classList.remove('hidden');

                updateMapTileLayer();
                layerMenu.classList.add('hidden');
                showToast(`Camada alterada para: ${opt.innerText.trim()}`, 'info');
            });
        });
    }

    // 7. Auto sync theme toggle with Map Layer
    const themeBtn = document.getElementById('toggle-theme');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            setTimeout(() => {
                if (state.currentLayerMode === 'auto') {
                    updateMapTileLayer();
                }
            }, 50);
        });
    }

    // Close search dropdown on clicking outside
    document.addEventListener('click', (e) => {
        const searchContainer = document.getElementById('map-floating-panel');
        const resultsContainer = document.getElementById('map-search-results');
        if (searchContainer && !searchContainer.contains(e.target) && resultsContainer) {
            resultsContainer.classList.add('hidden');
        }
    });
}

// ─── Initialize Auth Listener ───────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    state.currentUser = user;
    const mapContainer = document.getElementById('map');
    if (mapContainer && !mapContainer._leaflet_id) {
        await initializeMapLogic();
    }
    fetchWeather();
});
