const express = require('express');
const axios = require('axios');
const cors = require('cors');
// Mudança: Usar o módulo fs normal, não o de promises
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const admin = require('firebase-admin');

// --- INÍCIO: CONFIGURAÇÃO SEGURA DO FIREBASE ADMIN ---
let db; // Declare db in the outer scope
let serviceAccount = {};

try {
    // Verifica se está rodando no Render (onde o arquivo fica em /etc/secrets/) 
    // Se não achar lá, procura na pasta local (./) 
    const secretPath = fs.existsSync('/etc/secrets/serviceAccountKey.json')
        ? '/etc/secrets/serviceAccountKey.json'
        : './serviceAccountKey.json';

    console.log(`✔ Carregando credenciais do Firebase de: ${secretPath}`);
    serviceAccount = JSON.parse(fs.readFileSync(secretPath, 'utf8'));

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✔ Firebase Admin SDK inicializado com sucesso.");

    // Inicializa o Firestore
    db = admin.firestore();
    console.log("✔ Firebase Firestore inicializado.");

} catch (error) {
    console.error("[ERRO CRÍTICO] Falha ao inicializar o Firebase Admin SDK.", error);
    process.exit(1);
}
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || serviceAccount.admin_email;
// --- FIM: CONFIGURAÇÃO DO FIREBASE ADMIN ---


// --- Configurações Centralizadas ---
const CONFIG = {
    PORT: process.env.PORT || 3001,
    UPDATE_INTERVAL_MS: 1 * 60 * 1000,
    CONCURRENCY_LIMIT: 20,
    CAMERA_CODE_START: 1000,
    CAMERA_CODE_END: 1700,
    REQUEST_TIMEOUT: 8000,
    MIN_IMAGE_SIZE_KB: 22,
    SCAN_TIMEOUT_MS: 420 * 1000,
    SCAN_RETRY_DELAY_MS: 120 * 1000,
};

const app = express();
const PUBLIC_FOLDER = path.join(__dirname, 'public');
const ASSETS_FOLDER = path.join(PUBLIC_FOLDER, 'assets');
const ERROR_IMAGE_PATH = path.join(ASSETS_FOLDER, 'offline.png');

// --- Estado da Aplicação ---
let nextScanTimestamp = Date.now();
let isScanning = false;
let scanTimeoutOccurred = false;
let cameraInfo = []; // Agora será preenchido pelo Firestore
let cachedCameraStatus = [];
let siteConfig = { showAppBanner: true }; // Default config

// --- Métricas e Logs ---
const METRICS = {
    startTime: Date.now(),
    requestCount: 0,
    errorsCount: 0,
    proxySuccesses: 0,
    proxyFailures: 0,
    totalRequestDurationMs: 0,
    lastRequestAt: null,
    lastProxySuccessAt: null,
    lastProxyFailureAt: null,
    viewsToday: 0,  // Contador volátil de visualizações hoje (resetado no restart)
    totalViews: 0,  // Contador total acumulado (carregado do DB se possível, ou 0)
    topCameras: {}  // Mapa { cameraCode: viewsCount }
};

// Carregar contadores persistentes do Firestore (opcional, para não zerar no restart)
async function loadPersistentMetrics() {
    try {
        const doc = await db.collection('metrics').doc('global_views').get();
        if (doc.exists) {
            const data = doc.data();
            METRICS.totalViews = data.total || 0;
            // Opcional: zerar viewsToday diariamente via cron ou checar data
            const todayStr = new Date().toISOString().split('T')[0];
            if (data.date === todayStr) {
                METRICS.viewsToday = data.today || 0;
                METRICS.topCameras = data.topCameras || {};
            } else {
                METRICS.viewsToday = 0;
                METRICS.topCameras = {};
            }
        }
    } catch (e) {
        console.error("Erro ao carregar métricas persistentes:", e);
    }
}
// Chamar após inicializar DB
setTimeout(loadPersistentMetrics, 5000);

// Salvar métricas periodicamente
setInterval(async () => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        await db.collection('metrics').doc('global_views').set({
            total: METRICS.totalViews,
            today: METRICS.viewsToday,
            date: todayStr,
            topCameras: METRICS.topCameras
        }, { merge: true });
    } catch (e) {
        console.error("Erro ao salvar métricas:", e);
    }
}, 5 * 60 * 1000); // A cada 5 minutos

// --- ROTA DE CORREÇÃO PARA ANDROID APP LINKS (ASSETLINKS.JSON) ---
// Tenta ler o arquivo diretamente e envia o conteúdo como JSON.
app.get('/.well-known/assetlinks.json', async (req, res) => {
    const filePath = path.join(PUBLIC_FOLDER, '.well-known', 'assetlinks.json');
    try {
        const content = await fs.readFile(filePath, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(content);
    } catch (e) {
        const fallback = [
            {
                relation: ["delegate_permission/common.handle_all_urls"],
                target: {
                    namespace: "android_app",
                    package_name: "com.gabvictor.camrb",
                    sha256_cert_fingerprints: [
                        "95:B7:14:22:06:61:38:B2:46:32:45:18:72:7B:B4:0F:85:4B:0C:24:CF:DE:2C:FD:E4:39:3F:BC:7A:88:8C:34"
                    ]
                }
            }
        ];
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify(fallback));
    }
});
// --- FIM DA ROTA DE CORREÇÃO ---


// --- Middlewares ---

// Configuração de Segurança com Helmet
// NOTA: CSP desativada para permitir carregamento de todos os recursos externos (Anúncios, Scripts, Imagens, etc)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    originAgentCluster: false,
}));

app.use(cors());
app.use(express.json());

// --- INÍCIO DA ARMADILHA PARA BOTS (TARPIT) ---
const rotasIsca = [
    '/.env',
    '/.git/config',
    '/phpmyadmin',
    '/backup.zip',
    '/config.bak',
    '/.well-known/security.txt', 
    '/manager/html'              
];

app.use((req, res, next) => {
    const caminhoAcessado = req.path.toLowerCase();

    // A MÁGICA COMPLETA AQUI:
    // 1. Está na lista de iscas? OU
    // 2. Termina com '.php'? OU
    // 3. Começa com '/wp' ou '/wp-'?
    if (
        rotasIsca.some(isca => caminhoAcessado.includes(isca)) || 
        caminhoAcessado.endsWith('.php') || 
        caminhoAcessado.startsWith('/wp')
    ) {
        
        const ipAtacante = req.ip || req.headers['x-forwarded-for'];
        console.warn(`[🛑 ARMADILHA] Bot capturado! IP: ${ipAtacante} tentou acessar: ${req.path}`);
        
        setTimeout(() => {
            res.status(418).send("Você caiu no poço de piche do CamRB. Volte sempre!");
        }, 180000); // Fica preso por 3 minutos

        return; 
    }

    next();
});
// --- FIM DA ARMADILHA ---

// --- Middlewares de Autenticação ---
const verifyAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn(`[SECURITY] Tentativa de acesso sem token: ${req.originalUrl} - IP: ${req.ip}`);
        return res.status(403).json({ message: 'Acesso negado: Token não fornecido.' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        if (decodedToken.email === ADMIN_EMAIL) {
            req.user = decodedToken;
            next();
        } else {
            console.warn(`[SECURITY] Acesso negado para email não autorizado: ${decodedToken.email} em ${req.originalUrl}`);
            res.status(403).json({ message: 'Acesso negado: Permissões insuficientes.' });
        }
    } catch (error) {
        console.error(`[SECURITY] Erro na verificação do token: ${error.message}`);
        res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
};

const verifyOptionalAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    req.userIsAdmin = false;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split('Bearer ')[1];
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            if (decodedToken.email === ADMIN_EMAIL) {
                req.userIsAdmin = true;
            }
        } catch (error) { /* Ignora erros de token inválido */ }
    }
    next();
};


app.get('/api/config', (req, res) => {
    res.json({
        adminEmail: ADMIN_EMAIL
    });
});

// Rota para a nova página de gerenciamento de reportes (admin/reports)
app.get('/admin/reports', (req, res) => {
    res.sendFile(path.join(PUBLIC_FOLDER, 'reports.html'));
});

app.get('/admin/comments', (req, res) => {
    res.sendFile(path.join(PUBLIC_FOLDER, 'comments.html'));
});

app.get('/admin/comments/:cameraId', (req, res) => {
    res.sendFile(path.join(PUBLIC_FOLDER, 'comments.html'));
});

app.get('/admin/comments/:cameraId/:commentId', (req, res) => {
    res.sendFile(path.join(PUBLIC_FOLDER, 'comments.html'));
});

// Endpoint para Reportar Problemas
app.post('/api/report', async (req, res) => {
    try {
        const { cameraId, issueType, description, userEmail } = req.body;
        
        if (!cameraId || !issueType) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        // Rate limiting simples (opcional)
        
        await db.collection('reports').add({
            cameraId,
            issueType,
            description: description || '',
            userEmail: userEmail || 'anônimo',
            status: 'pending',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userAgent: req.headers['user-agent'] || ''
        });

        res.status(200).json({ success: true, message: 'Reporte enviado com sucesso' });
    } catch (error) {
        console.error('Erro ao salvar reporte:', error);
        res.status(500).json({ error: 'Erro interno ao processar reporte' });
    }
});

// Endpoint para Listar Reportes (Admin Only)
app.get('/api/reports', verifyAdmin, async (req, res) => {
    try {
        console.log(`[API] Buscando reportes para admin: ${req.user.email}`);
        const snapshot = await db.collection('reports').orderBy('timestamp', 'desc').limit(50).get();
        const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`[API] ${reports.length} reportes encontrados.`);
        res.setHeader('Cache-Control', 'no-store');
        res.json(reports);
    } catch (error) {
        console.error('Erro ao buscar reportes:', error);
        res.status(500).json({ error: 'Erro ao buscar reportes' });
    }
});

// Endpoint para Atualizar Status de Reporte (Admin Only)
app.put('/api/report/:id/status', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status é obrigatório' });
        }

        const reportRef = db.collection('reports').doc(id);
        const report = await reportRef.get();

        if (!report.exists) {
            return res.status(404).json({ error: 'Reporte não encontrado' });
        }

        await reportRef.update({ status });
        
        console.log(`[API] Reporte ${id} atualizado para ${status} por ${req.user.email}`);
        res.json({ success: true, message: 'Status atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar reporte:', error);
        res.status(500).json({ error: 'Erro ao atualizar reporte' });
    }
});

// Endpoint para Excluir Reporte (Admin Only)
app.delete('/api/report/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const reportRef = db.collection('reports').doc(id);
        const report = await reportRef.get();

        if (!report.exists) {
            return res.status(404).json({ error: 'Reporte não encontrado' });
        }

        await reportRef.delete();
        
        console.log(`[API] Reporte ${id} excluído por ${req.user.email}`);
        res.json({ success: true, message: 'Reporte excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir reporte:', error);
        res.status(500).json({ error: 'Erro ao excluir reporte' });
    }
});

app.get('/api/comments', verifyAdmin, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 200, 1000);
        const snapshot = await db.collectionGroup('comments')
            .limit(limit)
            .get();
        const items = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            const cameraId = docSnap.ref.parent.parent.id;
            return {
                id: docSnap.id,
                cameraId,
                text: data.text || '',
                userDisplayName: data.userDisplayName || '',
                userId: data.userId || '',
                timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
            };
        }).sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
        });
        res.setHeader('Cache-Control', 'no-store');
        res.json(items);
    } catch (error) {
        console.error('Erro ao listar comentários:', error);
        res.status(500).json({ error: 'Erro ao listar comentários' });
    }
});

app.delete('/api/comment/:cameraId/:id', verifyAdmin, async (req, res) => {
    try {
        const { cameraId, id } = req.params;
        const ref = db.collection('cameras').doc(cameraId).collection('comments').doc(id);
        const docSnap = await ref.get();
        if (!docSnap.exists) {
            return res.status(404).json({ error: 'Comentário não encontrado' });
        }
        await ref.delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao excluir comentário:', error);
        res.status(500).json({ error: 'Erro ao excluir comentário' });
    }
});

// Endpoint para Salvar Changelog (Admin Only)
app.post('/api/changelog', verifyAdmin, async (req, res) => {
    try {
        const { title, message } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'Título e Mensagem são obrigatórios' });
        }

        const date = new Date().toLocaleDateString('pt-BR');
        const changelogData = {
            title,
            message,
            date,
            active: true,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('changelog').add(changelogData);
        
        console.log(`[API] Changelog publicado por ${req.user.email}: ${title}`);
        res.json({ success: true, message: 'Novidade publicada com sucesso!', id: docRef.id });
    } catch (error) {
        console.error('Erro ao salvar changelog:', error);
        res.status(500).json({ error: 'Erro ao publicar novidade' });
    }
});

// Logging simples de requisições
app.use((req, res, next) => {
    METRICS.requestCount++;
    const start = Date.now();
    res.on('finish', () => {
        if (res.statusCode >= 500) METRICS.errorsCount++;
        const duration = Date.now() - start;
        METRICS.totalRequestDurationMs += duration;
        METRICS.lastRequestAt = Date.now();
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// --- SSR: Renderização do Lado do Servidor para Câmeras ---
// OTIMIZAÇÃO: Ler o template apenas uma vez na inicialização para performance
// NOTA: Para desenvolvimento, vamos ler sempre o arquivo para refletir mudanças
let cameraTemplate = '';
try {
    cameraTemplate = fs.readFileSync(path.join(PUBLIC_FOLDER, 'camera.html'), 'utf8');
} catch (err) {
    console.error('Erro fatal ao ler o template camera.html na inicialização:', err);
}

const serveCameraPage = (req, res) => {
    // Tenta pegar o código da query string ou dos parâmetros da URL
    const code = req.query.code || req.params.code;

    // Determinar a URL base dinamicamente 
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    // SEMPRE ler o arquivo atualizado para garantir que mudanças no HTML sejam refletidas
    let html = '';
    try {
        html = fs.readFileSync(path.join(PUBLIC_FOLDER, 'camera.html'), 'utf8');
    } catch (err) {
        console.error('Erro ao ler camera.html:', err);
        return res.status(500).send('Erro interno ao carregar a página.');
    }
    
    // Incrementa visualização para essa câmera
    METRICS.viewsToday++;
    METRICS.totalViews++;
    if (code) {
        METRICS.topCameras[code] = (METRICS.topCameras[code] || 0) + 1;
    }

    // --- CORREÇÃO CRÍTICA 1: Base Tag --- 
    // Isso força o navegador a carregar CSS/JS/Imagens a partir da raiz, 
    // corrigindo o erro de carregamento na rota /camera/1001 
    if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n    <base href="${baseUrl}/">`);
    }

    // Tenta encontrar a câmera no cache ou na lista completa 
    const camera = cachedCameraStatus.find(c => c.codigo === code) || cameraInfo.find(c => c.codigo === code);

    // SEGURANÇA: Bloquear acesso a câmeras de nível 3 (ocultas/privadas)
    if (camera && camera.level === 3) {
        return res.redirect('/');
    }

    if (camera) {
        const title = `🔴 Ao Vivo: ${camera.nome} | Câmeras Rio Branco`;
        const description = `Assista agora às imagens em tempo real da câmera ${camera.nome}. Monitoramento de trânsito e segurança 24h em Rio Branco, Acre.`;
        const canonicalUrl = `${baseUrl}/camera/${camera.codigo}`;
        
        // CORREÇÃO: Forçar barra inicial (/) se usar caminho relativo, ou usar baseUrl completo 
        // Lógica Inteligente de Imagem:
        // 1. Se estiver ONLINE, usa o proxy com timestamp.
        // 2. Se estiver OFFLINE, usa diretamente a imagem estática de erro.
        const imageUrl = camera.status === 'online'
            ? `${baseUrl}/proxy/camera/${camera.codigo}?t=${Date.now()}`
            : `${baseUrl}/assets/offline.png`;

        const imageAlt = `Ao Vivo: ${camera.nome}`;
        const imageWidth = '1280';
        const imageHeight = '720';
        const imageType = 'image/jpeg';
        
        // Determina o status para injeção no HTML 
        const isOnline = camera.status === 'online';
        const statusText = isOnline ? 'Online' : 'Offline';
        const statusColorClass = isOnline ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-red-500 font-bold';
        const dotColorClass = isOnline ? 'bg-emerald-500' : 'bg-red-500';
        const pingClass = isOnline ? 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75' : 'hidden';

        // Substituição de Meta Tags
        html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
        html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${description}">`);
        html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonicalUrl}">`);
        
        // Open Graph 
        html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`);
        html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${description}">`);
        html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonicalUrl}">`);
        html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${imageUrl}">`);
        html = html.replace(/<meta property="og:image:secure_url" content="[^"]*">/, `<meta property="og:image:secure_url" content="${imageUrl}">`);
        html = html.replace(/<meta property="og:image:type" content="[^"]*">/, `<meta property="og:image:type" content="${imageType}">`);
        html = html.replace(/<meta property="og:image:width" content="[^"]*">/, `<meta property="og:image:width" content="${imageWidth}">`);
        html = html.replace(/<meta property="og:image:height" content="[^"]*">/, `<meta property="og:image:height" content="${imageHeight}">`);
        
        // Twitter 
        html = html.replace(/<meta property="twitter:title" content="[^"]*">/, `<meta property="twitter:title" content="${title}">`);
        html = html.replace(/<meta property="twitter:description" content="[^"]*">/, `<meta property="twitter:description" content="${description}">`);
        html = html.replace(/<meta property="twitter:url" content="[^"]*">/, `<meta property="twitter:url" content="${canonicalUrl}">`);
        html = html.replace(/<meta property="twitter:image" content="[^"]*">/, `<meta property="twitter:image" content="${imageUrl}">`);
        html = html.replace(/<meta name="twitter:image:alt" content="[^"]*">/, `<meta name="twitter:image:alt" content="${imageAlt}">`);

        // INJEÇÃO DE STATUS NO HTML (SSR) 
        html = html.replace('Verificando status...', statusText);
        html = html.replace('text-sm font-medium text-gray-500 dark:text-gray-400 tracking-wide', `text-sm font-medium ${statusColorClass} tracking-wide`);
        html = html.replace('bg-gray-300 dark:bg-gray-600', dotColorClass);
        html = html.replace('animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 hidden', pingClass);

        // --- CORREÇÃO CRÍTICA 2: Injeção do Código para o Javascript do Frontend --- 
        // Se o seu app.js no frontend procura por ?code= na URL, ele vai falhar na rota limpa. 
        // Vamos injetar o código numa variável global para o JS usar. 
        if (html.includes('</head>')) { 
             html = html.replace('</head>', `<script>window.SERVER_CAM_CODE = "${code}";</script>\n</head>`); 
        } 

        // Adiciona as meta tags faltantes se não existirem
        if (!/og:image:type/.test(html)) {
            html = html.replace('</head>', `<meta property="og:image:type" content="${imageType}">\n</head>`);
        }
        if (!/og:image:width/.test(html)) {
            html = html.replace('</head>', `<meta property="og:image:width" content="${imageWidth}">\n</head>`);
        }
        if (!/og:image:height/.test(html)) {
            html = html.replace('</head>', `<meta property="og:image:height" content="${imageHeight}">\n</head>`);
        }
        if (!/twitter:image:alt/.test(html)) {
            html = html.replace('</head>', `<meta name="twitter:image:alt" content="${imageAlt}">\n</head>`);
        }

        // INJEÇÃO DE JSON-LD ESTRUTURADO PARA VÍDEO/LOCAL
        const jsonLd = {
            "@context": "https://schema.org",
            "@type": "VideoObject",
            "name": title,
            "description": description,
            "thumbnailUrl": [imageUrl],
            "uploadDate": new Date().toISOString(),
            "contentUrl": `${baseUrl}/proxy/camera/${camera.codigo}`,
            "embedUrl": canonicalUrl,
            "interactionStatistic": {
                "@type": "InteractionCounter",
                "interactionType": { "@type": "WatchAction" },
                "userInteractionCount": 1000
            }
        };
        
        html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`);

        // Injeta o src inicial 
        // Nota: O uso de baseUrl aqui na string garante caminho absoluto 
        const initialFeedSrc = isOnline ? `${baseUrl}/proxy/camera/${camera.codigo}` : `${baseUrl}/assets/offline.png`; 
        html = html.replace(/<img id="camera-feed" src="[^"]*"/, `<img id="camera-feed" src="${initialFeedSrc}"`); 
    }

    res.send(html);
};

// Rotas que usam SSR (devem vir ANTES do express.static)
app.get('/camera.html', serveCameraPage);

app.get('/camera', (req, res) => {
    // Redireciona /camera?code=XXXXXX para /camera/XXXXXX
    if (req.query.code && /^\d{6}$/.test(req.query.code)) {
        return res.redirect(301, `/camera/${req.query.code}`);
    }
    return res.redirect(301, '/');
});

// Suporte a URLs amigáveis (/camera/XXXXXX) usando SSR diretamente
app.get('/camera/:code', (req, res) => {
    const code = req.params.code;
    if (!/^\d{6}$/.test(code)) return res.redirect('/');
    // Chama a função SSR diretamente, passando o req que agora pode ter req.params.code lido
    serveCameraPage(req, res);
});

// Rota para sitemap.xml dinâmico
app.get('/sitemap.xml', (req, res) => {
    res.header('Content-Type', 'application/xml');

    const baseUrl = 'https://camerasriobranco.site';
    const lastMod = new Date().toISOString().split('T')[0];

    let xml = '<?xml version="1.0" encoding="UTF-8"?>';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

    // Páginas estáticas
    xml += `
    <url>
        <loc>${baseUrl}/</loc>
        <lastmod>${lastMod}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>${baseUrl}/mapa.html</loc>
        <lastmod>${lastMod}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>${baseUrl}/metrics.html</loc>
        <lastmod>${lastMod}</lastmod>
        <changefreq>hourly</changefreq>
        <priority>0.3</priority>
    </url>
    <url>
        <loc>${baseUrl}/sobre.html</loc>
        <lastmod>${lastMod}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.5</priority>
    </url>
    <url>
        <loc>${baseUrl}/novidades</loc>
        <lastmod>${lastMod}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.7</priority>
    </url>`;

    // Páginas dinâmicas das câmeras
    // Prioriza câmeras do Cache (cachedCameraStatus) pois já contém o status online/offline atualizado e o merge com cameraInfo
    const camerasToIndex = cachedCameraStatus.length > 0 ? cachedCameraStatus : cameraInfo;

    camerasToIndex.forEach(camera => {
        // Ignora câmeras de Nível 3 (Privadas) no Sitemap
        if (camera.level === 3) return;

        if (camera.codigo) {
            const isOnline = camera.status === 'online';
            const priority = isOnline ? '0.9' : '0.6';
            const changefreq = isOnline ? 'always' : 'hourly';

            xml += `
            <url>
                <loc>${baseUrl}/camera/${camera.codigo}</loc>
                <lastmod>${lastMod}</lastmod>
                <changefreq>${changefreq}</changefreq>
                <priority>${priority}</priority>
            </url>`;
        }
    });

    xml += '</urlset>';
    res.send(xml);
});

// O express.static serve os arquivos da pasta 'public'
app.use(express.static(PUBLIC_FOLDER));

// --- Rotas de Páginas Públicas ---
app.get('/novidades', (req, res) => {
    res.sendFile(path.join(PUBLIC_FOLDER, 'novidades.html'));
});

// Rota de fallback para universal link deep-link (Removida pois agora é tratada pelo SSR acima)
// app.get('/camera', (req, res) => { ... });



// Apple Universal Links: apple-app-site-association
app.get(['/apple-app-site-association', '/.well-known/apple-app-site-association'], (req, res) => {
    const teamId = process.env.APPLE_TEAM_ID;
    const bundleId = process.env.IOS_BUNDLE_ID;
    const details = (teamId && bundleId) ? [{ appID: `${teamId}.${bundleId}`, paths: ["/camera*", "/camera.html*", "/camerasite*"] }] : [];
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ applinks: { apps: [], details } }));
});


// --- Lógica de Carregamento de Metadados do FIRESTORE ---
async function loadCameraInfoFromFirestore() {
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('cameras').get();

        if (snapshot.empty) {
            console.warn("[WARN] Coleção 'cameras' no Firestore está vazia.");
            cameraInfo = [];
            return;
        }

        cameraInfo = snapshot.docs.map(doc => doc.data());
        console.log(`✔ ${cameraInfo.length} informações de câmeras carregadas do Firestore.`);

        // Carregar configurações do site
        const configDoc = await db.collection('site_config').doc('global').get();
        if (configDoc.exists) {
            siteConfig = { ...siteConfig, ...configDoc.data() };
            console.log("✔ Configurações do site carregadas:", siteConfig);
        } else {
            console.log("ℹ Nenhuma configuração salva encontrada. Usando padrão.");
            // Criar documento padrão se não existir
            await db.collection('site_config').doc('global').set(siteConfig);
        }

    } catch (error) {
        console.error("[FIRESTORE_LOAD_ERROR] Não foi possível carregar informações do Firestore.", error);
        cameraInfo = [];
    }
}

// Middlewares moved up


// --- Rotas de Configuração (Site Config) ---
app.get('/api/site-config', (req, res) => {
    res.json(siteConfig);
});

app.post('/api/site-config', verifyAdmin, async (req, res) => {
    try {
        const newConfig = req.body;
        // Validar campos permitidos
        if (typeof newConfig.showAppBanner === 'boolean') {
            siteConfig.showAppBanner = newConfig.showAppBanner;
            
            // Persistir no Firestore
            await db.collection('site_config').doc('global').set(siteConfig, { merge: true });
            
            console.log(`[CONFIG] Configuração atualizada por ${req.user.email}:`, siteConfig);
            res.json({ success: true, config: siteConfig });
        } else {
            res.status(400).json({ message: 'Parâmetros inválidos.' });
        }
    } catch (error) {
        console.error("Erro ao salvar configuração:", error);
        res.status(500).json({ message: 'Erro interno ao salvar configuração.' });
    }
});

// AI reset route removed

// --- Rotas da API ---

const proxyCameraHandler = async (req, res) => {
    const code = req.params.code || req.query.code;
    if (!code || !/^\d{6}$/.test(code)) {
        return res.status(400).send('Código da câmera inválido.');
    }

    // SEGURANÇA: Verificar se a câmera é restrita (Nível 3)
    // Busca nas informações carregadas (cameraInfo)
    const camera = cameraInfo.find(c => c.codigo === code);
    if (camera && camera.level === 3) {
        // Se a câmera for restrita, verificamos se há um token de admin na query
        const token = req.query.token;
        let isAdmin = false;

        if (token) {
            try {
                const decodedToken = await admin.auth().verifyIdToken(token);
                if (decodedToken.email === ADMIN_EMAIL) {
                    isAdmin = true;
                }
            } catch (error) {
                // Token inválido, mantém isAdmin = false
            }
        }

        if (!isAdmin) {
            return res.status(403).send('Acesso negado a esta câmera.');
        }
    }

    const url = `https://cameras.riobranco.ac.gov.br/api/camera?code=${code}&timestamp=${Date.now()}`;
    try {
        const response = await axios.get(url, { 
            responseType: 'arraybuffer', 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                'Referer': 'https://deolhonotransito.riobranco.ac.gov.br',
                'Origin': 'https://deolhonotransito.riobranco.ac.gov.br',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'same-site'
            }
        });
        const sizeInKB = Buffer.byteLength(response.data) / 1024;
        if (sizeInKB < 22) {
            return res.status(404).sendFile(ERROR_IMAGE_PATH);
        }
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.send(response.data);
        METRICS.proxySuccesses++;
        METRICS.lastProxySuccessAt = Date.now();
    } catch (error) {
        METRICS.proxyFailures++;
        METRICS.lastProxyFailureAt = Date.now();
        res.status(502).sendFile(ERROR_IMAGE_PATH);
    }
};

app.get('/proxy/camera', proxyCameraHandler);
app.get('/proxy/camera/:code', proxyCameraHandler);

// --- Endpoints de Monitoramento ---
app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const avgRequestMs = METRICS.requestCount ? Math.round(METRICS.totalRequestDurationMs / METRICS.requestCount) : 0;
    const onlineCount = cachedCameraStatus.filter(c => c.status === 'online').length;
    res.json({
        status: 'ok',
        isScanning,
        nextScanTimestamp,
        scanTimeoutOccurred,
        cachedCount: cachedCameraStatus.length,
        cameraInfoCount: cameraInfo.length,
        onlineCount,
        uptimeMs: Date.now() - METRICS.startTime,
        metrics: {
            requestCount: METRICS.requestCount,
            errorsCount: METRICS.errorsCount,
            proxySuccesses: METRICS.proxySuccesses,
            proxyFailures: METRICS.proxyFailures,
            avgRequestMs,
            lastRequestAt: METRICS.lastRequestAt,
            lastProxySuccessAt: METRICS.lastProxySuccessAt,
            lastProxyFailureAt: METRICS.lastProxyFailureAt
        }
    });
});

app.get('/api/simple-metrics', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(METRICS);
});


// ESTA ROTA FOI MANTIDA E FUNCIONA EXATAMENTE COMO ANTES PARA O SEU APLICATIVO
app.get('/status-cameras', verifyOptionalAdmin, (req, res) => {
    // Injeta views atuais antes de enviar
    const camerasWithViews = cachedCameraStatus.map(cam => ({
        ...cam,
        views: METRICS.topCameras[cam.codigo] || 0
    }));

    if (req.userIsAdmin) {
        res.json(camerasWithViews);
    } else {
        const publicCameras = camerasWithViews.filter(camera => camera.level === 1 || !camera.level);
        res.json(publicCameras);
    }
});

app.get('/api/sync-info', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        updateInterval: CONFIG.UPDATE_INTERVAL_MS,
        nextScanTimestamp: nextScanTimestamp,
        scanTimeoutOccurred: scanTimeoutOccurred,
    });
});

// --- ROTA DE ATUALIZAÇÃO MODIFICADA PARA USAR O FIRESTORE ---
app.post('/api/update-camera-info', verifyAdmin, async (req, res) => {
    const { codigo, nome, categoria, descricao, coords, level } = req.body;

    // Validação de Campos Obrigatórios
    if (!codigo || !nome) {
        return res.status(400).json({ message: 'Código e nome são obrigatórios.' });
    }

    // Validação de Coordenadas (se fornecidas)
    let validCoords = null;
    if (coords) {
        if (Array.isArray(coords) && coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
            validCoords = coords.map(Number);
        } else {
            return res.status(400).json({ message: 'Coordenadas inválidas. Formato esperado: [lat, lng].' });
        }
    }

    // Validação de Nível de Acesso
    const validLevel = Number(level);
    if (isNaN(validLevel) || validLevel < 1 || validLevel > 3) {
        return res.status(400).json({ message: 'Nível de acesso inválido (1-3).' });
    }

    try {
        console.log(`[AUDIT] Usuário ${req.user.email} está atualizando câmera ${codigo}...`);
        const db = admin.firestore();
        const cameraRef = db.collection('cameras').doc(codigo);

        // Verifica se a descrição mudou para bloquear a IA
        const doc = await cameraRef.get();
        const currentData = doc.exists ? doc.data() : {};
        
        const updatedData = {
            codigo,
            nome,
            categoria,
            descricao: descricao || '',
            coords: validCoords,
            level: validLevel,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.user.email
        };

        await cameraRef.set(updatedData, { merge: true });

        console.log(`[AUDIT] Câmera ${codigo} atualizada com sucesso por ${req.user.email}.`);

        await loadCameraInfoFromFirestore();
        const currentStatuses = cachedCameraStatus.map(c => ({ codigo: c.codigo, status: c.status }));
        updateStatusCache(currentStatuses);

        res.status(200).json({ message: 'Informações da câmera atualizadas com sucesso!' });

    } catch (error) {
        console.error('[FIRESTORE_UPDATE_ERROR]', error);
        res.status(500).json({ message: 'Erro ao salvar as informações no Firestore.' });
    }
});


// --- ROTA DE RASTREAMENTO DE VISITAS ---
app.post('/api/track-visit', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const statsRef = db.collection('stats').doc('traffic');
        const dailyRef = statsRef.collection('daily').doc(today);

        await db.runTransaction(async (t) => {
            const statsDoc = await t.get(statsRef);
            const dailyDoc = await t.get(dailyRef);

            // Update Total Views
            const currentTotal = statsDoc.exists ? (statsDoc.data().totalViews || 0) : 0;
            t.set(statsRef, { totalViews: currentTotal + 1 }, { merge: true });

            // Update Daily Views
            const currentDaily = dailyDoc.exists ? (dailyDoc.data().views || 0) : 0;
            t.set(dailyRef, { views: currentDaily + 1 }, { merge: true });
        });

        res.status(200).send();
    } catch (error) {
        console.error('Erro ao registrar visita:', error);
        res.status(500).send();
    }
});

app.get('/api/traffic', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const statsRef = db.collection('stats').doc('traffic');
        const [statsDoc, dailyDoc] = await Promise.all([
            statsRef.get(),
            statsRef.collection('daily').doc(today).get()
        ]);
        const totalViews = statsDoc.exists ? (statsDoc.data().totalViews || 0) : 0;
        const viewsToday = dailyDoc.exists ? (dailyDoc.data().views || 0) : 0;
        res.json({ totalViews, viewsToday });
    } catch (error) {
        console.error('Erro ao obter métricas de tráfego:', error);
        res.status(500).json({ message: 'Erro ao obter métricas de tráfego.' });
    }
});

// Nova Rota para Dados do Dashboard
app.get('/api/dashboard-data', verifyAdmin, async (req, res) => {
    try {
        // Dados de Usuários
        const listUsersResult = await admin.auth().listUsers(1000); // Limite de 1000 por enquanto
        const users = listUsersResult.users;
        
        const totalUsers = users.length;
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        // Filtra usuários ativos nas últimas 24h (baseado no lastSignInTime)
        const activeUsers24h = users.filter(user => {
            const lastSign = new Date(user.metadata.lastSignInTime).getTime();
            return lastSign > oneDayAgo;
        }).length;

        // Prepara dados para o gráfico de novos usuários (últimos 7 dias)
        const signupsByDay = { labels: [], values: [] };
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); // dd/mm
            signupsByDay.labels.push(dateStr);
            
            // Conta usuários criados neste dia
            const startOfDay = new Date(d.setHours(0,0,0,0)).getTime();
            const endOfDay = new Date(d.setHours(23,59,59,999)).getTime();
            
            const count = users.filter(u => {
                const created = new Date(u.metadata.creationTime).getTime();
                return created >= startOfDay && created <= endOfDay;
            }).length;
            signupsByDay.values.push(count);
        }

        // Últimos 5 usuários cadastrados
        const recentUsers = users
            .sort((a, b) => new Date(b.metadata.creationTime) - new Date(a.metadata.creationTime))
            .slice(0, 5)
            .map(u => ({
                email: u.email,
                creationTime: u.metadata.creationTime,
                lastSignInTime: u.metadata.lastSignInTime
            }));

        // Dados de Câmeras
        const totalCameras = cachedCameraStatus.length || cameraInfo.length;

        // Processa Top Câmeras para o Dashboard
        // Ordena o objeto METRICS.topCameras
        const sortedTopCameras = Object.entries(METRICS.topCameras)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([code, views]) => {
                const info = cameraInfo.find(c => c.codigo === code);
                return {
                    codigo: code,
                    nome: info ? info.nome : `Câmera ${code}`,
                    views: views
                };
            });

        // Dados de Categorias
        const categories = {};
        cameraInfo.forEach(cam => {
            const cat = cam.categoria || 'Outros';
            categories[cat] = (categories[cat] || 0) + 1;
        });
        
        const categoryData = {
            labels: Object.keys(categories),
            values: Object.values(categories)
        };

        const todayStr = new Date().toISOString().split('T')[0];
        const trafficRef = db.collection('stats').doc('traffic');
        const [trafficDoc, trafficDailyDoc] = await Promise.all([
            trafficRef.get(),
            trafficRef.collection('daily').doc(todayStr).get()
        ]);
        const totalViewsCount = trafficDoc.exists ? (trafficDoc.data().totalViews || 0) : 0;
        const viewsTodayCount = trafficDailyDoc.exists ? (trafficDailyDoc.data().views || 0) : 0;

        res.json({
            totalUsers,
            activeUsers24h,
            totalCameras,
            recentUsers,
            signupsByDay,
            categoryData,
            viewsToday: viewsTodayCount,
            totalViews: totalViewsCount,
            topCameras: sortedTopCameras
        });

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard:", error);
        res.status(500).json({ message: "Erro interno ao buscar dados." });
    }
});

// --- Lógica de Verificação de Câmeras (sem alterações) ---
async function checkCameraStatus(code, signal) {
    const url = `https://cameras.riobranco.ac.gov.br/api/camera?code=${code}&timestamp=${Date.now()}`;
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: CONFIG.REQUEST_TIMEOUT,
            signal: signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                'Referer': 'https://deolhonotransito.riobranco.ac.gov.br',
                'Origin': 'https://deolhonotransito.riobranco.ac.gov.br',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });
        const isOnline = Buffer.byteLength(response.data) > 22 * 1024;
        return { codigo: code, status: isOnline ? 'online' : 'offline' };
    } catch (error) {
        if (error.name !== 'AbortError' && error.code !== 'ECONNABORTED') {
            // console.error(`[CHECK_ERROR] Câmera ${code}: ${error.message}`);
        }
        return { codigo: code, status: 'offline' };
    }
}

function updateStatusCache(statuses) {
    cachedCameraStatus = statuses.map(status => {
        const info = cameraInfo.find(info => info.codigo === status.codigo);
        return {
            ...status,
            nome: info ? info.nome : `Câmera ${status.codigo}`,
            categoria: info ? info.categoria : "Sem Categoria",
            coords: info ? info.coords : null,
            descricao: info ? info.descricao : "",
            level: info ? info.level : 1
        };
    }).sort((a, b) => (a.status === 'online' ? -1 : 1) - (b.status === 'online' ? -1 : 1) || a.nome.localeCompare(b.nome));
}

async function scanAllCameras() {
    if (isScanning) return;
    isScanning = true;
    scanTimeoutOccurred = false;
    console.log(`[${new Date().toLocaleTimeString()}] Iniciando varredura...`);
    const startTime = Date.now();
    const controller = new AbortController();
    const scanningPromise = (async () => {
        const codes = Array.from({ length: CONFIG.CAMERA_CODE_END - CONFIG.CAMERA_CODE_START + 1 }, (_, i) => (CONFIG.CAMERA_CODE_START + i).toString().padStart(6, '0'));
        const allStatuses = [];
        for (let i = 0; i < codes.length; i += CONFIG.CONCURRENCY_LIMIT) {
            if (controller.signal.aborted) break;
            const batch = codes.slice(i, i + CONFIG.CONCURRENCY_LIMIT);
            const promises = batch.map(code => checkCameraStatus(code, controller.signal));
            const results = await Promise.allSettled(promises);
            results.forEach(result => {
                if (result.status === 'fulfilled') allStatuses.push(result.value);
            });
        }
        return allStatuses;
    })();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Scan timeout')), CONFIG.SCAN_TIMEOUT_MS));
    try {
        const allStatuses = await Promise.race([scanningPromise, timeoutPromise]);
        updateStatusCache(allStatuses);
        const duration = (Date.now() - startTime) / 1000;
        console.log(`✔ Varredura concluída em ${duration.toFixed(2)}s. ${cachedCameraStatus.filter(c => c.status === 'online').length} câmeras online encontradas.`);
    } catch (error) {
        if (error.message === 'Scan timeout') {
            console.warn(`[TIMEOUT] A varredura excedeu ${CONFIG.SCAN_TIMEOUT_MS / 1000}s. Abortando...`);
            controller.abort();
            scanTimeoutOccurred = true;
        } else {
            console.error('[SCAN_ERROR] Erro inesperado:', error);
        }
    } finally {
        isScanning = false;
    }
}

// --- Agendador e Inicialização ---
function runScheduledScan() {
    scanAllCameras().finally(() => {
        const delay = scanTimeoutOccurred ? CONFIG.SCAN_RETRY_DELAY_MS : CONFIG.UPDATE_INTERVAL_MS;
        console.log(`Próxima varredura em ${delay / 1000}s.`);
        nextScanTimestamp = Date.now() + delay;
        setTimeout(runScheduledScan, delay);
    });
}

// --- Clean URL Routes ---
app.get('/camera/:code', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'camera.html')));
app.get('/camera', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'camera.html')));
app.get('/embed/:id', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'embed.html')));
app.get('/sobre', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'sobre.html')));
app.get('/mapa', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'mapa.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'login.html')));
app.get('/metrics', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'metrics.html')));
app.get('/termos', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'termos.html')));
app.get('/perfil', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'perfil.html')));
app.get('/novidades', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'novidades.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'dashboard.html')));
app.get('/index', (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, 'index.html')));

// --- 404 Handler (Catch-all) ---
app.use((req, res) => {
    res.status(404).sendFile(path.join(PUBLIC_FOLDER, '404.html'));
});

async function startServer() {
    await loadCameraInfoFromFirestore();

    const server = app.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Servidor rodando!`);
        console.log(`Local:   http://localhost:${CONFIG.PORT}`);

        // Mostrar IP da rede para acesso externo
        const { networkInterfaces } = require('os');
        const nets = networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                // Pular endereços internos e não IPv4
                if (net.family === 'IPv4' && !net.internal) {
                    console.log(`Rede:    http://${net.address}:${CONFIG.PORT} (${name})`);
                }
            }
        }
        console.log('\n');
        runScheduledScan();
    });

    process.on('SIGINT', () => {
        console.log('\nDesligando servidor...');
        server.close(() => process.exit(isScanning ? 1 : 0));
    });
}

startServer();
