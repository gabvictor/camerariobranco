import { initAuthModal, initGlobalAuthUI } from "./auth-modal.js";
import { initFooter } from "./footer-component.js";
import { initTour } from "./tour.js";

let currentFrames = [];
let currentIndex = 0;
let isPlaying = false;
let playInterval = null;
let playbackSpeed = 1; // 1x, 2x, 4x, 8x
let currentCameraCode = null;
let allAvailableCameras = [];

document.addEventListener('DOMContentLoaded', () => {
    initAuthModal();
    initGlobalAuthUI();
    initFooter();
    initTour();

    if (window.lucide) window.lucide.createIcons();

    // Theme Toggle
    const themeBtn = document.getElementById('toggle-theme');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            if (window.toggleTheme) window.toggleTheme();
        });
    }

    setupControls();
    setupSearchFilter();
    initTimelapseExperience();
});

function setupControls() {
    const btnPlay = document.getElementById('btn-play-pause');
    const btnPrev = document.getElementById('btn-prev-frame');
    const btnNext = document.getElementById('btn-next-frame');
    const slider = document.getElementById('timelapse-slider');
    const speedButtons = document.querySelectorAll('.speed-btn');

    if (btnPlay) btnPlay.addEventListener('click', togglePlay);
    
    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            pause();
            setFrameIndex(currentIndex - 1);
        });
    }

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            pause();
            setFrameIndex(currentIndex + 1);
        });
    }

    if (slider) {
        slider.addEventListener('input', (e) => {
            pause();
            setFrameIndex(parseInt(e.target.value, 10));
        });
    }

    speedButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            speedButtons.forEach(b => {
                b.className = 'speed-btn px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-indigo-600';
            });
            btn.className = 'speed-btn px-2.5 py-1 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30';
            playbackSpeed = parseInt(btn.getAttribute('data-speed'), 10) || 1;
            if (isPlaying) {
                restartPlayTimer();
            }
        });
    });
}

function setupSearchFilter() {
    const searchInput = document.getElementById('timelapse-search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            renderCamerasGrid(allAvailableCameras);
            return;
        }

        const filtered = allAvailableCameras.filter(c => 
            (c.nome && c.nome.toLowerCase().includes(query)) ||
            (c.codigo && c.codigo.toLowerCase().includes(query)) ||
            (c.localizacao && c.localizacao.toLowerCase().includes(query)) ||
            (c.bairro && c.bairro.toLowerCase().includes(query))
        );
        renderCamerasGrid(filtered);
    });
}

async function initTimelapseExperience() {
    try {
        const statusRes = await fetch('/status-cameras');
        const allCams = await statusRes.json();
        
        let timelapsesAvailable = [];
        try {
            const timeRes = await fetch('/api/timelapses-available');
            timelapsesAvailable = await timeRes.json();
        } catch (_) {}

        const timelapseMap = new Map();
        if (Array.isArray(timelapsesAvailable)) {
            timelapsesAvailable.forEach(t => timelapseMap.set(t.codigo, t));
        }

        allAvailableCameras = (allCams || [])
            .filter(cam => cam.status === 'online')
            .map(cam => {
                const recorded = timelapseMap.get(cam.codigo);
                return {
                    codigo: cam.codigo,
                    nome: cam.nome || `Câmera ${cam.codigo}`,
                    localizacao: cam.localizacao || '',
                    bairro: cam.bairro || '',
                    status: 'online',
                    frameCount: recorded ? recorded.frameCount : 'Gravação ativa',
                    latestThumbnail: `/proxy/camera/${cam.codigo}`,
                    lastUpdated: recorded ? recorded.lastUpdated : 'Ao Vivo'
                };
            });

        // Atualiza contador no topo da grade
        const countBadge = document.getElementById('timelapse-cameras-count');
        if (countBadge) {
            countBadge.textContent = `${allAvailableCameras.length} online`;
        }

        renderCamerasGrid(allAvailableCameras);

        // Seleciona a primeira câmera ONLINE por padrão
        const onlineCam = allAvailableCameras.find(c => c.status === 'online') || allAvailableCameras[0];
        if (onlineCam) {
            loadTimelapseCamera(onlineCam.codigo, onlineCam.nome);
        }

    } catch (e) {
        console.error('Erro ao inicializar timelapses:', e);
    }
}

function renderCamerasGrid(cameras) {
    const grid = document.getElementById('timelapse-cameras-grid');
    if (!grid) return;

    if (!cameras || cameras.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-12 text-center text-gray-500 dark:text-gray-400">
                <i data-lucide="camera-off" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                <p class="text-sm font-medium">Nenhuma câmera encontrada para esta busca.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    grid.innerHTML = '';
    cameras.forEach(cam => {
        const isOnline = cam.status === 'online';
        const card = document.createElement('div');
        card.className = `group bg-white dark:bg-gray-800 rounded-2xl border ${cam.codigo === currentCameraCode ? 'border-indigo-600 ring-2 ring-indigo-500/20' : 'border-gray-200 dark:border-gray-700/80'} shadow-sm hover:shadow-lg hover:border-indigo-500 transition-all overflow-hidden cursor-pointer flex flex-col`;
        card.innerHTML = `
            <div class="relative aspect-video bg-black overflow-hidden">
                <img src="${cam.latestThumbnail}" alt="${cam.nome}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onerror="this.src='/assets/offline.png'">
                <div class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[10px] font-bold text-white flex items-center gap-1.5 ${isOnline ? 'bg-emerald-600/80 backdrop-blur-md' : 'bg-rose-600/80 backdrop-blur-md'}">
                    <span class="w-1.5 h-1.5 rounded-full bg-white ${isOnline ? 'animate-pulse' : ''}"></span>
                    <span>${isOnline ? 'Online' : 'Offline'}</span>
                </div>
                <div class="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-lg text-white text-[10px] font-bold">
                    ${typeof cam.frameCount === 'number' ? `${cam.frameCount} fotos` : cam.frameCount}
                </div>
            </div>
            <div class="p-4 flex-1 flex flex-col justify-between">
                <div>
                    <div class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">${cam.codigo}</div>
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white line-clamp-1 mt-0.5">${cam.nome}</h3>
                    ${cam.bairro ? `<p class="text-xs text-gray-400 truncate mt-0.5">${cam.bairro}</p>` : ''}
                </div>
                <button class="mt-3 w-full py-2 ${cam.codigo === currentCameraCode ? 'bg-indigo-600 text-white' : 'bg-indigo-50 dark:bg-indigo-900/30 group-hover:bg-indigo-600 text-indigo-600 dark:text-indigo-300 group-hover:text-white'} rounded-xl text-xs font-bold transition-colors">
                    ${cam.codigo === currentCameraCode ? 'Reproduzindo Agora' : 'Assistir Timelapse'}
                </button>
            </div>
        `;

        card.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            loadTimelapseCamera(cam.codigo, cam.nome);
        });

        grid.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
}

async function loadTimelapseCamera(code, name) {
    currentCameraCode = code;
    pause();

    const titleEl = document.getElementById('player-camera-title');
    const codeEl = document.getElementById('player-camera-code');
    const loader = document.getElementById('player-loader');
    const frameImg = document.getElementById('timelapse-frame-img');

    if (titleEl) titleEl.textContent = name || `Câmera ${code}`;
    if (codeEl) codeEl.textContent = `Câmera ${code}`;
    if (loader) loader.classList.remove('hidden');
    if (frameImg) frameImg.src = `/proxy/camera/${code}`;

    try {
        const res = await fetch(`/api/timelapse/${code}`);
        const frames = await res.json();
        currentFrames = frames || [];

        const slider = document.getElementById('timelapse-slider');
        if (slider) {
            slider.min = 0;
            slider.max = Math.max(0, currentFrames.length - 1);
            slider.value = 0;
        }

        if (currentFrames.length > 0) {
            setFrameIndex(0);
            preloadUpcomingFrames();
        } else {
            const timeEl = document.getElementById('player-frame-time');
            if (timeEl) timeEl.textContent = 'Prévia ao vivo (capturando frames...)';
            const watermarkTime = document.getElementById('player-watermark-time');
            if (watermarkTime) watermarkTime.textContent = 'Ao Vivo';
        }
    } catch (e) {
        console.error('Erro ao carregar frames de timelapse:', e);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function setFrameIndex(idx) {
    if (!currentFrames.length) return;
    currentIndex = Math.max(0, Math.min(idx, currentFrames.length - 1));

    const frame = currentFrames[currentIndex];
    const frameImg = document.getElementById('timelapse-frame-img');
    const timeEl = document.getElementById('player-frame-time');
    const countEl = document.getElementById('player-frame-count');
    const watermarkTime = document.getElementById('player-watermark-time');
    const slider = document.getElementById('timelapse-slider');

    if (frameImg && frame) frameImg.src = frame.url;
    if (timeEl && frame) timeEl.textContent = frame.fullLabel || frame.timeFormatted;
    if (countEl) countEl.textContent = `Frame ${currentIndex + 1} de ${currentFrames.length}`;
    if (watermarkTime && frame) watermarkTime.textContent = frame.fullLabel;
    if (slider) slider.value = currentIndex;
}

function togglePlay() {
    if (isPlaying) pause();
    else play();
}

function play() {
    if (!currentFrames.length) return;
    isPlaying = true;
    updatePlayBtnUI();
    restartPlayTimer();
}

function pause() {
    isPlaying = false;
    if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
    }
    updatePlayBtnUI();
}

function restartPlayTimer() {
    if (playInterval) clearInterval(playInterval);
    const delay = Math.max(80, Math.floor(400 / playbackSpeed));
    playInterval = setInterval(() => {
        if (currentIndex >= currentFrames.length - 1) {
            currentIndex = 0; // Loop infinito
        } else {
            currentIndex++;
        }
        setFrameIndex(currentIndex);
    }, delay);
}

function updatePlayBtnUI() {
    const playIcon = document.getElementById('btn-play-icon');
    const playText = document.getElementById('btn-play-text');
    if (playText) playText.textContent = isPlaying ? 'Pausar' : 'Reproduzir';
    if (playIcon) {
        playIcon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
        if (window.lucide) window.lucide.createIcons();
    }
}

function preloadUpcomingFrames() {
    currentFrames.slice(0, 15).forEach(f => {
        const img = new Image();
        img.src = f.url;
    });
}
