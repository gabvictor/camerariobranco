import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- MODIFICAÇÃO 1: Mostrar conteúdo imediatamente ---
// Não esperamos mais pelo login para mostrar a página.
const contentWrapper = document.getElementById('content-wrapper');
if (contentWrapper) {
    contentWrapper.style.display = 'block';
}

onAuthStateChanged(auth, (user) => {
    // 'user' será 'null' se não estiver logado, ou o objeto do usuário se estiver.
    // A lógica da câmera agora é chamada independentemente do login.
    initializeCameraLogic(user);
});

function initializeComments(user, cameraCode) {
    const commentsList = document.getElementById('comments-list');
    const commentForm = document.getElementById('comment-form');
    const commentInput = document.getElementById('comment-input');
    const submitButton = commentForm ? commentForm.querySelector('button') : null;

    if (!commentsList || !commentForm) return;

    // --- MODIFICAÇÃO 2: Esconder o formulário se não houver usuário ---
    if (!user) {
        commentForm.style.display = 'none';
    }

    const commentsColRef = collection(db, 'cameras', cameraCode, 'comments');
    const q = query(commentsColRef, orderBy('timestamp', 'desc'));

    onSnapshot(q, (snapshot) => {
        commentsList.innerHTML = ''; 
        if (snapshot.empty) {
            commentsList.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Nenhum comentário ainda. Seja o primeiro!</p>';
            return;
        }
        snapshot.forEach(doc => {
            const comment = doc.data();
            const commentEl = document.createElement('div');
            commentEl.className = 'py-3 border-b border-gray-200 dark:border-gray-700 last:border-b-0';
            const date = comment.timestamp?.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) || 'agora';
            commentEl.innerHTML = `
                <div class="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span class="font-semibold">${comment.userDisplayName || 'Anónimo'}</span>
                    <span>${date.replace(',', ' às')}</span>
                </div>
                <p class="text-gray-800 dark:text-gray-200 break-words">${comment.text}</p>
            `;
            commentsList.appendChild(commentEl);
        });
    });

    commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = commentInput.value.trim();
        
        // Esta verificação 'if (text && user)' já impede o envio se o 'user' for nulo
        if (text && user) {
            commentInput.disabled = true;
            submitButton.disabled = true;
            try {
                await addDoc(commentsColRef, {
                    text: text,
                    userDisplayName: user.displayName,
                    userId: user.uid,
                    timestamp: serverTimestamp()
                });
                commentInput.value = '';
            } catch (error) {
                console.error("Erro ao adicionar comentário: ", error);
                alert("Não foi possível enviar o seu comentário. Tente novamente.");
            } finally {
                commentInput.disabled = false;
                submitButton.disabled = false;
                commentInput.focus();
            }
        } else if (!user) {
            alert("Você precisa estar logado para enviar um comentário.");
        }
    });
}

// --- MODIFICAÇÃO 3: Tornar a função 'async' para aguardar o token ---
async function initializeCameraLogic(user) {
    const params = new URLSearchParams(window.location.search);
    const cameraCode = params.get('code');
    const elements = {
        headerTitle: document.getElementById('header-title'), 
        infoTitle: document.getElementById('info-title'), 
        statusBadge: document.getElementById('status-badge'), 
        category: document.getElementById('camera-category'), 
        description: document.getElementById('camera-description'), 
        mapLink: document.getElementById('map-link'), 
        feed: document.getElementById('camera-feed'), 
        loader: document.getElementById('loader'), 
        error: document.getElementById('error-message'), 
        shareButton: document.getElementById('share-button'),
    };

    if (window.lucide) window.lucide.createIcons();
    
    if (!cameraCode) {
        // --- CÓDIGO DE ERRO QUE FALTAVA ---
        if(elements.headerTitle) elements.headerTitle.textContent = "Erro";
        if(elements.infoTitle) elements.infoTitle.textContent = "Câmera não encontrada";
        if(elements.loader) elements.loader.classList.add('hidden');
        if(elements.error) {
            elements.error.textContent = 'Nenhum código de câmera foi fornecido na URL. Exemplo: /camera/001125';
            elements.error.classList.remove('hidden');
        }
        
        // Esconde a secção de comentários e informações
        const infoSection = document.querySelector('.lg\\:col-span-2 + .space-y-8');
        if (infoSection) infoSection.style.display = 'none';
        return;
        // --- FIM DO CÓDIGO DE ERRO ---
    }
    
    // Esta função agora lida com 'user' podendo ser 'null'
    initializeComments(user, cameraCode);

    const setCameraInfo = (camera) => {
        // Atualização de SEO e Metadados
        const pageTitle = `${camera.nome} - Câmera ao Vivo`;
        document.title = pageTitle;
        
        const description = `Assista agora a câmera ao vivo de ${camera.nome}. ${camera.descricao || 'Monitoramento em tempo real de Rio Branco, Acre.'}`;
        const currentUrl = window.location.href;

        // Função auxiliar para atualizar meta tags
        const updateMeta = (selector, attribute, value) => {
            let el = document.querySelector(selector);
            if (!el) {
                // Cria se não existir (para casos onde o HTML base não tem)
                el = document.createElement('meta');
                if (selector.startsWith('meta[property')) {
                    el.setAttribute('property', selector.match(/property="([^"]+)"/)[1]);
                } else {
                    el.setAttribute('name', selector.match(/name="([^"]+)"/)[1]);
                }
                document.head.appendChild(el);
            }
            el.setAttribute(attribute, value);
        };

        updateMeta('meta[name="description"]', 'content', description);
        updateMeta('meta[property="og:title"]', 'content', pageTitle);
        updateMeta('meta[property="og:description"]', 'content', description);
        updateMeta('meta[property="og:url"]', 'content', currentUrl);
        // Mantemos a imagem padrão por enquanto, pois o stream não serve como imagem estática
        // updateMeta('meta[property="og:image"]', 'content', ...); 

        if(elements.headerTitle) elements.headerTitle.textContent = camera.nome;
        if(elements.infoTitle) elements.infoTitle.textContent = camera.nome;
        if(elements.category) elements.category.textContent = camera.categoria || 'Não disponível';
        if(elements.description) elements.description.textContent = camera.descricao || 'Não disponível';
        const isOnline = camera.status === 'online';
        if(elements.statusBadge) elements.statusBadge.innerHTML = `<span class="px-3 py-1 text-sm font-semibold rounded-full ${isOnline ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}">${isOnline ? 'Online' : 'Offline'}</span>`;
        if(elements.mapLink) {
            if (camera.coords) { 
                elements.mapLink.href = `https://www.google.com/maps?q=${camera.coords[0]},${camera.coords[1]}`; 
                elements.mapLink.removeAttribute('aria-disabled'); 
            } else { 
                elements.mapLink.setAttribute('aria-disabled', 'true'); 
            }
        }
    };

    // --- MODIFICAÇÃO 4: Enviar token de autenticação (se existir) ---
    // Isto permite que administradores vejam câmeras privadas no site
    const idToken = user ? await user.getIdToken() : null;
    const headers = {};
    if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
    }

    fetch('/status-cameras', { headers: headers })
        .then(res => res.json())
        .then(cameras => {
            const camera = cameras.find(c => c.codigo === cameraCode);
            if (camera) { 
                setCameraInfo(camera); 
                // Inicia o feed da câmera apenas se ela for encontrada
                const updateFeed = () => { if(elements.feed) elements.feed.src = `/proxy/camera?code=${cameraCode}&t=${Date.now()}`; };
                if(elements.feed) {
                    elements.feed.onload = () => { 
                        if(elements.loader) elements.loader.classList.add('hidden'); 
                        if(elements.error) elements.error.classList.add('hidden'); 
                        elements.feed.classList.remove('hidden'); 
                    };
                    elements.feed.onerror = () => { 
                        if(elements.loader) elements.loader.classList.add('hidden'); 
                        elements.feed.classList.add('hidden'); 
                        if(elements.error) {
                            elements.error.textContent = `Erro ao carregar câmera.`; 
                            elements.error.classList.remove('hidden'); 
                        }
                    }
                }
                updateFeed();
                setInterval(updateFeed, 5000); //
            } else { 
                // Se não encontrar a câmera (pode ser privada ou não existir)
                if(elements.headerTitle) elements.headerTitle.textContent = `Câmera ${cameraCode}`; 
                if(elements.infoTitle) elements.infoTitle.textContent = `Câmera ${cameraCode}`;
                if(elements.loader) elements.loader.classList.add('hidden');
                if(elements.error) {
                    elements.error.textContent = 'Câmera não encontrada ou acesso negado.';
                    elements.error.classList.remove('hidden');
                }
            }
        });

    // O botão de partilha agora tenta incluir a imagem da câmera
    if(elements.shareButton) {
        elements.shareButton.addEventListener('click', async () => {
            const shareUrl = window.location.href;
            const shareTitle = `Câmera: ${elements.infoTitle ? elements.infoTitle.textContent : ''}`;
            const shareText = `Confira a transmissão ao vivo da câmera "${elements.infoTitle ? elements.infoTitle.textContent : ''}"`;
            
            let shareData = { 
                title: shareTitle, 
                text: shareText, 
                url: shareUrl 
            };

            if (navigator.share) { 
                try {
                    // Tenta buscar a imagem para compartilhar
                    const imageUrl = elements.feed ? elements.feed.src : null;
                    if (imageUrl && navigator.canShare) {
                        try {
                            const response = await fetch(imageUrl);
                            const blob = await response.blob();
                            const file = new File([blob], "camera.jpg", { type: "image/jpeg" });
                            
                            const dataWithFile = { ...shareData, files: [file] };
                            
                            if (navigator.canShare(dataWithFile)) {
                                await navigator.share(dataWithFile);
                                return; // Sucesso com imagem
                            }
                        } catch (imgError) {
                            console.warn('Não foi possível carregar a imagem para compartilhamento:', imgError);
                        }
                    }
                    
                    // Fallback para compartilhamento sem imagem
                    await navigator.share(shareData);
                    
                } catch (err) {
                    console.error('Error sharing:', err);
                }
            } else {
                await navigator.clipboard.writeText(shareUrl).then(() => {
                    const originalText = elements.shareButton.innerHTML;
                    elements.shareButton.innerHTML = `<i data-lucide="check" class="w-5 h-5"></i> Link Copiado!`;
                    if(window.lucide) window.lucide.createIcons();
                    setTimeout(() => { elements.shareButton.innerHTML = originalText; if(window.lucide) window.lucide.createIcons(); }, 500);
                }).catch(err => console.error('Failed to copy:', err));
            }
        });
    }
}
