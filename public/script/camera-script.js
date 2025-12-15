import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, deleteDoc, doc, setDoc, getDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let videoInterval = null;
let commentsUnsubscribe = null;

// Exibir o wrapper de conteúdo imediatamente
const contentWrapper = document.getElementById('content-wrapper');
if (contentWrapper) {
    contentWrapper.style.display = 'block';
    
    // Inicializar AdSense com verificação robusta de visibilidade
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
                adSlots.forEach(slot => {
                    if (!slot.getAttribute('data-adsbygoogle-status')) {
                        (window.adsbygoogle = window.adsbygoogle || []).push({});
                    }
                });
            } catch (e) {
                console.error("AdSense error:", e);
            }
        } else {
            // Limite de tentativas (aprox 10 segundos)
            if (attempts < 20) {
                setTimeout(() => initAdSense(attempts + 1), 500);
            } else {
                console.warn("AdSense: Timed out waiting for slot visibility.");
            }
        }
    };
    
    // Inicia a verificação
    setTimeout(() => initAdSense(), 200);
}

// Ouve o estado de autenticação
onAuthStateChanged(auth, (user) => {
    // console.log("Auth State Changed:", user ? "Logged In" : "Logged Out");
    initializeCameraLogic(user);
});

/**
 * Gerencia a lógica de comentários (Firestore)
 */
function initializeComments(user, cameraCode) {
    const commentsList = document.getElementById('comments-list');
    const commentForm = document.getElementById('comment-form');
    const commentInput = document.getElementById('comment-input');
    const submitButton = commentForm ? commentForm.querySelector('button') : null;

    if (!commentsList || !commentForm) return;

    // Se não estiver logado, esconde o formulário de envio
    if (!user) {
        commentForm.style.display = 'none';
        const loginMsg = document.createElement('div');
        loginMsg.className = "p-4 text-center text-sm text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700";
        loginMsg.innerHTML = "<a href='/login.html' class='text-indigo-600 hover:underline font-medium'>Faça login</a> para participar do chat.";
        commentForm.parentNode.appendChild(loginMsg);
    }

    // Se houver um listener anterior, remove
    if (commentsUnsubscribe) {
        commentsUnsubscribe();
        commentsUnsubscribe = null;
    }

    const commentsColRef = collection(db, 'cameras', cameraCode, 'comments');
    const q = query(commentsColRef, orderBy('timestamp', 'desc'));

    // Escuta em tempo real
    commentsUnsubscribe = onSnapshot(q, (snapshot) => {
        commentsList.innerHTML = ''; 
        if (snapshot.empty) {
            commentsList.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-400 mt-8 space-y-2">
                    <div class="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-full">
                        <i data-lucide="message-square" class="w-6 h-6 opacity-50"></i>
                    </div>
                    <p class="text-sm font-medium">Nenhum comentário ainda.</p>
                </div>
            `;
            if(window.lucide) window.lucide.createIcons();
            return;
        }
        
        snapshot.forEach(docSnapshot => {
            const comment = docSnapshot.data();
            const commentEl = document.createElement('div');
            commentEl.className = 'py-3 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 animate-fade-in group';
            
            // Formatação de data segura
            let dateStr = 'agora';
            if (comment.timestamp) {
                dateStr = comment.timestamp.toDate().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            }

            const isOwner = user && user.uid === comment.userId;
            // Admin logic check (optional, but UI only shows for owner for now as per request)
            
            const deleteBtn = isOwner 
                ? `<button class="delete-btn ml-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500" data-id="${docSnapshot.id}" title="Excluir Comentário">
                     <i data-lucide="trash-2" class="w-3 h-3"></i>
                   </button>` 
                : '';

            commentEl.innerHTML = `
                <div class="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span class="font-bold text-gray-700 dark:text-gray-300">${comment.userDisplayName || 'Usuário'}</span>
                    <div class="flex items-center gap-1">
                        <span class="text-[10px] opacity-70">${dateStr}</span>
                        ${deleteBtn}
                    </div>
                </div>
                <p class="text-sm text-gray-800 dark:text-gray-200 leading-relaxed break-words">${comment.text}</p>
            `;
            commentsList.appendChild(commentEl);
        });
        
        if(window.lucide) window.lucide.createIcons();
    });

    // Event Delegation para Botões de Excluir
    if (!commentsList.dataset.deleteListener) {
        commentsList.dataset.deleteListener = 'true';
        commentsList.addEventListener('click', async (e) => {
            const btn = e.target.closest('.delete-btn');
            if (!btn) return;

            const commentId = btn.dataset.id;
            if (confirm('Tem certeza que deseja excluir este comentário?')) {
                try {
                    await deleteDoc(doc(db, 'cameras', cameraCode, 'comments', commentId));
                    // Firestore snapshot listener updates the UI automatically
                } catch (error) {
                    console.error("Erro ao excluir comentário:", error);
                    alert("Erro ao excluir. Verifique se você tem permissão.");
                }
            }
        });
    }
    
    // Evita múltiplos listeners no formulário
    if (commentForm.dataset.listenerAttached === 'true') return;
    commentForm.dataset.listenerAttached = 'true';

    // Envio de comentário
    commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = commentInput.value.trim();
        
        if (text && user) {
            commentInput.disabled = true;
            submitButton.disabled = true;
            submitButton.innerHTML = '<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>';
            
            try {
                await addDoc(commentsColRef, {
                    text: text,
                    userDisplayName: user.displayName || 'Usuário',
                    userId: user.uid,
                    timestamp: serverTimestamp()
                });
                commentInput.value = '';
            } catch (error) {
                console.error("Erro ao comentar: ", error);
                alert("Erro ao enviar. Tente novamente.");
            } finally {
                commentInput.disabled = false;
                submitButton.disabled = false;
                submitButton.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i>';
                if(window.lucide) window.lucide.createIcons();
                commentInput.focus();
            }
        }
    });
}

/**
 * Lógica Principal da Câmera
 */
async function initializeCameraLogic(user) {
    const params = new URLSearchParams(window.location.search);
    let cameraCode = params.get('code');

    // Se não encontrou na query string, tenta extrair da URL amigável /camera/:code
    if (!cameraCode) {
        const pathParts = window.location.pathname.split('/');
        // Procura por um segmento que seja exatamente 6 dígitos
        const codeInPath = pathParts.find(part => /^\d{6}$/.test(part));
        if (codeInPath) {
            cameraCode = codeInPath;
        }
    }

    // console.log("Initializing Camera Logic. Code:", cameraCode);
    
    // Mapeamento de elementos do DOM
    const el = {
        // Header
        headerSkeleton: document.getElementById('header-skeleton'),
        headerRealContent: document.getElementById('header-real-content'),
        title: document.getElementById('header-title'),
        subtitle: document.getElementById('header-subtitle'),
        statusPing: document.getElementById('status-ping'),
        statusDot: document.getElementById('status-dot'),
        
        // Player
        playerWrapper: document.getElementById('player-wrapper'),
        feed: document.getElementById('camera-feed'),
        loader: document.getElementById('loader'),
        error: document.getElementById('error-message'),
        errorText: document.getElementById('error-text-content'),
        fullscreenBtn: document.getElementById('fullscreen-btn'),
        
        // Sidebar Info
        detailsSkeleton: document.getElementById('details-skeleton'),
        detailsContent: document.getElementById('details-content'),
        category: document.getElementById('camera-category'),
        description: document.getElementById('camera-description'),
        statusBadge: document.getElementById('status-badge'),
        mapLink: document.getElementById('map-link'),
        
        // Actions
        shareBtn: document.getElementById('share-button-main'),
        likeBtn: document.getElementById('like-btn'),
        favoriteBtn: document.getElementById('favorite-btn')
    };

    if (window.lucide) window.lucide.createIcons();
    
    // --- 1. Validação do Código da Câmera ---
    if (!cameraCode) {
        handleErrorState(el, 'Nenhum código de câmera fornecido.', true);
        return;
    }
    
    // Inicia comentários independente do sucesso da câmera
    initializeComments(user, cameraCode);

    // --- 2. Preparação da Requisição ---
    const idToken = user ? await user.getIdToken() : null;
    const headers = {};
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

    // --- 3. Busca dos Dados ---
    // console.log("Fetching /status-cameras...");
    fetch('/status-cameras', { headers: headers })
        .then(res => {
            if (!res.ok) throw new Error('Falha na comunicação com o servidor');
            return res.json();
        })
        .then(cameras => {
            // console.log("Cameras fetched:", cameras.length);
            const camera = cameras.find(c => c.codigo === cameraCode);
            
            if (camera) {
                // console.log("Camera found:", camera);
                setupCameraInterface(camera, el, cameraCode);
            } else {
                console.warn("Camera not found in list.");
                handleErrorState(el, 'Câmera não encontrada ou acesso restrito.', true);
            }
        })
        .catch(err => {
            console.error("Fetch error:", err);
            handleErrorState(el, 'Erro de conexão. Verifique sua internet.', true);
        });

    // Configuração de Botões (Share, Like, Fullscreen, Favorite)
    setupActionButtons(el, cameraCode, user);
}

/**
 * Configura a Interface quando a câmera é encontrada
 */
function setupCameraInterface(camera, el, cameraCode) {
    // A. Atualiza SEO e Metadados
    const pageTitle = `${camera.nome} - Câmera ao Vivo`;
    document.title = pageTitle;
    updateMetaTags(camera, pageTitle);

    // B. Preenche Textos
    if(el.title) el.title.textContent = camera.nome;
    if(el.category) el.category.textContent = camera.categoria || 'Geral';
    if(el.description) el.description.textContent = camera.descricao || 'Sem descrição disponível.';
    
    // C. Atualiza Badge de Status e Ping
    const isOnline = camera.status === 'online';
    
    // Ping no Header
    if(el.statusPing) {
        if(isOnline) {
            el.statusPing.classList.remove('hidden');
            el.statusDot.classList.remove('bg-gray-300', 'dark:bg-gray-600', 'bg-red-500');
            el.statusDot.classList.add('bg-emerald-500');
            el.subtitle.textContent = "Online";
            el.subtitle.className = "text-emerald-600 dark:text-emerald-400 font-bold";
        } else {
            el.statusPing.classList.add('hidden');
            el.statusDot.classList.remove('bg-emerald-500');
            el.statusDot.classList.add('bg-red-500');
            el.subtitle.textContent = "Offline";
            el.subtitle.className = "text-red-500 font-bold";
        }
    }

    // Badge na Sidebar
    if (el.statusBadge) {
        el.statusBadge.innerHTML = isOnline 
            ? `<span class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full border border-emerald-200 dark:border-emerald-800"><div class="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Online</span>`
            : `<span class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400 rounded-full border border-red-200 dark:border-red-800"><div class="w-1.5 h-1.5 rounded-full bg-red-500"></div> Offline</span>`;
    }

    // Link do Mapa
    if(el.mapLink) {
        if (camera.coords) { 
            el.mapLink.href = `/mapa.html?code=${cameraCode}`; 
            el.mapLink.removeAttribute('disabled');
            el.mapLink.classList.remove('opacity-50', 'cursor-not-allowed');
        } else { 
            el.mapLink.setAttribute('disabled', 'true');
            el.mapLink.removeAttribute('href');
            el.mapLink.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }

    // D. Remove Skeletons e Mostra Conteúdo Real
    toggleSkeletons(el, false);

    // E. Inicializa o Feed de Vídeo
    startVideoFeed(el, cameraCode);
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
 * Gerencia o loop de atualização da imagem
 */
function startVideoFeed(el, cameraCode) {
    if(!el.feed) return;

    // Limpa intervalo anterior para evitar loops múltiplos
    if (videoInterval) clearInterval(videoInterval);

    let consecutiveErrors = 0;
    let hasShownValidImage = false;
    let lastSuccessAt = 0;

    const updateImage = () => {
        // Tenta carregar via proxy primeiro
        // Adiciona timestamp para evitar cache do navegador
        const proxyUrl = `/proxy/camera?code=${cameraCode}&t=${Date.now()}`;
        // console.log("Updating image source:", proxyUrl);
        
        // Se já estávamos tentando o link direto e funcionou, mantemos? 
        // Não, vamos tentar o proxy novamente a cada ciclo para ser resiliente,
        // a menos que queiramos um fallback permanente.
        // Vamos tentar o proxy, e no erro o fallback.
        el.feed.src = proxyUrl;
    };

    el.feed.onload = () => {
        consecutiveErrors = 0;
        hasShownValidImage = true;
        lastSuccessAt = Date.now();
        if (el.loader) el.loader.classList.add('hidden');
        if (el.error) el.error.classList.add('hidden');
        el.feed.classList.remove('opacity-0');
        el.feed.classList.remove('hidden');
        if (el.subtitle) {
            el.subtitle.textContent = "Online";
            el.subtitle.className = "text-emerald-600 dark:text-emerald-400 font-bold";
        }
        if (window.gtag) {
            window.gtag('event', 'camera_frame_loaded', { camera_code: cameraCode });
        }
    };

    el.feed.onerror = () => {
        consecutiveErrors++;
        // Se falhar o proxy, tenta o link direto como fallback
        if (el.feed.src.includes('/proxy/camera')) {
            console.warn("Proxy falhou, tentando conexão direta...");
            const directUrl = `https://cameras.riobranco.ac.gov.br/api/camera?code=${cameraCode}&t=${Date.now()}`;
            el.feed.src = directUrl;
            return; // Sai para deixar o browser tentar o novo src
        }

        // Se falhar também o direto (ou se já era o direto)
        // Se já exibimos uma imagem válida nos últimos 60s, não troca para erro imediatamente
        const recentlyOk = hasShownValidImage && (Date.now() - lastSuccessAt < 60000);
        if (recentlyOk || consecutiveErrors < 3) {
            if (el.loader) el.loader.classList.add('hidden');
            if (el.error) el.error.classList.add('hidden');
            // Mantém a imagem atual visível (não troca src)
            if (window.gtag) {
                window.gtag('event', 'camera_error_soft', { camera_code: cameraCode, phase: el.feed.src.includes('/proxy/camera') ? 'proxy' : 'direct' });
            }
            return;
        }

        if (el.loader) el.loader.classList.add('hidden');
        el.feed.classList.remove('hidden');
        el.feed.classList.remove('opacity-0');
        el.feed.src = '/assets/offline.png';
        if (el.error) {
            if (el.errorText) el.errorText.textContent = 'Sinal interrompido temporariamente. Tentando reconectar...';
            el.error.classList.remove('hidden');
            el.error.classList.add('flex');
        }
        if (el.subtitle) {
            el.subtitle.textContent = "Sinal Interrompido";
            el.subtitle.className = "text-red-500 font-bold";
        }
        if (window.gtag) {
            window.gtag('event', 'camera_error_hard', { camera_code: cameraCode, phase: el.feed.src.includes('/proxy/camera') ? 'proxy' : 'direct' });
        }
    };

    updateImage();
    videoInterval = setInterval(updateImage, 3000);
}

/**
 * Configura Botões de Ação
 */
function setupActionButtons(el, cameraCode, user) {
    // Evita adicionar listeners múltiplos se a função for chamada novamente
    // Verifica no container principal (playerWrapper ou similar) ou usa um flag no objeto el se persistisse (mas el é recriado).
    // O melhor é verificar no botão em si.
    if (el.shareBtn && el.shareBtn.dataset.hasListener) return;

    // 1. Like Button Removed

    // 2. Fullscreen Button
    if (el.fullscreenBtn && el.playerWrapper) {
        el.fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                el.playerWrapper.requestFullscreen().catch(err => {
                    console.error(`Erro ao entrar em tela cheia: ${err.message}`);
                });
            } else {
                document.exitFullscreen();
            }
        });

        // Atualiza ícone ao mudar estado
        document.addEventListener('fullscreenchange', () => {
            const icon = el.fullscreenBtn.querySelector('i');
            if (document.fullscreenElement) {
                icon.setAttribute('data-lucide', 'minimize');
            } else {
                icon.setAttribute('data-lucide', 'maximize');
            }
            if(window.lucide) window.lucide.createIcons();
        });
    }

    // 3. Share Button
    setupShareButton(el.shareBtn, el.feed, cameraCode);

    // 4. Favorite Button
    setupFavoriteButton(el.favoriteBtn, cameraCode, user);
}

/**
 * Trata estados de erro global
 */
function handleErrorState(el, message, critical = false) {
    toggleSkeletons(el, false);

    if(el.title) el.title.textContent = "Erro";
    if(el.category) el.category.textContent = "-";
    if(el.description) el.description.textContent = message;
    
    if(el.loader) el.loader.classList.add('hidden');
    if(el.error) {
        if(el.errorText) el.errorText.textContent = message;
        el.error.classList.remove('hidden');
        el.error.classList.add('flex');
    }
}

/**
 * Lógica de Compartilhamento
 */
function setupShareButton(btn, imgElement, cameraCode) {
    if (!btn) return;

    btn.dataset.hasListener = 'true';

    btn.addEventListener('click', async () => {
        const shareUrl = `${location.origin}/camera/${cameraCode}`;
        const shareData = {
            title: document.title,
            text: `Confira esta câmera ao vivo em Rio Branco: ${document.title}`,
            url: shareUrl
        };

        const originalContent = btn.innerHTML;
        
        // Verifica se é mobile (critério simples: suporte a navigator.share e tela pequena ou touch)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.share && window.innerWidth < 768);

        if (isMobile && navigator.share && navigator.canShare) {
             btn.innerHTML = '<div class="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>';
             try {
                if (navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                    if (window.gtag) window.gtag('event', 'camera_share', { camera_code: cameraCode, platform: 'native' });
                } else {
                    throw new Error('Dados de compartilhamento inválidos');
                }
             } catch (err) {
                 // Se cancelar ou falhar, volta ao normal silenciosamente ou com fallback
                 console.warn("Compartilhamento nativo cancelado ou falhou:", err);
             } finally {
                 btn.innerHTML = originalContent;
                 if(window.lucide) window.lucide.createIcons();
             }
        } else {
            // Desktop: Copiar para área de transferência
            try {
                await navigator.clipboard.writeText(shareUrl);
                btn.innerHTML = `<i data-lucide="check" class="w-5 h-5 text-green-500"></i> <span class="text-green-600 font-medium text-sm">Copiado!</span>`;
                if(window.lucide) window.lucide.createIcons();
                if (window.gtag) window.gtag('event', 'camera_share', { camera_code: cameraCode, platform: 'clipboard' });
                
                setTimeout(() => { 
                    btn.innerHTML = originalContent; 
                    if(window.lucide) window.lucide.createIcons();
                }, 2000);
            } catch (clipboardErr) {
                alert('Copie o link do navegador para compartilhar.');
            }
        }
    });
}

/**
 * Lógica de Favoritos
 */
async function setupFavoriteButton(btn, cameraCode, user) {
    if (!btn) return;
    
    // Check initial state
    if (user) {
        try {
            const userRef = doc(db, 'userData', user.uid);
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
                const data = userDoc.data();
                // Check both fields for backward compatibility, prefer favoriteCameras
                const favorites = data.favoriteCameras || data.favorites || [];
                if (favorites.includes(cameraCode)) {
                    btn.classList.add('text-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
                    btn.classList.remove('text-gray-600', 'dark:text-gray-400');
                    const icon = btn.querySelector('i');
                    const text = btn.querySelector('span');
                    if(icon) {
                        icon.setAttribute('fill', 'currentColor');
                        icon.classList.add('fill-amber-500');
                    }
                    if(text) text.textContent = 'Favorito';
                }
            }
        } catch (err) {
            console.error("Erro ao carregar favoritos:", err);
        }
    }

    btn.addEventListener('click', async () => {
        if (!user) {
            alert("Faça login para salvar favoritos.");
            return;
        }

        // Toggle visual imediato
        const isActive = btn.classList.contains('text-amber-500');
        const icon = btn.querySelector('i');
        const text = btn.querySelector('span');

        // Optimistic UI update
        if (isActive) {
            btn.classList.remove('text-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
            btn.classList.add('text-gray-600', 'dark:text-gray-400');
            if(icon) {
                icon.setAttribute('fill', 'none');
                icon.classList.remove('fill-amber-500');
            }
            if(text) text.textContent = 'Favoritar';
        } else {
            btn.classList.add('text-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
            btn.classList.remove('text-gray-600', 'dark:text-gray-400');
            if(icon) {
                icon.setAttribute('fill', 'currentColor');
                icon.classList.add('fill-amber-500');
            }
            if(text) text.textContent = 'Favorito';
        }

        try {
            const userRef = doc(db, 'userData', user.uid);
            const userDoc = await getDoc(userRef);
            let favorites = [];

            if (userDoc.exists()) {
                const data = userDoc.data();
                favorites = data.favoriteCameras || data.favorites || [];
            }

            if (isActive) {
                // Remove
                favorites = favorites.filter(code => code !== cameraCode);
                if (window.gtag) window.gtag('event', 'camera_favorite', { camera_code: cameraCode, action: 'remove' });
            } else {
                // Add
                if (!favorites.includes(cameraCode)) favorites.push(cameraCode);
                if (window.gtag) window.gtag('event', 'camera_favorite', { camera_code: cameraCode, action: 'add' });
            }

            // Save to 'favoriteCameras' as requested
            await setDoc(userRef, { favoriteCameras: favorites }, { merge: true });
        } catch (error) {
            console.error("Erro ao atualizar favoritos:", error);
            alert("Erro ao salvar favorito. Tente novamente.");
            // Revert UI if needed, but keeping it simple for now
        }
    });
}

/**
 * Atualiza Meta Tags dinamicamente
 */
function updateMetaTags(camera, title) {
    const description = `Assista agora a câmera ao vivo de ${camera.nome}. ${camera.descricao || 'Monitoramento em tempo real.'}`;
    const imageUrl = `/proxy/camera?code=${camera.codigo}&t=${Date.now()}`;
    const shareUrl = `${location.origin}/camera/${camera.codigo}`;
    
    const setMeta = (selector, attr, value) => {
        let element = document.querySelector(selector);
        if (!element) {
            element = document.createElement('meta');
            if(selector.includes('property')) {
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
    setMeta('meta[property="og:image:type"]', 'content', 'image/jpeg');
    setMeta('meta[property="og:image:width"]', 'content', '1280');
    setMeta('meta[property="og:image:height"]', 'content', '720');
    setMeta('meta[property="twitter:title"]', 'content', title);
    setMeta('meta[property="twitter:description"]', 'content', description);
    setMeta('meta[property="twitter:url"]', 'content', shareUrl);
    setMeta('meta[property="twitter:image"]', 'content', imageUrl);
    setMeta('meta[name="twitter:image:alt"]', 'content', `Ao Vivo: ${camera.nome}`);

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
        canonical = document.createElement('link');
        canonical.setAttribute('rel', 'canonical');
        document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', shareUrl);
}
