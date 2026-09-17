import { auth, db } from "./firebase-config.js";
import { fetchWeather, cachedWeather } from "./weather.js";
import { initAuthModal, toggleLoginModal, initGlobalAuthUI } from "./auth-modal.js";
import { initFooter } from "./footer-component.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, deleteDoc, doc, setDoc, getDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

initFooter();
initAuthModal();
initGlobalAuthUI();

const escapeHtml = (value = '') => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Toast Notification Helper
const showToast = (message, type = 'success', duration = 3200) => {
    if (window.showToast) {
        window.showToast(message, type, duration);
    }
};

let videoInterval = null;
let commentsUnsubscribe = null;

// Exibir wrapper de conteúdo imediatamente
const contentWrapper = document.getElementById('content-wrapper');
if (contentWrapper) {
    contentWrapper.style.display = 'block';

    const initAdSense = (attempts = 0) => {
        const adSlots = document.querySelectorAll('.adsbygoogle');
        if (adSlots.length === 0) return;

        let anyVisible = false;
        adSlots.forEach(slot => {
            if (slot.offsetWidth > 0 && slot.offsetParent !== null) {
                anyVisible = true;
            }
        });

        if (anyVisible) {
            try {
                adSlots.forEach(slot => {
                    if (!slot.getAttribute('data-adsbygoogle-status')) {
                        (window.adsbygoogle = window.adsbygoogle || []).push({});
                    }
                });
            } catch (e) {
                console.error("AdSense error:", e);
            }
        } else if (attempts < 20) {
            setTimeout(() => initAdSense(attempts + 1), 500);
        }
    };

    setTimeout(() => initAdSense(), 250);
}

let activeCameraCode = null;
let allCamerasList = [];
let allOnlineCameras = [];
let currentElements = null;
let activeAuthUser = null;
let currentAuthUser = auth.currentUser || null;
let hasBoundPopstate = false;
let commentsPollingInterval = null;
let currentFavoritesCache = new Set();

// Digital Zoom & Pan Engine State
let currentZoom = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let isFillMode = false;
let hudTimer = null;

/**
 * Gerencia a lógica de comentários (Firestore + API Fallback)
 */

function initializeComments(user, cameraCode) {
    const activeUser = user || auth.currentUser || currentAuthUser;
    const commentsList = document.getElementById('comments-list');
    const commentForm = document.getElementById('comment-form');
    const commentInput = document.getElementById('comment-input');
    const submitButton = commentForm ? commentForm.querySelector('button') : null;

    if (!commentsList || !commentForm) return;

    // Se não estiver logado, altera visual do chat
    if (!activeUser) {
        commentForm.style.display = 'none';
        let loginMsg = document.getElementById('comment-login-banner');
        if (!loginMsg) {
            loginMsg = document.createElement('div');
            loginMsg.id = 'comment-login-banner';
            loginMsg.className = "p-3.5 text-center text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-100 dark:border-gray-700/80 rounded-b-2xl";
            loginMsg.innerHTML = "<button id='comment-login-btn' class='text-indigo-600 dark:text-indigo-400 hover:underline font-bold bg-transparent border-0 p-0 cursor-pointer'>Faça login</button> para participar do chat ao vivo.";
            commentForm.parentNode.appendChild(loginMsg);

            const loginBtn = document.getElementById('comment-login-btn');
            if (loginBtn) {
                loginBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    toggleLoginModal(true);
                });
            }
        }
    } else {
        const loginMsg = document.getElementById('comment-login-banner');
        if (loginMsg) loginMsg.remove();
        commentForm.style.display = 'block';
    }

    if (commentsUnsubscribe) {
        commentsUnsubscribe();
        commentsUnsubscribe = null;
    }
    if (commentsPollingInterval) {
        clearInterval(commentsPollingInterval);
        commentsPollingInterval = null;
    }

    const renderCommentCards = (items) => {
        commentsList.innerHTML = '';
        if (!items || items.length === 0) {
            commentsList.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-400 py-10 space-y-2">
                    <div class="p-3 bg-gray-100 dark:bg-gray-700/40 rounded-2xl">
                        <i data-lucide="message-square" class="w-6 h-6 text-indigo-500/60"></i>
                    </div>
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400">Nenhum comentário recente.</p>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        const currentUserObj = auth.currentUser || currentAuthUser;
        items.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.className = 'p-3 rounded-2xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700/60 text-xs transition-all group';

            let dateStr = 'agora';
            if (comment.timestamp) {
                const dateObj = typeof comment.timestamp.toDate === 'function'
                    ? comment.timestamp.toDate()
                    : new Date(comment.timestamp);
                if (!isNaN(dateObj.getTime())) {
                    dateStr = dateObj.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                }
            }

            const isOwner = currentUserObj && (currentUserObj.uid === comment.userId);
            const deleteBtn = isOwner
                ? `<button class="delete-btn opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg text-red-500 cursor-pointer" data-id="${comment.id}" title="Excluir Comentário">
                     <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                   </button>`
                : '';

            const userInitial = (comment.userDisplayName || 'U').charAt(0).toUpperCase();

            commentEl.innerHTML = `
                <div class="flex items-center justify-between gap-2 mb-1.5">
                    <div class="flex items-center gap-2 min-w-0">
                        <div class="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-[10px] flex-shrink-0 shadow-2xs">
                            ${escapeHtml(userInitial)}
                        </div>
                        <span class="font-bold text-gray-900 dark:text-gray-100 truncate">${escapeHtml(comment.userDisplayName || 'Usuário')}</span>
                    </div>
                    <div class="flex items-center gap-1.5 flex-shrink-0">
                        <span class="text-[10px] text-gray-400 dark:text-gray-500 font-medium">${dateStr}</span>
                        ${deleteBtn}
                    </div>
                </div>
                <p class="text-xs text-gray-700 dark:text-gray-200 leading-relaxed break-words pl-8">${escapeHtml(comment.text)}</p>
            `;
            commentsList.appendChild(commentEl);
        });

        if (window.lucide) window.lucide.createIcons();
    };

    const loadViaApi = async () => {
        try {
            const res = await fetch(`/api/comments/${cameraCode}`);
            if (res.ok) {
                const items = await res.json();
                renderCommentCards(items);
            }
        } catch (e) {
            console.warn("Erro ao buscar comentários via API:", e);
        }
    };

    const commentsColRef = collection(db, 'cameras', cameraCode, 'comments');
    const q = query(commentsColRef, orderBy('timestamp', 'desc'));

    commentsUnsubscribe = onSnapshot(q, (snapshot) => {
        const items = [];
        snapshot.forEach(docSnap => {
            items.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderCommentCards(items);
    }, async (error) => {
        console.warn("Realtime Firestore onSnapshot indisponível, usando API REST:", error.message);
        await loadViaApi();
        if (!commentsPollingInterval) {
            commentsPollingInterval = setInterval(loadViaApi, 12000);
        }
    });

    if (!commentsList.dataset.deleteListener) {
        commentsList.dataset.deleteListener = 'true';
        commentsList.addEventListener('click', async (e) => {
            const btn = e.target.closest('.delete-btn');
            if (!btn) return;

            const commentId = btn.dataset.id;
            const currentUserObj = auth.currentUser || currentAuthUser;
            if (!currentUserObj) {
                toggleLoginModal(true);
                return;
            }

            if (confirm('Tem certeza que deseja excluir seu comentário?')) {
                try {
                    const idToken = await currentUserObj.getIdToken();
                    const res = await fetch(`/api/comment/${cameraCode}/${commentId}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${idToken}` }
                    });
                    if (!res.ok) {
                        await deleteDoc(doc(db, 'cameras', cameraCode, 'comments', commentId));
                    }
                    window.showToast?.('Comentário removido.');
                    loadViaApi();
                } catch (error) {
                    console.error("Erro ao excluir comentário:", error);
                    window.showToast?.("Erro ao excluir comentário.", "error");
                }
            }
        });
    }

    if (!commentForm.dataset.listenerAttached) {
        commentForm.dataset.listenerAttached = 'true';

        commentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentUserObj = auth.currentUser || currentAuthUser;
            if (!currentUserObj) {
                toggleLoginModal(true);
                window.showToast?.('Faça login para enviar um comentário.', 'error');
                return;
            }

            const text = commentInput.value.trim();
            if (!text) return;

            if (text.length > 500) {
                window.showToast?.('O comentário deve ter no máximo 500 caracteres.', 'error');
                return;
            }

            commentInput.disabled = true;
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.innerHTML = '<div class="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>';
            }

            try {
                const idToken = await currentUserObj.getIdToken();
                const displayName = currentUserObj.displayName?.trim() || currentUserObj.email?.split('@')[0] || 'Usuário';

                let success = false;
                try {
                    const res = await fetch('/api/comment', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${idToken}`
                        },
                        body: JSON.stringify({
                            cameraCode: cameraCode,
                            text: text
                        })
                    });
                    if (res.ok) {
                        success = true;
                    }
                } catch (_) {}

                if (!success) {
                    await addDoc(commentsColRef, {
                        text: text,
                        userDisplayName: displayName,
                        userId: currentUserObj.uid,
                        timestamp: serverTimestamp()
                    });
                }

                commentInput.value = '';
                window.showToast?.('Mensagem enviada!');
                loadViaApi();
            } catch (error) {
                console.error("Erro ao comentar: ", error);
                window.showToast?.("Erro ao enviar mensagem. Tente novamente.", "error");
            } finally {
                commentInput.disabled = false;
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i>';
                }
                if (window.lucide) window.lucide.createIcons();
                commentInput.focus();
            }
        });
    }
}

/**
 * Lógica Principal da Câmera
 */
async function initializeCameraLogic(user) {
    activeAuthUser = user;
    const urlParams = new URLSearchParams(window.location.search);
    let cameraCode = window.SERVER_CAM_CODE || urlParams.get('code');

    if (!cameraCode) {
        const pathParts = window.location.pathname.split('/');
        const codeInPath = pathParts.find(part => /^\d{6}$/.test(part));
        if (codeInPath) cameraCode = codeInPath;
    }

    activeCameraCode = cameraCode;

    const el = {
        headerSkeleton: document.getElementById('header-skeleton'),
        headerRealContent: document.getElementById('header-real-content'),
        title: document.getElementById('header-title'),
        subtitle: document.getElementById('header-subtitle'),
        statusPing: document.getElementById('status-ping'),
        statusDot: document.getElementById('status-dot'),
        categoryPill: document.getElementById('header-category-pill'),
        categoryText: document.getElementById('header-category-text'),
        breadcrumbName: document.getElementById('breadcrumb-camera-name'),
        breadcrumbCategory: document.getElementById('breadcrumb-category'),

        playerWrapper: document.getElementById('player-wrapper'),
        feed: document.getElementById('camera-feed'),
        feedNext: document.getElementById('camera-feed-next'),
        loader: document.getElementById('loader'),
        error: document.getElementById('error-message'),
        errorText: document.getElementById('error-text-content'),
        fullscreenBtn: document.getElementById('fullscreen-btn'),
        toolbarFullscreenBtn: document.getElementById('toolbar-fullscreen-btn'),
        fullscreenCloseBtn: document.getElementById('fullscreen-close-btn'),
        playerSnapshotBtn: document.getElementById('player-snapshot-btn'),
        playerTimelapseBtn: document.getElementById('player-timelapse-btn'),

        detailsSkeleton: document.getElementById('details-skeleton'),
        detailsContent: document.getElementById('details-content'),
        category: document.getElementById('camera-category'),
        description: document.getElementById('camera-description'),
        statusBadge: document.getElementById('status-badge'),
        mapLink: document.getElementById('map-link'),
        externalMapsContainer: document.getElementById('external-maps-container'),
        googleMapsBtn: document.getElementById('google-maps-btn'),
        wazeBtn: document.getElementById('waze-btn'),

        shareBtn: document.getElementById('share-button-main'),
        headerShareBtn: document.getElementById('header-share-btn'),
        favoriteBtn: document.getElementById('favorite-btn'),
        embedBtn: document.getElementById('embed-btn'),
        reportBtn: document.getElementById('report-btn')
    };

    currentElements = el;

    if (window.lucide) window.lucide.createIcons();

    if (!cameraCode) {
        handleErrorState(el, 'Nenhum código de câmera fornecido.', true);
        return;
    }

    initializeComments(user, cameraCode);

    const idToken = user ? await user.getIdToken() : null;
    const headers = {};
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

    fetch('/status-cameras', { headers: headers })
        .then(res => {
            if (!res.ok) throw new Error('Falha na comunicação com o servidor');
            return res.json();
        })
        .then(cameras => {
            allCamerasList = Array.isArray(cameras) ? cameras : [];
            allOnlineCameras = allCamerasList.filter(c => c.status === 'online' || !c.status);

            const camera = allCamerasList.find(c => c.codigo === cameraCode);

            if (camera) {
                try { setupCameraInterface(camera, el, cameraCode); } catch (e) { console.error('Error in setupCameraInterface:', e); }
                try { initRioAcreWidget(camera, cameraCode); } catch (e) { console.error('Error in initRioAcreWidget:', e); }
                try { renderNearbyCameras(camera, allCamerasList); } catch (e) { console.error('Error in renderNearbyCameras:', e); }
                try { setupCarousel(allCamerasList, cameraCode); } catch (e) { console.error('Error in setupCarousel:', e); }
            } else {
                console.warn("Camera not found in list.");
                handleErrorState(el, 'Câmera não encontrada ou acesso restrito.', true);
            }
        })
        .catch(err => {
            console.error("Fetch error:", err);
            handleErrorState(el, 'Erro de conexão. Verifique sua internet.', true);
        });

    try { setupActionButtons(el, cameraCode, user); } catch (e) { console.warn('setupActionButtons error:', e); }
    try { setupModals(cameraCode); } catch (e) { console.warn('setupModals error:', e); }

    if (!hasBoundPopstate) {
        hasBoundPopstate = true;
        window.addEventListener('popstate', (e) => {
            const pathParts = window.location.pathname.split('/');
            const codeInPath = pathParts.find(part => /^\d{6}$/.test(part));
            if (codeInPath && codeInPath !== activeCameraCode) {
                switchToCamera(codeInPath, false);
            }
        });
    }

    if (!localStorage.getItem('camrb_tour_seen_camera')) {
        setTimeout(() => {
            initCameraTour(user);
            localStorage.setItem('camrb_tour_seen_camera', 'true');
        }, 1800);
    }
}


/**
 * Configura a Interface quando a câmera é encontrada
 */
function setupCameraInterface(camera, el, cameraCode) {
    const pageTitle = `🔴 Ao Vivo: ${camera.nome} | Câmeras Rio Branco`;
    document.title = pageTitle;
    updateMetaTags(camera, pageTitle);

    if (el.title) el.title.textContent = camera.nome;
    if (el.breadcrumbName) el.breadcrumbName.textContent = camera.nome;
    if (el.breadcrumbCategory) el.breadcrumbCategory.textContent = camera.categoria || 'Rio Branco';
    if (el.categoryText) el.categoryText.textContent = camera.categoria || 'Rio Branco';
    if (el.category) el.category.textContent = camera.categoria || 'Rio Branco';

    if (el.description) {
        if (camera.descricao) {
            let safeText = escapeHtml(camera.descricao);
            let formattedDesc = safeText
                .replace(/\*\*(.*?)\*\*/g, '<strong class="text-gray-900 dark:text-white font-bold">$1</strong>')
                .replace(/\n/g, '<br>')
                .replace(/(Condições climáticas)/, '<br>$1');

            el.description.innerHTML = formattedDesc;
        } else {
            el.description.textContent = 'Monitoramento de trânsito e segurança em tempo real em Rio Branco, Acre.';
        }
    }

    const isOnline = camera.status === 'online';

    if (el.statusPing) {
        if (isOnline) {
            el.statusPing.classList.remove('hidden');
            el.statusDot.classList.remove('bg-gray-300', 'dark:bg-gray-600', 'bg-red-500');
            el.statusDot.classList.add('bg-emerald-500');
            el.subtitle.textContent = "Ao Vivo";
            el.subtitle.className = "text-emerald-700 dark:text-emerald-400 font-bold";
        } else {
            el.statusPing.classList.add('hidden');
            el.statusDot.classList.remove('bg-emerald-500');
            el.statusDot.classList.add('bg-red-500');
            el.subtitle.textContent = "Offline";
            el.subtitle.className = "text-red-500 font-bold";
        }
    }

    if (el.statusBadge) {
        el.statusBadge.innerHTML = isOnline
            ? `<span class="flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-400 rounded-full border border-emerald-200 dark:border-emerald-800"><div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div> Ao Vivo</span>`
            : `<span class="flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wider text-red-700 bg-red-100 dark:bg-red-950/60 dark:text-red-400 rounded-full border border-red-200 dark:border-red-800"><div class="w-2 h-2 rounded-full bg-red-500"></div> Offline</span>`;
    }

    if (el.mapLink) {
        if (camera.coords) {
            el.mapLink.href = `/mapa?code=${cameraCode}`;
            el.mapLink.removeAttribute('disabled');
            el.mapLink.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            el.mapLink.setAttribute('disabled', 'true');
            el.mapLink.removeAttribute('href');
            el.mapLink.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }

    // External Maps integration (Google Maps & Waze)
    if (camera.coords && el.externalMapsContainer) {
        let lat, lon;
        if (Array.isArray(camera.coords)) {
            [lat, lon] = camera.coords;
        } else if (typeof camera.coords === 'string') {
            const parts = camera.coords.split(',').map(s => s.trim());
            lat = parts[0];
            lon = parts[1];
        }

        if (lat && lon) {
            el.externalMapsContainer.classList.remove('hidden');
            if (el.googleMapsBtn) el.googleMapsBtn.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
            if (el.wazeBtn) el.wazeBtn.href = `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
        }
    }

    toggleSkeletons(el, false);
    try { startVideoFeed(el, cameraCode); } catch (e) { console.warn('startVideoFeed error:', e); }
    try { initRioAcreWidget(cameraCode, camera); } catch (e) { console.warn('initRioAcreWidget error:', e); }
    try { initTimelapsePlayer(cameraCode, camera); } catch (e) { console.warn('initTimelapsePlayer error:', e); }
    try { initCameraSponsorship(cameraCode, camera); } catch (e) { console.warn('initCameraSponsorship error:', e); }
}

/**
 * Renderiza Câmeras Próximas na Sidebar usando Haversine ou Câmeras da Mesma Região
 */
function renderNearbyCameras(currentCam, allCameras) {
    const container = document.getElementById('nearby-cameras-container');
    const list = document.getElementById('nearby-cameras-list');
    const heading = document.getElementById('nearby-cameras-heading');
    const subheading = document.getElementById('nearby-cameras-subheading');
    if (!container || !list || !Array.isArray(allCameras)) return;

    const parseCoords = (coords) => {
        if (!coords) return null;
        if (Array.isArray(coords) && coords.length === 2) {
            const lat = parseFloat(coords[0]);
            const lon = parseFloat(coords[1]);
            if (!isNaN(lat) && !isNaN(lon)) return [lat, lon];
        }
        if (typeof coords === 'object' && coords !== null) {
            const lat = parseFloat(coords.lat || coords.latitude || coords._latitude);
            const lon = parseFloat(coords.lng || coords.lon || coords.longitude || coords._longitude);
            if (!isNaN(lat) && !isNaN(lon)) return [lat, lon];
        }
        if (typeof coords === 'string' && coords.includes(',')) {
            const parts = coords.split(',').map(s => parseFloat(s.trim()));
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                return [parts[0], parts[1]];
            }
        }
        return null;
    };

    const haversineDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    const currentCoords = parseCoords(currentCam.coords);
    let nearby = [];

    if (currentCoords) {
        const [cLat, cLon] = currentCoords;
        nearby = allCameras
            .filter(c => c.codigo !== currentCam.codigo && (c.status === 'online' || !c.status))
            .map(c => {
                const cCoords = parseCoords(c.coords);
                if (!cCoords) return null;
                const dist = haversineDistance(cLat, cLon, cCoords[0], cCoords[1]);
                return { ...c, distanceKm: dist };
            })
            .filter(Boolean)
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, 4);
    } else {
        // Fallback se a câmera atual não possuir coordenadas cadastradas
        const otherOnline = allCameras.filter(c => c.codigo !== currentCam.codigo && (c.status === 'online' || !c.status));
        const sameCategory = otherOnline.filter(c => c.categoria && currentCam.categoria && c.categoria === currentCam.categoria);
        const others = otherOnline.filter(c => !sameCategory.some(sc => sc.codigo === c.codigo));
        
        let pool = [...sameCategory, ...others];
        if (pool.length === 0) {
            pool = allCameras.filter(c => c.codigo !== currentCam.codigo);
        }
        nearby = pool.slice(0, 4);
    }

    if (nearby.length === 0) {
        container.classList.add('hidden');
        return;
    }

    if (heading) heading.textContent = currentCoords ? "Câmeras Próximas" : "Outras Câmeras ao Vivo";
    if (subheading) subheading.textContent = currentCoords ? "Monitoramento nos arredores deste local" : "Transmissões ao vivo em Rio Branco";

    list.innerHTML = '';
    nearby.forEach(cam => {
        const hasDist = typeof cam.distanceKm === 'number' && !isNaN(cam.distanceKm);
        const distFormatted = hasDist
            ? (cam.distanceKm < 1 ? `a ${Math.round(cam.distanceKm * 1000)} m` : `a ${cam.distanceKm.toFixed(1)} km`)
            : 'Ao Vivo';

        const item = document.createElement('a');
        item.href = `/camera/${cam.codigo}`;
        item.className = 'flex items-center gap-3 p-2.5 rounded-xl bg-gray-50 dark:bg-gray-700/50 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/40 border border-gray-100 dark:border-gray-700/60 transition-all group active:scale-98 cursor-pointer shadow-2xs';
        item.onclick = (e) => {
            e.preventDefault();
            switchToCamera(cam.codigo);
        };
        item.innerHTML = `
            <div class="relative w-16 h-12 rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-900 flex-shrink-0">
                <img src="/proxy/camera/${escapeHtml(cam.codigo)}" alt="${escapeHtml(cam.nome)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" onerror="this.src='/assets/offline.png'">
                <div class="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-emerald-500 shadow-xs"></div>
            </div>
            <div class="min-w-0 flex-1">
                <h4 class="text-xs font-bold text-gray-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">${escapeHtml(cam.nome)}</h4>
                <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 truncate">${escapeHtml(cam.categoria || 'Rio Branco')}</span>
                    <span class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 px-1.5 py-0.2 rounded">${distFormatted}</span>
                </div>
            </div>
            <i data-lucide="chevron-right" class="w-4 h-4 text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all"></i>
        `;
        list.appendChild(item);
    });

    container.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

async function initCameraSponsorship(cameraCode, camera) {
    // Sponsorship disabled
}

/**
 * Remove os Skeletons e mostra o conteúdo
 */
function toggleSkeletons(el, showLoading) {
    if (showLoading) {
        el.headerSkeleton?.classList.remove('hidden');
        el.detailsSkeleton?.classList.remove('hidden');
        el.headerRealContent?.classList.add('hidden');
        el.detailsContent?.classList.add('hidden');
    } else {
        el.headerSkeleton?.classList.add('hidden');
        el.detailsSkeleton?.classList.add('hidden');
        el.headerRealContent?.classList.remove('hidden');
        el.headerRealContent?.classList.add('animate-fade-in');
        el.detailsContent?.classList.remove('hidden');
        el.detailsContent?.classList.add('animate-fade-in');
    }
}

/**
 * Inicializa a transmissão de vídeo das câmeras com suporte adaptativo
 */
async function startVideoFeed(el, cameraCode) {
    const feed = el.feed || document.getElementById('camera-feed');
    const feedNext = el.feedNext || document.getElementById('camera-feed-next');
    if (!feed) return;

    if (videoInterval) {
        clearTimeout(videoInterval);
        clearInterval(videoInterval);
        videoInterval = null;
    }

    if (window.gtag) {
        window.gtag('event', 'camera_view_started', { camera_code: cameraCode });
    }

    let streamIntervalMs = 0;
    try {
        const configRes = await fetch('/api/site-config');
        if (configRes.ok) {
            const cfg = await configRes.json();
            if (typeof cfg.cameraStreamIntervalMs === 'number') {
                streamIntervalMs = cfg.cameraStreamIntervalMs;
            }
        }
    } catch (_) {}

    if (streamIntervalMs < 500) {
        feed.onload = () => {
            if (cameraCode !== activeCameraCode) return;
            if (el.loader) el.loader.classList.add('hidden');
            if (el.error) {
                el.error.classList.add('hidden');
                el.error.classList.remove('flex');
            }
            if (el.subtitle) {
                el.subtitle.textContent = "Ao Vivo";
                el.subtitle.className = "text-emerald-700 dark:text-emerald-400 font-bold";
            }
        };

        feed.onerror = () => {
            if (cameraCode !== activeCameraCode) return;
            if (el.loader) el.loader.classList.add('hidden');
            if (el.error) {
                if (el.errorText) el.errorText.textContent = 'Sinal interrompido temporariamente. Aguardando conexão...';
                el.error.classList.remove('hidden');
                el.error.classList.add('flex');
            }
            if (el.subtitle) {
                el.subtitle.textContent = "Sinal Interrompido";
                el.subtitle.className = "text-red-500 font-bold";
            }

            setTimeout(() => {
                if (cameraCode === activeCameraCode) {
                    connectMjpeg();
                }
            }, 3000);
        };

        const connectMjpeg = async () => {
            if (cameraCode !== activeCameraCode) return;
            const user = auth.currentUser || currentAuthUser;
            let token = '';
            if (user) {
                try { token = await user.getIdToken(); } catch (_) {}
            }
            const query = token ? `?token=${encodeURIComponent(token)}&t=${Date.now()}` : `?t=${Date.now()}`;
            if (feed) feed.src = `/stream/camera/${cameraCode}${query}`;
        };

        connectMjpeg();
        return;
    }

    let consecutiveErrors = 0;
    let hasShownValidImage = false;
    let lastSuccessAt = 0;
    let isRequestInFlight = false;
    let currentActiveImg = feed;
    let nextInactiveImg = feedNext || feed;

    const transitionDuration = Math.min(280, Math.floor(streamIntervalMs * 0.45));

    const scheduleNextFrame = (delay = streamIntervalMs) => {
        if (videoInterval) clearTimeout(videoInterval);
        videoInterval = setTimeout(updateFrameWithTransition, delay);
    };

    const updateFrameWithTransition = () => {
        if (isRequestInFlight) return;
        if (document.hidden) {
            scheduleNextFrame(1500);
            return;
        }

        isRequestInFlight = true;
        const proxyUrl = `/proxy/camera/${cameraCode}?t=${Date.now()}`;
        const preloader = new Image();

        preloader.onload = () => {
            isRequestInFlight = false;
            consecutiveErrors = 0;
            hasShownValidImage = true;
            lastSuccessAt = Date.now();

            if (el.loader) el.loader.classList.add('hidden');
            if (el.error) {
                el.error.classList.add('hidden');
                el.error.classList.remove('flex');
            }
            if (el.subtitle) {
                el.subtitle.textContent = "Ao Vivo";
                el.subtitle.className = "text-emerald-700 dark:text-emerald-400 font-bold";
            }

            if (nextInactiveImg && nextInactiveImg !== currentActiveImg) {
                nextInactiveImg.src = proxyUrl;
                nextInactiveImg.style.zIndex = '12';
                currentActiveImg.style.zIndex = '11';
                nextInactiveImg.style.transition = `opacity ${transitionDuration}ms ease-in-out`;
                nextInactiveImg.style.opacity = '1';

                setTimeout(() => {
                    currentActiveImg.style.opacity = '0';
                    currentActiveImg.style.transition = 'none';
                    currentActiveImg.style.zIndex = '11';

                    const temp = currentActiveImg;
                    currentActiveImg = nextInactiveImg;
                    nextInactiveImg = temp;
                }, transitionDuration);
            } else {
                feed.src = proxyUrl;
            }

            scheduleNextFrame(streamIntervalMs);
        };

        preloader.onerror = () => {
            isRequestInFlight = false;
            consecutiveErrors++;

            const recentlyOk = hasShownValidImage && (Date.now() - lastSuccessAt < 60000);

            if (recentlyOk || consecutiveErrors < 3) {
                scheduleNextFrame(2500);
                return;
            }

            if (el.loader) el.loader.classList.add('hidden');
            feed.src = '/assets/offline.png';

            if (el.error) {
                if (el.errorText) el.errorText.textContent = 'Sinal interrompido temporariamente. Tentando reconectar...';
                el.error.classList.remove('hidden');
                el.error.classList.add('flex');
            }
            if (el.subtitle) {
                el.subtitle.textContent = "Sinal Interrompido";
                el.subtitle.className = "text-red-500 font-bold";
            }

            scheduleNextFrame(4000);
        };

        preloader.src = proxyUrl;
    };

    updateFrameWithTransition();
}

/**
 * Setup Camera Carousel
 */
function setupCarousel(allCameras, currentCode) {
    const carouselContainer = document.getElementById('camera-carousel');
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');

    if (!carouselContainer) return;

    let onlineOthers = (Array.isArray(allCameras) ? allCameras : [])
        .filter(c => (c.status === 'online' || !c.status) && c.codigo !== currentCode)
        .sort(() => 0.5 - Math.random());

    if (onlineOthers.length === 0 && Array.isArray(allCameras)) {
        onlineOthers = allCameras
            .filter(c => c.codigo !== currentCode)
            .sort(() => 0.5 - Math.random());
    }

    if (onlineOthers.length === 0) {
        const parent = carouselContainer.closest('.mt-6');
        if (parent) parent.style.display = 'none';
        return;
    }

    carouselContainer.innerHTML = '';

    onlineOthers.slice(0, 15).forEach(cam => {
        const item = document.createElement('a');
        item.href = `/camera/${cam.codigo}`;
        item.className = 'snap-start shrink-0 w-44 sm:w-56 flex flex-col gap-2 rounded-2xl group relative overflow-hidden bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/80 p-2.5 hover:shadow-md hover:border-indigo-500/50 transition-all cursor-pointer shadow-2xs';
        item.onclick = function (e) {
            e.preventDefault();
            if (window.gtag) gtag('event', 'carousel_click', { 'camera_code': cam.codigo });
            switchToCamera(cam.codigo);
        };
        item.innerHTML = `
            <div class="relative w-full aspect-video rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-900">
                <img src="/proxy/camera/${cam.codigo}" alt="Câmera ${escapeHtml(cam.nome)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" onerror="this.src='/assets/offline.png'">
                <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity"></div>
                <div class="absolute bottom-2 left-2 flex items-center gap-1.5">
                    <span class="relative flex h-2 w-2">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span class="text-[10px] text-white font-extrabold uppercase tracking-wider">Ao Vivo</span>
                </div>
            </div>
            <div class="px-1 text-left">
                <h4 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">${escapeHtml(cam.nome)}</h4>
                <p class="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate mt-0.5">${escapeHtml(cam.categoria || 'Rio Branco')}</p>
            </div>
        `;
        carouselContainer.appendChild(item);
    });

    if (prevBtn && nextBtn) {
        prevBtn.onclick = () => carouselContainer.scrollBy({ left: -320, behavior: 'smooth' });
        nextBtn.onclick = () => carouselContainer.scrollBy({ left: 320, behavior: 'smooth' });
    }
}

/**
 * Efeito Sonoro Sintético de Obturador de Câmera (Web Audio API - Zero Assets)
 */
function playCameraShutterSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        // 1. Shutter Blade Click (Initial mechanical click)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.035);
        gain.gain.setValueAtTime(0.28, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.035);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.035);

        // 2. Mechanical Shutter Texture Burst
        const bufferSize = Math.floor(ctx.sampleRate * 0.05);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 1800;
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.18, ctx.currentTime + 0.02);
        noiseGain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.065);
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        noise.start(ctx.currentTime + 0.02);

        // 3. Mirror Return / Shutter Close Click
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(580, ctx.currentTime + 0.055);
        osc2.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.095);
        gain2.gain.setValueAtTime(0.24, ctx.currentTime + 0.055);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.095);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(ctx.currentTime + 0.055);
        osc2.stop(ctx.currentTime + 0.095);
    } catch (_) {}
}

/**
 * Motor de Zoom Digital e Pan em Tempo Real
 */
function applyDigitalZoom() {
    const feed = currentElements?.feed || document.getElementById('camera-feed');
    const feedNext = currentElements?.feedNext || document.getElementById('camera-feed-next');
    const playerWrapper = currentElements?.playerWrapper || document.getElementById('player-wrapper');
    const zoomLevelEl = document.getElementById('fs-zoom-level');

    if (zoomLevelEl) {
        zoomLevelEl.textContent = `${currentZoom.toFixed(1)}x`;
    }

    const isZoomed = currentZoom > 1.001;
    const transformStr = isZoomed
        ? `scale(${currentZoom}) translate(${panX / currentZoom}px, ${panY / currentZoom}px)`
        : 'none';

    if (feed) feed.style.transform = transformStr;
    if (feedNext) feedNext.style.transform = transformStr;

    if (playerWrapper) {
        if (isZoomed) {
            playerWrapper.classList.add('is-zoomed');
        } else {
            playerWrapper.classList.remove('is-zoomed', 'is-panning');
            panX = 0;
            panY = 0;
        }
    }
}

function setDigitalZoom(level, focalX = null, focalY = null) {
    const clamped = Math.max(1.0, Math.min(4.0, Math.round(level * 100) / 100));
    if (Math.abs(clamped - currentZoom) < 0.005 && clamped !== 1.0) return;

    const player = currentElements?.playerWrapper || document.getElementById('player-wrapper');
    const rect = player?.getBoundingClientRect() || { width: 800, height: 450, left: 0, top: 0 };
    const width = rect.width || 800;
    const height = rect.height || 450;

    if (clamped <= 1.001) {
        currentZoom = 1.0;
        panX = 0;
        panY = 0;
    } else {
        const cx = focalX !== null ? (focalX - width / 2) : 0;
        const cy = focalY !== null ? (focalY - height / 2) : 0;

        const zoomRatio = clamped / currentZoom;
        const newPanX = cx - (cx - panX) * zoomRatio;
        const newPanY = cy - (cy - panY) * zoomRatio;

        currentZoom = clamped;
        const maxPanX = (currentZoom - 1) * (width * 0.5);
        const maxPanY = (currentZoom - 1) * (height * 0.5);
        panX = Math.max(-maxPanX, Math.min(maxPanX, newPanX));
        panY = Math.max(-maxPanY, Math.min(maxPanY, newPanY));
    }
    applyDigitalZoom();
}

function resetDigitalZoom() {
    currentZoom = 1.0;
    panX = 0;
    panY = 0;
    applyDigitalZoom();
}

/**
 * Obter lista de câmeras ativas para navegação sequencial
 */
function getCameraNavigationList() {
    if (Array.isArray(allOnlineCameras) && allOnlineCameras.length > 1) {
        return allOnlineCameras;
    }
    if (Array.isArray(allCamerasList) && allCamerasList.length > 0) {
        return allCamerasList;
    }
    return [];
}

/**
 * Troca de Câmera Fluida (sem recarregar a página e sem sair do modo tela cheia)
 */
async function switchToCamera(newCode, pushHistory = true) {
    if (!newCode) return;
    if (newCode === activeCameraCode && !pushHistory) return;

    let targetCam = allCamerasList.find(c => c.codigo === newCode);
    if (!targetCam) {
        try {
            const res = await fetch('/status-cameras');
            if (res.ok) {
                const cams = await res.json();
                allCamerasList = Array.isArray(cams) ? cams : [];
                allOnlineCameras = allCamerasList.filter(c => c.status === 'online' || !c.status);
                targetCam = allCamerasList.find(c => c.codigo === newCode);
            }
        } catch (_) {}
    }

    if (!targetCam) {
        window.location.href = `/camera/${newCode}`;
        return;
    }

    activeCameraCode = newCode;
    if (pushHistory) {
        history.pushState({ code: newCode }, '', `/camera/${newCode}`);
    }

    resetDigitalZoom();

    // Abort active streams immediately
    const feed = currentElements?.feed || document.getElementById('camera-feed');
    const feedNext = currentElements?.feedNext || document.getElementById('camera-feed-next');
    if (feed) {
        feed.onload = null;
        feed.onerror = null;
        feed.src = '';
    }
    if (feedNext) {
        feedNext.onload = null;
        feedNext.onerror = null;
        feedNext.src = '';
    }

    if (currentElements?.loader) {
        currentElements.loader.classList.remove('hidden');
    }
    if (currentElements?.error) {
        currentElements.error.classList.add('hidden');
        currentElements.error.classList.remove('flex');
    }

    setupCameraInterface(targetCam, currentElements, newCode);
    syncFsInfo(targetCam);
    showHUD();

    try { setupFavoriteButton(currentElements?.favoriteBtn, newCode, activeAuthUser); } catch (_) {}
    try { initializeComments(activeAuthUser, newCode); } catch (_) {}
    try { renderNearbyCameras(targetCam, allCamerasList); } catch (_) {}
    try { setupCarousel(allCamerasList, newCode); } catch (_) {}

    window.showToast?.(`🎥 Exibindo: ${targetCam.nome}`, 'info', 1800);
}

function navigateCamera(direction) {
    const list = getCameraNavigationList();
    if (!list || list.length <= 1) return;
    const currentIdx = list.findIndex(c => c.codigo === activeCameraCode);
    let nextIdx = 0;
    if (currentIdx !== -1) {
        nextIdx = currentIdx + direction;
        if (nextIdx >= list.length) nextIdx = 0;
        if (nextIdx < 0) nextIdx = list.length - 1;
    }
    const nextCam = list[nextIdx];
    if (nextCam && nextCam.codigo) {
        switchToCamera(nextCam.codigo);
    }
}

/**
 * Sincroniza informações da Câmera no HUD Fullscreen
 */
function syncFsInfo(cam) {
    const activeCam = cam || allCamerasList.find(c => c.codigo === activeCameraCode);
    const fsName = document.getElementById('fs-camera-name');
    const fsCategory = document.getElementById('fs-camera-category');
    const fsWeather = document.getElementById('fs-camera-weather');

    if (fsName) {
        fsName.textContent = activeCam?.nome || currentElements?.title?.textContent || 'Câmera ao Vivo';
    }
    if (fsCategory) {
        fsCategory.textContent = activeCam?.categoria || currentElements?.categoryText?.textContent || 'Rio Branco';
    }

    if (fsWeather) {
        const weatherTemp = cachedWeather?.tempText || document.getElementById('weather-temp')?.textContent?.trim();
        const iconName = cachedWeather?.iconName || 'sun';
        if (weatherTemp) {
            fsWeather.innerHTML = `<i data-lucide="${iconName}" class="w-3 h-3 text-amber-300"></i><span class="font-bold text-amber-300">${weatherTemp}</span>`;
            fsWeather.classList.remove('hidden');
            fsWeather.classList.add('inline-flex', 'items-center', 'gap-1');
            if (window.lucide) {
                try { window.lucide.createIcons(); } catch (_) {}
            }
        } else {
            fetchWeather();
        }
    }

    updateAllFavoriteButtons(activeCameraCode);
}

const isCurrentFullscreen = () => {
    return Boolean(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
    );
};

const showHUD = () => {
    const player = currentElements?.playerWrapper || document.getElementById('player-wrapper');
    const fsHud = document.getElementById('fullscreen-hud');
    if (!isCurrentFullscreen()) return;
    if (fsHud) {
        fsHud.classList.remove('opacity-0', 'pointer-events-none');
        fsHud.classList.add('opacity-100');
    }
    player?.classList.remove('fullscreen-idle');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(hideHUD, 3500);
};

const hideHUD = () => {
    const player = currentElements?.playerWrapper || document.getElementById('player-wrapper');
    const fsHud = document.getElementById('fullscreen-hud');
    if (!isCurrentFullscreen()) return;
    if (fsHud) {
        fsHud.classList.remove('opacity-100');
        fsHud.classList.add('opacity-0', 'pointer-events-none');
    }
    player?.classList.add('fullscreen-idle');
};

/**
 * Configura Botões de Ação, Fullscreen Cinema HUD, Zoom & Panning
 */
function setupActionButtons(el, cameraCode, user) {
    // 1. Favorite Button (always update with current user state)
    setupFavoriteButton(el.favoriteBtn, cameraCode, user);

    if (el.shareBtn && el.shareBtn.dataset.hasListener) return;
    if (el.shareBtn) el.shareBtn.dataset.hasListener = 'true';

    // 2. Comprehensive Cinema-Grade Fullscreen Controller with HUD
    const playerWrapper = el.playerWrapper || document.getElementById('player-wrapper');
    const fullscreenBtn = el.fullscreenBtn || document.getElementById('fullscreen-btn');
    const toolbarFullscreenBtn = el.toolbarFullscreenBtn || document.getElementById('toolbar-fullscreen-btn');
    const fsHud = document.getElementById('fullscreen-hud');
    const fsCameraClock = document.getElementById('fs-camera-clock');
    const fsFitBtn = document.getElementById('fs-fit-toggle-btn');
    const fsFitText = document.getElementById('fs-fit-text');
    const fsSnapshotBtn = document.getElementById('fs-snapshot-btn');
    const fsTimelapseBtn = document.getElementById('fs-timelapse-btn');
    const fsFavoriteBtn = document.getElementById('fs-favorite-btn');
    const fsExitBtn = document.getElementById('fs-exit-btn');
    const fsZoomInBtn = document.getElementById('fs-zoom-in-btn');
    const fsZoomOutBtn = document.getElementById('fs-zoom-out-btn');
    const fsZoomResetBtn = document.getElementById('fs-zoom-reset-btn');
    const fsPrevCamBtn = document.getElementById('fs-prev-cam-btn');
    const fsNextCamBtn = document.getElementById('fs-next-cam-btn');

    const updateFsClock = () => {
        if (fsCameraClock) {
            const now = new Date();
            fsCameraClock.textContent = now.toLocaleTimeString('pt-BR');
        }
    };
    setInterval(updateFsClock, 1000);
    updateFsClock();

    const updateFullscreenUI = (isActive) => {
        // Floating button icon
        if (fullscreenBtn) {
            const icon = fullscreenBtn.querySelector('i');
            if (icon) icon.setAttribute('data-lucide', isActive ? 'minimize' : 'maximize');
            fullscreenBtn.setAttribute('title', isActive ? 'Sair da Tela Cheia' : 'Modo Tela Cheia');
        }

        // Toolbar button icon & text
        if (toolbarFullscreenBtn) {
            const icon = toolbarFullscreenBtn.querySelector('i');
            if (icon) icon.setAttribute('data-lucide', isActive ? 'minimize' : 'maximize');
            const textSpan = toolbarFullscreenBtn.querySelector('.fullscreen-text');
            if (textSpan) textSpan.textContent = isActive ? 'Sair da Tela Cheia' : 'Tela Cheia';
            if (isActive) {
                toolbarFullscreenBtn.classList.add('bg-indigo-600', 'text-white');
                toolbarFullscreenBtn.classList.remove('bg-indigo-50', 'text-indigo-700', 'dark:bg-indigo-950/40', 'dark:text-indigo-300');
            } else {
                toolbarFullscreenBtn.classList.remove('bg-indigo-600', 'text-white');
                toolbarFullscreenBtn.classList.add('bg-indigo-50', 'text-indigo-700', 'dark:bg-indigo-950/40', 'dark:text-indigo-300');
            }
        }

        // Hide default non-fullscreen overlays when fullscreen is active to prevent duplicates
        const defaultOverlays = playerWrapper?.querySelectorAll('.player-default-ui');
        if (defaultOverlays) {
            defaultOverlays.forEach(overlay => {
                if (isActive) {
                    overlay.classList.add('hidden');
                } else {
                    if (overlay.id === 'player-rio-badge') {
                        const hasRio = overlay.querySelector('#player-rio-nivel')?.textContent?.includes('m');
                        if (hasRio) {
                            overlay.classList.remove('hidden');
                            overlay.classList.add('flex');
                        }
                    } else {
                        overlay.classList.remove('hidden');
                    }
                }
            });
        }

        // Cinema HUD toggle
        if (fsHud) {
            if (isActive) {
                fsHud.classList.remove('hidden');
                syncFsInfo();
                showHUD();
            } else {
                fsHud.classList.add('hidden');
                clearTimeout(hudTimer);
                playerWrapper?.classList.remove('fullscreen-idle');
                resetDigitalZoom();
            }
        }

        if (window.lucide) {
            try { window.lucide.createIcons(); } catch (_) {}
        }
    };

    const requestFs = (target) => {
        if (!target) return Promise.reject(new Error('No target element'));
        if (target.requestFullscreen) return target.requestFullscreen();
        if (target.webkitRequestFullscreen) return Promise.resolve(target.webkitRequestFullscreen());
        if (target.mozRequestFullScreen) return Promise.resolve(target.mozRequestFullScreen());
        if (target.msRequestFullscreen) return Promise.resolve(target.msRequestFullscreen());
        return Promise.reject(new Error('Fullscreen API not supported'));
    };

    const enterFullscreen = () => {
        const player = el.playerWrapper || document.getElementById('player-wrapper');
        if (!player) return;

        // Native Browser Fullscreen (True OS / F11 fullscreen on the camera player)
        requestFs(player).catch((err) => {
            console.warn("player.requestFullscreen failed, trying document fallback:", err);
            requestFs(document.documentElement).catch((e) => {
                console.warn("Fullscreen request error:", e);
            });
        });

        try {
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(() => {});
            }
        } catch (_) {}
    };

    const exitFullscreen = () => {
        resetDigitalZoom();

        try {
            if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) {
                if (document.exitFullscreen) {
                    document.exitFullscreen().catch(() => {});
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                } else if (document.mozCancelFullScreen) {
                    document.mozCancelFullScreen();
                } else if (document.msExitFullscreen) {
                    document.msExitFullscreen();
                }
            }
        } catch (err) {
            console.warn("Exit fullscreen error:", err);
        }

        try {
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        } catch (_) {}
    };

    const toggleFullscreen = () => {
        if (isCurrentFullscreen()) {
            exitFullscreen();
        } else {
            enterFullscreen();
        }
    };

    if (fullscreenBtn) {
        fullscreenBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFullscreen();
        };
    }

    if (toolbarFullscreenBtn) {
        toolbarFullscreenBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFullscreen();
        };
    }

    // HUD Actions
    if (fsExitBtn) {
        fsExitBtn.onclick = (e) => {
            e.stopPropagation();
            exitFullscreen();
        };
    }

    if (fsFitBtn) {
        fsFitBtn.onclick = (e) => {
            e.stopPropagation();
            isFillMode = !isFillMode;
            playerWrapper?.classList.toggle('mode-fill', isFillMode);
            if (fsFitText) fsFitText.textContent = isFillMode ? 'Preencher' : 'Ajustar';
            window.showToast?.(isFillMode ? '📐 Exibição: Preencher Tela Inteira' : '📐 Exibição: Ajustar à Tela', 'info', 2000);
            showHUD();
        };
    }

    if (fsSnapshotBtn) {
        fsSnapshotBtn.onclick = (e) => {
            e.stopPropagation();
            captureCameraSnapshot(activeCameraCode || cameraCode);
            showHUD();
        };
    }

    if (fsTimelapseBtn) {
        fsTimelapseBtn.onclick = (e) => {
            e.stopPropagation();
            document.getElementById('timelapse-modal-btn')?.click();
            showHUD();
        };
    }

    if (fsFavoriteBtn) {
        fsFavoriteBtn.onclick = (e) => {
            e.stopPropagation();
            toggleCameraFavorite(activeCameraCode, activeAuthUser);
            showHUD();
        };
    }

    // Zoom Buttons
    if (fsZoomInBtn) {
        fsZoomInBtn.onclick = (e) => {
            e.stopPropagation();
            setDigitalZoom(currentZoom + 0.5);
            showHUD();
        };
    }

    if (fsZoomOutBtn) {
        fsZoomOutBtn.onclick = (e) => {
            e.stopPropagation();
            setDigitalZoom(currentZoom - 0.5);
            showHUD();
        };
    }

    if (fsZoomResetBtn) {
        fsZoomResetBtn.onclick = (e) => {
            e.stopPropagation();
            resetDigitalZoom();
            showHUD();
        };
    }

    // In-Fullscreen Camera Switchers
    if (fsPrevCamBtn) {
        fsPrevCamBtn.onclick = (e) => {
            e.stopPropagation();
            navigateCamera(-1);
            showHUD();
        };
    }

    if (fsNextCamBtn) {
        fsNextCamBtn.onclick = (e) => {
            e.stopPropagation();
            navigateCamera(1);
            showHUD();
        };
    }

    // Mouse Wheel Zoom in Fullscreen centered at cursor
    if (playerWrapper) {
        playerWrapper.addEventListener('wheel', (e) => {
            if (!isCurrentFullscreen()) return;
            e.preventDefault();
            const rect = playerWrapper.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomDelta = 0.35;
            if (e.deltaY < 0) {
                setDigitalZoom(currentZoom + zoomDelta, mouseX, mouseY);
            } else {
                setDigitalZoom(currentZoom - zoomDelta, mouseX, mouseY);
            }
            showHUD();
        }, { passive: false });

        // Mouse Pan Drag when Zoomed & Swipe Navigation
        let startClientX = 0;
        let startClientY = 0;
        let initialPanX = 0;
        let initialPanY = 0;
        let isMouseDragging = false;
        let mouseStartX = 0;
        let mouseStartY = 0;

        playerWrapper.addEventListener('dragstart', (e) => {
            e.preventDefault();
            return false;
        });

        playerWrapper.addEventListener('mousedown', (e) => {
            if (e.target.closest('button, a, input, select, textarea')) return;
            e.preventDefault();

            startClientX = e.clientX;
            startClientY = e.clientY;
            initialPanX = panX;
            initialPanY = panY;

            if (currentZoom > 1.001) {
                isPanning = true;
                playerWrapper.classList.add('is-panning');
            } else if (isCurrentFullscreen()) {
                isMouseDragging = true;
                mouseStartX = e.clientX;
                mouseStartY = e.clientY;
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (isPanning && currentZoom > 1.001) {
                const dx = e.clientX - startClientX;
                const dy = e.clientY - startClientY;
                const maxPanX = (currentZoom - 1) * (playerWrapper.clientWidth * 0.5);
                const maxPanY = (currentZoom - 1) * (playerWrapper.clientHeight * 0.5);
                panX = Math.max(-maxPanX, Math.min(maxPanX, initialPanX + dx));
                panY = Math.max(-maxPanY, Math.min(maxPanY, initialPanY + dy));
                applyDigitalZoom();
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (isPanning) {
                isPanning = false;
                playerWrapper.classList.remove('is-panning');
            }
            if (isMouseDragging) {
                if (currentZoom <= 1.001 && isCurrentFullscreen()) {
                    const dx = e.clientX - mouseStartX;
                    const dy = e.clientY - mouseStartY;
                    if (Math.abs(dx) > 70 && Math.abs(dy) < 60) {
                        if (dx > 0) navigateCamera(-1);
                        else navigateCamera(1);
                    }
                }
                isMouseDragging = false;
            }
        });

        // Touch Drag & Pinch Zoom on Mobile
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartDist = 0;
        let isTouchSwipe = false;

        playerWrapper.addEventListener('touchstart', (e) => {
            if (e.target.closest('button, a, input, select')) return;
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                initialPanX = panX;
                initialPanY = panY;
                if (currentZoom > 1.001) {
                    isPanning = true;
                    playerWrapper.classList.add('is-panning');
                } else {
                    isTouchSwipe = true;
                }
            } else if (e.touches.length === 2) {
                touchStartDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
            showHUD();
        }, { passive: true });

        playerWrapper.addEventListener('touchmove', (e) => {
            if (isPanning && e.touches.length === 1 && currentZoom > 1.001) {
                const dx = e.touches[0].clientX - touchStartX;
                const dy = e.touches[0].clientY - touchStartY;
                const maxPanX = (currentZoom - 1) * (playerWrapper.clientWidth * 0.5);
                const maxPanY = (currentZoom - 1) * (playerWrapper.clientHeight * 0.5);
                panX = Math.max(-maxPanX, Math.min(maxPanX, initialPanX + dx));
                panY = Math.max(-maxPanY, Math.min(maxPanY, initialPanY + dy));
                applyDigitalZoom();
            } else if (e.touches.length === 2 && touchStartDist > 0) {
                const currentDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                const ratio = currentDist / touchStartDist;
                if (Math.abs(ratio - 1) > 0.04) {
                    const rect = playerWrapper.getBoundingClientRect();
                    const midX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
                    const midY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
                    setDigitalZoom(currentZoom * ratio, midX, midY);
                    touchStartDist = currentDist;
                }
            }
        }, { passive: true });

        playerWrapper.addEventListener('touchend', (e) => {
            if (isTouchSwipe && currentZoom <= 1.001 && isCurrentFullscreen() && e.changedTouches.length > 0) {
                const dx = e.changedTouches[0].clientX - touchStartX;
                const dy = e.changedTouches[0].clientY - touchStartY;
                if (Math.abs(dx) > 60 && Math.abs(dy) < 50) {
                    if (dx > 0) navigateCamera(-1);
                    else navigateCamera(1);
                }
            }
            isPanning = false;
            isTouchSwipe = false;
            touchStartDist = 0;
            playerWrapper.classList.remove('is-panning');
        }, { passive: true });

        // Auto-hide HUD on user interactions
        playerWrapper.addEventListener('mousemove', showHUD);
        playerWrapper.addEventListener('touchstart', showHUD, { passive: true });

        // Double-click / Double-tap: Zoom in/out if fullscreen, or toggle fullscreen if normal
        let lastTapTime = 0;
        playerWrapper.addEventListener('click', (e) => {
            if (e.target.closest('button, a, input, select')) return;

            const currentTime = Date.now();
            const tapGap = currentTime - lastTapTime;
            if (tapGap < 300 && tapGap > 0) {
                if (isCurrentFullscreen()) {
                    if (currentZoom > 1.001) {
                        resetDigitalZoom();
                    } else {
                        const rect = playerWrapper.getBoundingClientRect();
                        const mouseX = e.clientX - rect.left;
                        const mouseY = e.clientY - rect.top;
                        setDigitalZoom(2.0, mouseX, mouseY);
                    }
                    showHUD();
                } else {
                    toggleFullscreen();
                }
                lastTapTime = 0;
            } else {
                lastTapTime = currentTime;
            }
        });
    }

    // Fullscreen change events (F11, ESC or browser native toggle sync)
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
        document.addEventListener(evt, () => {
            const isNative = isCurrentFullscreen();
            updateFullscreenUI(isNative);
            if (!isNative) {
                resetDigitalZoom();
            }
        });
    });

    // Comprehensive Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea, select')) return;
        const key = e.key.toLowerCase();

        if (e.key === 'Escape' && isCurrentFullscreen()) {
            exitFullscreen();
        } else if (key === 'f') {
            e.preventDefault();
            toggleFullscreen();
        } else if (key === 's') {
            e.preventDefault();
            captureCameraSnapshot(activeCameraCode || cameraCode);
        } else if (key === 't') {
            e.preventDefault();
            document.getElementById('timelapse-modal-btn')?.click();
        } else if (key === 'm') {
            if (isCurrentFullscreen()) {
                e.preventDefault();
                fsFitBtn?.click();
            }
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateCamera(-1);
            showHUD();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateCamera(1);
            showHUD();
        } else if (e.key === '+' || e.key === '=' || e.key === 'Add') {
            if (isCurrentFullscreen()) {
                e.preventDefault();
                setDigitalZoom(currentZoom + 0.5);
                showHUD();
            }
        } else if (e.key === '-' || e.key === '_' || e.key === 'Subtract') {
            if (isCurrentFullscreen()) {
                e.preventDefault();
                setDigitalZoom(currentZoom - 0.5);
                showHUD();
            }
        } else if (e.key === '0' || e.key === 'NumPad0') {
            if (isCurrentFullscreen()) {
                e.preventDefault();
                resetDigitalZoom();
                showHUD();
            }
        }
    });

    // 3. Snapshot Capture buttons
    const snapshotBtn = document.getElementById('snapshot-btn');
    const playerSnapshotBtn = document.getElementById('player-snapshot-btn');
    const handleSnapshot = () => captureCameraSnapshot(activeCameraCode || cameraCode);
    if (snapshotBtn) snapshotBtn.onclick = handleSnapshot;
    if (playerSnapshotBtn) playerSnapshotBtn.onclick = handleSnapshot;

    // 4. Quick Timelapse Player trigger on player
    if (el.playerTimelapseBtn) {
        el.playerTimelapseBtn.onclick = () => {
            const modalBtn = document.getElementById('timelapse-modal-btn');
            if (modalBtn) modalBtn.click();
        };
    }
}

/**
 * Captura Snapshot Instantâneo com Efeito Visual Shutter Flash & Áudio Realista
 */
function captureCameraSnapshot(cameraCode) {
    try {
        const activeCode = cameraCode || activeCameraCode || window.SERVER_CAM_CODE;
        playCameraShutterSound();

        const shutter = document.getElementById('shutter-flash');
        if (shutter) {
            shutter.classList.remove('animate-shutter');
            void shutter.offsetWidth;
            shutter.classList.add('animate-shutter');
            setTimeout(() => shutter.classList.remove('animate-shutter'), 400);
        }

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
        const fileName = `camrb-${activeCode}-${dateStr}_${timeStr}.jpg`;

        const link = document.createElement('a');
        link.download = fileName;
        link.href = `/proxy/camera/${activeCode}?t=${Date.now()}`;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.showToast?.('📸 Foto da câmera capturada com sucesso!');
        if (window.gtag) window.gtag('event', 'camera_snapshot', { camera_code: activeCode });
    } catch (e) {
        console.error('Erro ao capturar foto:', e);
        window.showToast?.('Erro ao salvar imagem.', 'error');
    }
}

/**
 * Modais: Compartilhar, Embed, Reportar
 */
function setupModals(cameraCode) {
    // ─── Share Modal & Logic ──────────────────────────────
    const shareBtn = document.getElementById('share-button-main');
    const headerShareBtn = document.getElementById('header-share-btn');
    const shareModal = document.getElementById('share-modal');
    const shareModalBox = document.getElementById('share-modal-box');
    const closeShareBtn = document.getElementById('close-share-modal-btn');
    const shareLinkInput = document.getElementById('share-link-input');
    const copyShareLinkBtn = document.getElementById('copy-share-link-btn');

    const getShareUrl = () => `${location.origin}/camera/${activeCameraCode || cameraCode}`;

    const openShareModal = () => {
        const shareUrl = getShareUrl();
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) && navigator.share;
        if (isMobile) {
            navigator.share({
                url: shareUrl
            }).catch(() => {});
            return;
        }

        if (shareLinkInput) shareLinkInput.value = shareUrl;
        if (shareModal) {
            shareModal.classList.remove('hidden');
            setTimeout(() => {
                shareModal.classList.remove('opacity-0');
                shareModalBox?.classList.remove('scale-95');
                shareModalBox?.classList.add('scale-100');
            }, 10);
        }
    };

    const closeShareModal = () => {
        if (!shareModal) return;
        shareModal.classList.add('opacity-0');
        shareModalBox?.classList.remove('scale-100');
        shareModalBox?.classList.add('scale-95');
        setTimeout(() => shareModal.classList.add('hidden'), 200);
    };

    if (shareBtn) shareBtn.onclick = openShareModal;
    if (headerShareBtn) headerShareBtn.onclick = openShareModal;
    if (closeShareBtn) closeShareBtn.onclick = closeShareModal;
    if (shareModal) {
        shareModal.onclick = (e) => {
            if (e.target === shareModal) closeShareModal();
        };
    }

    if (copyShareLinkBtn) {
        copyShareLinkBtn.onclick = async () => {
            const shareUrl = getShareUrl();
            try {
                await navigator.clipboard.writeText(shareUrl);
                window.showToast?.('Link da câmera copiado!');
            } catch (_) {}
        };
    }

    // Direct social share buttons (passes clean URL so WhatsApp/Telegram/Facebook/X preview meta tags)
    const shareWhatsApp = document.getElementById('share-whatsapp-btn');
    if (shareWhatsApp) {
        shareWhatsApp.onclick = () => {
            window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(getShareUrl())}`, '_blank');
        };
    }
    const shareTelegram = document.getElementById('share-telegram-btn');
    if (shareTelegram) {
        shareTelegram.onclick = () => {
            window.open(`https://t.me/share/url?url=${encodeURIComponent(getShareUrl())}`, '_blank');
        };
    }
    const shareTwitter = document.getElementById('share-twitter-btn');
    if (shareTwitter) {
        shareTwitter.onclick = () => {
            window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(getShareUrl())}`, '_blank');
        };
    }
    const shareFacebook = document.getElementById('share-facebook-btn');
    if (shareFacebook) {
        shareFacebook.onclick = () => {
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getShareUrl())}`, '_blank');
        };
    }

    // ─── Embed Modal ──────────────────────────────────────
    const embedBtn = document.getElementById('embed-btn');
    const embedModal = document.getElementById('embed-modal');
    const embedModalBox = document.getElementById('embed-modal-box');
    const closeEmbedBtn = document.getElementById('close-embed-modal-btn');
    const embedTextarea = document.getElementById('embed-code-textarea');
    const copyEmbedBtn = document.getElementById('copy-embed-btn');

    const getIframeCode = () => `<iframe src="https://camerasriobranco.com.br/embed/${activeCameraCode || cameraCode}" width="100%" height="450" frameborder="0" allowfullscreen></iframe>`;

    const openEmbedModal = () => {
        if (embedTextarea) embedTextarea.value = getIframeCode();
        if (embedModal) {
            embedModal.classList.remove('hidden');
            setTimeout(() => {
                embedModal.classList.remove('opacity-0');
                embedModalBox?.classList.remove('scale-95');
                embedModalBox?.classList.add('scale-100');
            }, 10);
        }
    };

    const closeEmbedModal = () => {
        if (!embedModal) return;
        embedModal.classList.add('opacity-0');
        embedModalBox?.classList.remove('scale-100');
        embedModalBox?.classList.add('scale-95');
        setTimeout(() => embedModal.classList.add('hidden'), 200);
    };

    if (embedBtn) embedBtn.onclick = openEmbedModal;
    if (closeEmbedBtn) closeEmbedBtn.onclick = closeEmbedModal;
    if (embedModal) {
        embedModal.onclick = (e) => {
            if (e.target === embedModal) closeEmbedModal();
        };
    }

    if (copyEmbedBtn) {
        copyEmbedBtn.onclick = async () => {
            const iframeCode = getIframeCode();
            try {
                await navigator.clipboard.writeText(iframeCode);
                window.showToast?.('Código de incorporação copiado!');
            } catch (_) {
                if (embedTextarea) {
                    embedTextarea.select();
                    document.execCommand('copy');
                    window.showToast?.('Código de incorporação copiado!');
                }
            }
        };
    }

    // ─── Report Modal ─────────────────────────────────────
    const reportBtn = document.getElementById('report-btn');
    const reportModal = document.getElementById('report-modal');
    const cancelReportBtn = document.getElementById('cancel-report-btn');
    const confirmReportBtn = document.getElementById('confirm-report-btn');
    const reportBackdrop = document.getElementById('report-backdrop');
    const reportOptions = document.querySelectorAll('.report-option');
    let selectedReason = null;

    if (reportBtn && reportModal && reportModal.dataset.listenerAttached !== 'true') {
        reportModal.dataset.listenerAttached = 'true';

        reportBtn.onclick = () => {
            reportModal.classList.remove('hidden');
            selectedReason = null;
            const detailsInput = document.getElementById('report-details');
            if (detailsInput) detailsInput.value = '';
            reportOptions.forEach(opt => {
                opt.classList.remove('border-red-500', 'bg-red-50', 'dark:bg-red-900/20');
                opt.classList.add('border-transparent');
            });
        };

        const closeReportModal = () => reportModal.classList.add('hidden');
        if (cancelReportBtn) cancelReportBtn.onclick = closeReportModal;
        if (reportBackdrop) reportBackdrop.onclick = closeReportModal;

        reportOptions.forEach(option => {
            option.onclick = () => {
                reportOptions.forEach(opt => {
                    opt.classList.remove('border-red-500', 'bg-red-50', 'dark:bg-red-900/20');
                    opt.classList.add('border-transparent');
                });
                option.classList.remove('border-transparent');
                option.classList.add('border-red-500', 'bg-red-50', 'dark:bg-red-900/20');
                selectedReason = option.dataset.reason;
            };
        });

        if (confirmReportBtn) {
            confirmReportBtn.onclick = async () => {
                if (!selectedReason) {
                    window.showToast?.('Selecione um motivo para o reporte.', 'error');
                    return;
                }

                const details = document.getElementById('report-details')?.value || '';
                const origText = confirmReportBtn.innerText;
                confirmReportBtn.innerText = 'Enviando...';
                confirmReportBtn.disabled = true;

                try {
                    const response = await fetch('/api/report', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            cameraId: cameraCode,
                            issueType: selectedReason,
                            description: details
                        })
                    });

                    if (response.ok) {
                        window.showToast?.('Obrigado! Seu aviso foi enviado para nossa equipe.');
                        closeReportModal();
                    } else {
                        throw new Error('Falha ao enviar reporte');
                    }
                } catch (error) {
                    console.error(error);
                    window.showToast?.('Erro ao enviar reporte. Tente novamente.', 'error');
                } finally {
                    confirmReportBtn.innerText = origText;
                    confirmReportBtn.disabled = false;
                }
            };
        }
    }
}

/**
 * Lógica de Favoritos Unificada
 */

async function loadFavorites(user) {
    currentFavoritesCache.clear();
    try {
        const localFavs = JSON.parse(localStorage.getItem('camrb_local_favorites') || '[]');
        if (Array.isArray(localFavs)) localFavs.forEach(c => currentFavoritesCache.add(c));
    } catch (_) {}

    if (user) {
        try {
            const userRef = doc(db, 'userData', user.uid);
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
                const data = userDoc.data();
                const favorites = data.favoriteCameras || data.favorites || [];
                if (Array.isArray(favorites)) favorites.forEach(c => currentFavoritesCache.add(c));
            }
        } catch (err) {
            console.warn("Erro ao carregar favoritos do Firestore:", err);
        }
    }
}

function isCurrentCameraFavorited(cameraCode) {
    const code = cameraCode || activeCameraCode;
    if (!code) return false;
    return currentFavoritesCache.has(code);
}

async function toggleCameraFavorite(cameraCode, user) {
    const code = cameraCode || activeCameraCode;
    if (!code) return false;
    const isCurrentlyFav = currentFavoritesCache.has(code);
    const nextState = !isCurrentlyFav;

    if (nextState) {
        currentFavoritesCache.add(code);
        window.showToast?.('⭐ Câmera salva nos seus favoritos!', 'success');
    } else {
        currentFavoritesCache.delete(code);
        window.showToast?.('Câmera removida dos favoritos.', 'info');
    }

    const localFavs = Array.from(currentFavoritesCache);
    try {
        localStorage.setItem('camrb_local_favorites', JSON.stringify(localFavs));
    } catch (_) {}

    if (user) {
        try {
            const userRef = doc(db, 'userData', user.uid);
            await setDoc(userRef, { favoriteCameras: localFavs }, { merge: true });
        } catch (err) {
            console.error("Erro ao salvar favoritos no Firestore:", err);
        }
    }

    updateAllFavoriteButtons(code, nextState);
    return nextState;
}

function updateAllFavoriteButtons(cameraCode, isFav = null) {
    const code = cameraCode || activeCameraCode;
    const active = isFav !== null ? isFav : isCurrentCameraFavorited(code);

    // 1. Main Toolbar Favorite Button
    const mainFavBtn = document.getElementById('favorite-btn');
    if (mainFavBtn) {
        const icon = mainFavBtn.querySelector('svg, i');
        const text = mainFavBtn.querySelector('span');
        if (active) {
            mainFavBtn.className = 'flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs cursor-pointer shadow-md shadow-amber-500/25 active:scale-95 transition-all border border-amber-400';
            if (icon) {
                icon.setAttribute('fill', 'currentColor');
                icon.classList.add('fill-white', 'text-white');
            }
            if (text) text.textContent = 'Favoritada';
        } else {
            mainFavBtn.className = 'flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-700/60 hover:bg-amber-50 dark:hover:bg-amber-900/25 border border-gray-200/80 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:text-amber-500 hover:border-amber-300 dark:hover:border-amber-700 transition-all group active:scale-95 font-semibold text-xs cursor-pointer shadow-2xs';
            if (icon) {
                icon.setAttribute('fill', 'none');
                icon.classList.remove('fill-white', 'text-white', 'fill-amber-500');
            }
            if (text) text.textContent = 'Favoritar';
        }
    }

    // 2. Fullscreen HUD Favorite Button
    const fsFavBtn = document.getElementById('fs-favorite-btn');
    if (fsFavBtn) {
        const icon = fsFavBtn.querySelector('svg, i');
        if (active) {
            fsFavBtn.className = 'p-2 sm:px-3 sm:py-2 flex items-center gap-1.5 bg-amber-500 text-white font-black text-xs rounded-xl backdrop-blur-md border border-amber-300 shadow-xl shadow-amber-500/30 transition-all cursor-pointer ring-2 ring-amber-400/50';
            if (icon) {
                icon.setAttribute('fill', 'currentColor');
                icon.classList.add('fill-white', 'text-white');
            }
        } else {
            fsFavBtn.className = 'p-2 sm:px-3 sm:py-2 flex items-center gap-1.5 bg-black/65 hover:bg-white/20 active:scale-95 text-white text-xs font-bold rounded-xl backdrop-blur-md border border-white/15 shadow-xl transition-all cursor-pointer';
            if (icon) {
                icon.setAttribute('fill', 'none');
                icon.classList.remove('fill-white', 'text-white', 'fill-amber-500');
            }
        }
    }
}

async function setupFavoriteButton(btn, cameraCode, user) {
    await loadFavorites(user);
    updateAllFavoriteButtons(cameraCode);
    if (!btn) return;
    btn.onclick = (e) => {
        e.stopPropagation();
        toggleCameraFavorite(activeCameraCode || cameraCode, user);
    };
}

/**
 * Trata estados de erro global
 */
function handleErrorState(el, message) {
    toggleSkeletons(el, false);
    if (el.title) el.title.textContent = "Erro de Conexão";
    if (el.category) el.category.textContent = "-";
    if (el.description) el.description.textContent = message;

    if (el.loader) el.loader.classList.add('hidden');
    if (el.error) {
        if (el.errorText) el.errorText.textContent = message;
        el.error.classList.remove('hidden');
        el.error.classList.add('flex');
    }
}

/**
 * Atualiza Meta Tags dinamicamente
 */
function updateMetaTags(camera, title) {
    const description = `Assista agora a câmera ao vivo de ${camera.nome}. ${camera.descricao || 'Monitoramento em tempo real em Rio Branco, Acre.'}`;
    const imageUrl = `/proxy/camera/${camera.codigo}?t=${Date.now()}`;
    const shareUrl = `${location.origin}/camera/${camera.codigo}`;

    const setMeta = (selector, attr, value) => {
        let element = document.querySelector(selector);
        if (!element) {
            element = document.createElement('meta');
            if (selector.includes('property')) {
                element.setAttribute('property', selector.replace('meta[property="', '').replace('"]', ''));
            } else {
                element.setAttribute('name', selector.replace('meta[name="', '').replace('"]', ''));
            }
            document.head.appendChild(element);
        }
        element.setAttribute(attr, value);
    };

    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:url"]', 'content', shareUrl);
    setMeta('meta[property="og:image"]', 'content', imageUrl);
    setMeta('meta[property="og:image:secure_url"]', 'content', imageUrl);
    setMeta('meta[property="twitter:title"]', 'content', title);
    setMeta('meta[property="twitter:description"]', 'content', description);
    setMeta('meta[property="twitter:url"]', 'content', shareUrl);
    setMeta('meta[property="twitter:image"]', 'content', imageUrl);
}

/**
 * Inicializa o Widget do Rio Acre para câmeras fluviais (001426, 001334 ou com categoria/tags de rio)
 */
async function initRioAcreWidget(camera, cameraCode) {
    const rioWidget = document.getElementById('rio-acre-widget');
    const playerRioBadge = document.getElementById('player-rio-badge');

    function checkIsRio(cam, code) {
        if (typeof cam === 'object' && cam !== null) {
            const cat = String(cam.categoria || '').toLowerCase();
            const name = String(cam.nome || '').toLowerCase();
            const cCode = String(cam.codigo || '');
            if (cat.includes('rio') || cat.includes('fluvial') ||
                name.includes('rio acre') || name.includes('de olho no rio') ||
                ['001426', '001334'].includes(cCode)) {
                return true;
            }
        }
        const c = String(code || (typeof cam === 'string' ? cam : '') || '');
        return ['001426', '001334'].includes(c);
    }

    const isRio = checkIsRio(camera, cameraCode);
    const fsRioBadge = document.getElementById('fs-camera-rio-badge');
    const fsRioNivel = document.getElementById('fs-rio-nivel');

    if (!isRio) {
        if (rioWidget) rioWidget.classList.add('hidden');
        if (playerRioBadge) playerRioBadge.classList.add('hidden');
        if (fsRioBadge) {
            fsRioBadge.classList.add('hidden');
            fsRioBadge.classList.remove('sm:inline-flex');
        }
        return;
    }

    if (rioWidget) rioWidget.classList.remove('hidden');
    if (playerRioBadge) {
        playerRioBadge.classList.remove('hidden');
        playerRioBadge.classList.add('flex');
    }
    if (fsRioBadge) {
        fsRioBadge.classList.remove('hidden');
        fsRioBadge.classList.add('sm:inline-flex');
    }

    try {
        const res = await fetch('/api/rio-acre');
        if (!res.ok) throw new Error('Falha ao carregar dados do Rio Acre');
        const data = await res.json();

        const nivelEl = document.getElementById('rio-acre-nivel');
        const statusBadge = document.getElementById('rio-acre-status-badge');
        const lastUpdateEl = document.getElementById('rio-acre-last-update');
        const margemEl = document.getElementById('rio-acre-margem');

        const playerNivel = document.getElementById('player-rio-nivel');
        const playerStatus = document.getElementById('player-rio-status');

        const nivelFormatado = data.nivel?.formatado || '1,83 m';
        const dataStr = data.nivel?.dataLeitura || 'Hoje';
        const statusTipo = data.status?.tipo || 'Normal';

        if (nivelEl) nivelEl.textContent = nivelFormatado;
        if (playerNivel) playerNivel.textContent = `Rio: ${nivelFormatado}`;
        if (fsRioNivel) fsRioNivel.textContent = `Rio: ${nivelFormatado}`;
        if (lastUpdateEl) lastUpdateEl.textContent = `Medição oficial: ${dataStr}`;

        if (playerStatus) {
            playerStatus.textContent = statusTipo;
            if (statusTipo === 'Transbordamento') {
                playerStatus.className = 'text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-red-600 text-white shadow-xs';
            } else if (statusTipo === 'Alerta') {
                playerStatus.className = 'text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white shadow-xs';
            } else {
                playerStatus.className = 'text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500 text-white shadow-xs';
            }
        }

        if (statusBadge) {
            statusBadge.className = `px-3 py-1 text-xs font-extrabold uppercase rounded-full text-white shadow-xs flex items-center gap-1.5 ${data.status?.statusBg || 'bg-emerald-500'}`;
            statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-white animate-pulse"></span> ${statusTipo}`;
        }

        if (margemEl) {
            if (statusTipo === 'Transbordamento') {
                margemEl.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-red-500 flex-shrink-0"></i><span>Atenção: nível elevado das águas. Siga as orientações da Defesa Civil.</span>`;
            } else if (statusTipo === 'Alerta') {
                margemEl.innerHTML = `<i data-lucide="alert-circle" class="w-3.5 h-3.5 text-amber-500 flex-shrink-0"></i><span>Atenção: o nível do rio requer atenção e acompanhamento.</span>`;
            } else {
                margemEl.innerHTML = `<i data-lucide="shield-check" class="w-3.5 h-3.5 text-emerald-500 flex-shrink-0"></i><span>Situação tranquila e estável na capital acreana.</span>`;
            }
        }

        if (window.lucide) window.lucide.createIcons();
    } catch (e) {
        console.warn('Erro ao atualizar widget do Rio Acre:', e.message);
    }
}

/**
 * Inicializa o Modal de Timelapse 24h e Exportação de GIF
 */
let timelapseFrames = [];
let currentFrameIndex = 0;
let isPlayingTimelapse = false;
let timelapseTimeout = null;
let timelapseLoadToken = 0;
const timelapseImageCache = new Map();

function initTimelapsePlayer(cameraCode, camera) {
    const modalBtn = document.getElementById('timelapse-modal-btn');
    const modal = document.getElementById('timelapse-modal');
    const modalBox = document.getElementById('timelapse-modal-box');
    const closeBtn = document.getElementById('close-timelapse-modal-btn');
    const cameraTitleEl = document.getElementById('timelapse-modal-camera-title');
    const imageEl = document.getElementById('timelapse-modal-image');
    const slider = document.getElementById('timelapse-modal-slider');
    const playBtn = document.getElementById('timelapse-modal-play-btn');
    const timeBadge = document.getElementById('timelapse-modal-time-badge');
    const frameCounter = document.getElementById('timelapse-modal-frame-counter');
    const fullLabel = document.getElementById('timelapse-modal-full-label');
    const startTimeEl = document.getElementById('timelapse-modal-start-time');
    const endTimeEl = document.getElementById('timelapse-modal-end-time');
    const speedSelect = document.getElementById('timelapse-speed-select');
    const downloadGifBtn = document.getElementById('timelapse-download-gif-btn');
    const gifStatus = document.getElementById('timelapse-gif-status');
    const loader = document.getElementById('timelapse-modal-loader');

    if (!modalBtn || !modal) return;

    if (cameraTitleEl && camera?.nome) {
        cameraTitleEl.textContent = camera.nome;
    }

    const getPreloadedImg = (url) => {
        if (!url) return null;
        let img = timelapseImageCache.get(url);
        if (!img) {
            img = new Image();
            img.src = url;
            timelapseImageCache.set(url, img);
        }
        return img;
    };

    const preloadUpcoming = (fromIndex, count = 15) => {
        if (!timelapseFrames || !timelapseFrames.length) return;
        const total = timelapseFrames.length;
        for (let i = 1; i <= count; i++) {
            const targetIdx = (fromIndex + i) % total;
            const frame = timelapseFrames[targetIdx];
            if (frame && frame.url) getPreloadedImg(frame.url);
        }
    };

    const updateUI = (frame, index) => {
        if (timeBadge) timeBadge.textContent = frame.timeFormatted;
        if (frameCounter) frameCounter.textContent = `${index + 1}/${timelapseFrames.length}`;
        if (fullLabel) fullLabel.textContent = frame.fullLabel || `${frame.dateFormatted} às ${frame.timeFormatted}`;
        if (slider) slider.value = String(index);
    };

    const scheduleNext = () => {
        if (timelapseTimeout) clearTimeout(timelapseTimeout);
        if (!isPlayingTimelapse) return;

        const speed = parseInt(speedSelect?.value || '350', 10);
        timelapseTimeout = setTimeout(() => {
            if (!isPlayingTimelapse) return;
            renderFrame(currentFrameIndex + 1, true);
        }, speed);
    };

    const renderFrame = (index, isAutoPlay = false) => {
        if (!timelapseFrames || !timelapseFrames.length) return;

        let targetIdx = index;
        if (isAutoPlay) {
            if (targetIdx >= timelapseFrames.length) targetIdx = 0;
            else if (targetIdx < 0) targetIdx = timelapseFrames.length - 1;
        } else {
            targetIdx = Math.max(0, Math.min(targetIdx, timelapseFrames.length - 1));
        }

        const frame = timelapseFrames[targetIdx];
        if (!frame) return;

        const token = ++timelapseLoadToken;
        const preloader = getPreloadedImg(frame.url);

        if (preloader.complete && preloader.naturalWidth > 0) {
            currentFrameIndex = targetIdx;
            if (imageEl) imageEl.src = frame.url;
            updateUI(frame, currentFrameIndex);
            preloadUpcoming(currentFrameIndex);

            if (isAutoPlay && isPlayingTimelapse) scheduleNext();
            return;
        }

        preloader.onload = () => {
            if (token !== timelapseLoadToken) return;
            currentFrameIndex = targetIdx;
            if (imageEl) imageEl.src = frame.url;
            updateUI(frame, currentFrameIndex);
            preloadUpcoming(currentFrameIndex);

            if (isAutoPlay && isPlayingTimelapse) scheduleNext();
        };

        preloader.onerror = () => {
            if (token !== timelapseLoadToken) return;
            if (isAutoPlay && isPlayingTimelapse) {
                setTimeout(() => {
                    if (token === timelapseLoadToken && isPlayingTimelapse) {
                        renderFrame(targetIdx + 1, true);
                    }
                }, 150);
            }
        };
    };

    const togglePlay = (start) => {
        if (start && timelapseFrames.length > 1) {
            isPlayingTimelapse = true;
            if (playBtn) {
                playBtn.innerHTML = '<i data-lucide="pause" class="w-4 h-4"></i><span>Pausar</span>';
                playBtn.classList.replace('bg-purple-600', 'bg-amber-600');
                playBtn.classList.replace('hover:bg-purple-700', 'hover:bg-amber-700');
            }
            if (window.lucide) window.lucide.createIcons();
            renderFrame(currentFrameIndex + 1, true);
        } else {
            isPlayingTimelapse = false;
            timelapseLoadToken++;
            if (timelapseTimeout) {
                clearTimeout(timelapseTimeout);
                timelapseTimeout = null;
            }
            if (playBtn) {
                playBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i><span>Reproduzir</span>';
                playBtn.classList.replace('bg-amber-600', 'bg-purple-600');
                playBtn.classList.replace('hover:bg-amber-700', 'hover:bg-purple-700');
            }
            if (window.lucide) window.lucide.createIcons();
        }
    };

    const openModal = async () => {
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modalBox?.classList.remove('scale-95');
            modalBox?.classList.add('scale-100');
        }, 10);

        if (loader) loader.classList.remove('hidden');
        timelapseImageCache.clear();

        try {
            const res = await fetch(`/api/timelapse/${cameraCode}`);
            if (!res.ok) throw new Error('Falha ao buscar imagens de timelapse');
            timelapseFrames = await res.json();

            if (!Array.isArray(timelapseFrames) || timelapseFrames.length === 0) {
                if (fullLabel) fullLabel.textContent = 'Nenhum frame gravado nas últimas 24h.';
                if (downloadGifBtn) downloadGifBtn.disabled = true;
                if (playBtn) playBtn.disabled = true;
                if (loader) loader.classList.add('hidden');
                return;
            }

            if (downloadGifBtn) downloadGifBtn.disabled = false;
            if (playBtn) playBtn.disabled = false;

            slider.min = "0";
            slider.max = String(timelapseFrames.length - 1);
            currentFrameIndex = timelapseFrames.length - 1;
            slider.value = String(currentFrameIndex);

            if (startTimeEl && timelapseFrames[0]) {
                startTimeEl.textContent = timelapseFrames[0].timeFormatted;
            }
            if (endTimeEl && timelapseFrames[timelapseFrames.length - 1]) {
                endTimeEl.textContent = timelapseFrames[timelapseFrames.length - 1].timeFormatted;
            }

            renderFrame(currentFrameIndex, false);
            preloadUpcoming(currentFrameIndex, 20);
        } catch (e) {
            console.error('Erro ao carregar timelapse:', e);
            if (fullLabel) fullLabel.textContent = 'Erro ao carregar frames do timelapse.';
        } finally {
            if (loader) loader.classList.add('hidden');
            if (window.lucide) window.lucide.createIcons();
        }
    };

    const closeModal = () => {
        togglePlay(false);
        modal.classList.add('opacity-0');
        modalBox?.classList.remove('scale-100');
        modalBox?.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    modalBtn.onclick = openModal;
    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });

    slider.oninput = (e) => {
        if (isPlayingTimelapse) togglePlay(false);
        const targetIdx = parseInt(e.target.value, 10);
        const preview = timelapseFrames[targetIdx];
        if (preview) {
            if (timeBadge) timeBadge.textContent = preview.timeFormatted;
            if (frameCounter) frameCounter.textContent = `${targetIdx + 1}/${timelapseFrames.length}`;
            if (fullLabel) fullLabel.textContent = preview.fullLabel || `${preview.dateFormatted} às ${preview.timeFormatted}`;
        }
        renderFrame(targetIdx, false);
    };

    if (playBtn) {
        playBtn.onclick = () => togglePlay(!isPlayingTimelapse);
    }

    if (speedSelect) {
        speedSelect.onchange = () => {
            if (isPlayingTimelapse) scheduleNext();
        };
    }

    if (downloadGifBtn) {
        downloadGifBtn.onclick = async () => {
            if (!timelapseFrames || timelapseFrames.length === 0) {
                alert('Não há frames suficientes para gerar o GIF.');
                return;
            }

            if (typeof window.gifshot === 'undefined') {
                alert('Biblioteca de GIF carregando, tente novamente em alguns segundos.');
                return;
            }

            downloadGifBtn.disabled = true;
            downloadGifBtn.innerHTML = '<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Gerando GIF...</span>';
            if (gifStatus) {
                gifStatus.classList.remove('hidden');
                gifStatus.textContent = `Processando ${timelapseFrames.length} fotos em alta resolução...`;
            }

            const frameUrls = timelapseFrames.map(f => f.url);
            const speed = parseInt(speedSelect?.value || '350', 10);

            window.gifshot.createGIF({
                images: frameUrls,
                interval: speed / 1000,
                gifWidth: 640,
                gifHeight: 360,
                numWorkers: 2,
                progressCallback: (progress) => {
                    if (gifStatus) {
                        gifStatus.textContent = `Gerando GIF... ${Math.round(progress * 100)}%`;
                    }
                }
            }, function (obj) {
                downloadGifBtn.disabled = false;
                downloadGifBtn.innerHTML = '<i data-lucide="download" class="w-4 h-4"></i><span>Baixar como GIF</span>';
                if (window.lucide) window.lucide.createIcons();

                if (!obj.error) {
                    if (gifStatus) {
                        gifStatus.textContent = '✅ GIF gerado com sucesso! Iniciando download...';
                        setTimeout(() => gifStatus.classList.add('hidden'), 4000);
                    }
                    const downloadLink = document.createElement('a');
                    downloadLink.href = obj.image;
                    downloadLink.download = `timelapse-${cameraCode}-${new Date().toISOString().slice(0, 10)}.gif`;
                    document.body.appendChild(downloadLink);
                    downloadLink.click();
                    document.body.removeChild(downloadLink);
                } else {
                    console.error('Erro ao gerar GIF:', obj.error);
                    if (gifStatus) {
                        gifStatus.textContent = '❌ Erro ao compilar GIF. Tente novamente.';
                        setTimeout(() => gifStatus.classList.add('hidden'), 4000);
                    }
                }
            });
        };
    }

    if (window.lucide) window.lucide.createIcons();
}

/**
 * Tour Inicial da Câmera
 */
function initCameraTour(user) {
    if (!window.driver || !window.driver.js) return;

    const isLoggedIn = !!user;

    const steps = [
        {
            element: '#player-wrapper',
            popover: {
                title: 'Transmissão da Câmera',
                description: 'Acompanhe as imagens ao vivo desta câmera em alta resolução.',
                side: 'top',
                align: 'center'
            }
        },
        {
            element: '#favorite-btn',
            popover: {
                title: 'Favoritar Câmera',
                description: isLoggedIn
                    ? 'Adicione esta câmera aos seus Favoritos para acessá-la instantaneamente na tela inicial.'
                    : 'Salve esta câmera nos seus favoritos para acesso rápido a qualquer momento.',
                side: 'top',
                align: 'start'
            }
        },
        {
            element: '#snapshot-btn',
            popover: {
                title: 'Capturar Foto Instantânea',
                description: 'Grave uma foto em alta definição do momento exato para salvar no seu celular ou computador.',
                side: 'top',
                align: 'center'
            }
        },
        {
            element: '#share-button-main',
            popover: {
                title: 'Compartilhar Câmera',
                description: 'Envie o link desta transmissão diretamente no WhatsApp, Telegram ou redes sociais.',
                side: 'top',
                align: 'center'
            }
        }
    ];

    const validSteps = steps.filter(step => document.querySelector(step.element));
    if (!validSteps.length) return;

    const driverInstance = window.driver.js.driver({
        showProgress: true,
        animate: true,
        showButtons: ['previous', 'next', 'close'],
        nextBtnText: 'Próximo',
        prevBtnText: 'Voltar',
        doneBtnText: 'Concluir',
        steps: validSteps
    });

    driverInstance.drive();
}

// ─── Bootstrap Principal da Página ─────────────────────────────────────
initializeCameraLogic(null);

onAuthStateChanged(auth, (user) => {
    currentAuthUser = user;
    activeAuthUser = user;
    initializeCameraLogic(user);
});

fetchWeather();

