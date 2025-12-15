const express = require('express');
const axios = require('axios');
const cors = require('cors');
// Mudança: Usar o módulo fs normal, não o de promises
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const admin = require('firebase-admin');

// --- INÍCIO: CONFIGURAÇÃO SEGURA DO FIREBASE ADMIN ---
try {
    // Verifica se está rodando no Render (onde o arquivo fica em /etc/secrets/) 
    // Se não achar lá, procura na pasta local (./) 
    const secretPath = fs.existsSync('/etc/secrets/serviceAccountKey.json')
        ? '/etc/secrets/serviceAccountKey.json'
        : './serviceAccountKey.json';

    console.log(`✔ Carregando credenciais do Firebase de: ${secretPath}`);
    const serviceAccount = JSON.parse(fs.readFileSync(secretPath, 'utf8'));

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✔ Firebase Admin SDK inicializado com sucesso.");

    // Inicializa o Firestore
    const db = admin.firestore();
    console.log("✔ Firebase Firestore inicializado.");

} catch (error) {
    console.error("[ERRO CRÍTICO] Falha ao inicializar o Firebase Admin SDK.", error);
    process.exit(1);
}
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "vgabvictor@gmail.com";
// --- FIM: CONFIGURAÇÃO DO FIREBASE ADMIN ---


// --- Configurações Centralizadas ---
const CONFIG = {
    PORT: process.env.PORT || 3001,
    UPDATE_INTERVAL_MS: 1 * 60 * 1000,
    CONCURRENCY_LIMIT: 15,
    CAMERA_CODE_START: 1000,
    CAMERA_CODE_END: 1500,
    REQUEST_TIMEOUT: 8000,
    MIN_IMAGE_SIZE_KB: 22,
    SCAN_TIMEOUT_MS: 300 * 1000,
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
    lastProxyFailureAt: null
};


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

// Configuração de Segurança com Helmet (SIMPLIFICADA PARA LOCALHOST)
// NOTA: CSP desativada para permitir carregamento de todos os recursos (Anúncios, Scripts externos, etc)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
}));

app.use(cors());
app.use(express.json());

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
    const code = req.query.code;

    // Determinar a URL base dinamicamente (para suportar localhost e produção)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    // SEMPRE ler o arquivo atualizado para garantir que mudanças no HTML sejam refletidas
    // Em produção, isso poderia ser revertido para usar o cache 'cameraTemplate'
    let html = '';
    try {
        html = fs.readFileSync(path.join(PUBLIC_FOLDER, 'camera.html'), 'utf8');
    } catch (err) {
        console.error('Erro ao ler camera.html:', err);
        return res.status(500).send('Erro interno ao carregar a página.');
    }

    // Tenta encontrar a câmera no cache ou na lista completa
    const camera = cachedCameraStatus.find(c => c.codigo === code) || cameraInfo.find(c => c.codigo === code);

    if (camera) {
        const title = `🔴 Ao Vivo: ${camera.nome} | Câmeras Rio Branco`;
        const description = `Assista agora às imagens em tempo real da câmera ${camera.nome}. Monitoramento de trânsito e segurança 24h em Rio Branco, Acre.`;
        const canonicalUrl = `${baseUrl}/camera/${camera.codigo}`;
        const requestedUrl = `${baseUrl}${req.originalUrl}`;
        
        // Lógica Inteligente de Imagem:
        // 1. Se estiver ONLINE, usa o proxy com timestamp para "quebrar" o cache do WhatsApp/Telegram e mostrar a imagem atual.
        // 2. Se estiver OFFLINE, usa diretamente a imagem estática de erro, economizando requisições.
        const imageUrl = camera.status === 'online'
            ? `${baseUrl}/proxy/camera?code=${camera.codigo}&t=${Date.now()}`
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

        // Substituição Simples de Meta Tags
        html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
        html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${description}">`);
        html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonicalUrl}">`);
        html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`);
        html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${description}">`);
        html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonicalUrl}">`);
        html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${imageUrl}">`);
        html = html.replace(/<meta property="og:image:secure_url" content="[^"]*">/, `<meta property="og:image:secure_url" content="${imageUrl}">`);
        html = html.replace(/<meta property="og:image:type" content="[^"]*">/, `<meta property="og:image:type" content="${imageType}">`);
        html = html.replace(/<meta property="og:image:width" content="[^"]*">/, `<meta property="og:image:width" content="${imageWidth}">`);
        html = html.replace(/<meta property="og:image:height" content="[^"]*">/, `<meta property="og:image:height" content="${imageHeight}">`);
        html = html.replace(/<meta property="twitter:title" content="[^"]*">/, `<meta property="twitter:title" content="${title}">`);
        html = html.replace(/<meta property="twitter:description" content="[^"]*">/, `<meta property="twitter:description" content="${description}">`);
        html = html.replace(/<meta property="twitter:url" content="[^"]*">/, `<meta property="twitter:url" content="${canonicalUrl}">`);
        html = html.replace(/<meta property="twitter:image" content="[^"]*">/, `<meta property="twitter:image" content="${imageUrl}">`);
        html = html.replace(/<meta name="twitter:image:alt" content="[^"]*">/, `<meta name="twitter:image:alt" content="${imageAlt}">`);

        // INJEÇÃO DE STATUS NO HTML (SSR)
        // Substitui o texto "Verificando status..."
        html = html.replace('Verificando status...', statusText);
        // Substitui a classe do subtítulo (cor do texto)
        html = html.replace('text-sm font-medium text-gray-500 dark:text-gray-400 tracking-wide', `text-sm font-medium ${statusColorClass} tracking-wide`);
        // Substitui a classe do ponto de status (dot)
        html = html.replace('bg-gray-300 dark:bg-gray-600', dotColorClass);
        // Substitui a classe do ping (mostra se online)
        html = html.replace('animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 hidden', pingClass);

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

        // Injeta o src inicial do feed para evitar estado estranho no carregamento
        // Se estiver offline, já carrega a imagem offline direto
        const initialFeedSrc = isOnline ? `/proxy/camera?code=${camera.codigo}` : `${baseUrl}/assets/offline.png`;
        html = html.replace(/<img id="camera-feed" src="[^"]*"/, `<img id="camera-feed" src="${initialFeedSrc}"`);
    }

    res.send(html);
};

// Rotas que usam SSR (devem vir ANTES do express.static)
app.get('/camera.html', serveCameraPage);
app.get('/camera', serveCameraPage);

// Suporte a caminho /camera/:code com SSR direto (Sem redirect para query)
// Isso melhora o SEO ao manter a URL limpa e única.
app.get('/camera/:code', (req, res) => {
    const code = req.params.code;
    if (!/^\d{6}$/.test(code)) return res.redirect('/camera');

    // Injeta o código na query para reutilizar a lógica de serveCameraPage
    req.query.code = code;
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
    </url>`;

    // Páginas dinâmicas das câmeras
    // Prioriza câmeras do Cache (cachedCameraStatus) pois já contém o status online/offline atualizado e o merge com cameraInfo
    const camerasToIndex = cachedCameraStatus.length > 0 ? cachedCameraStatus : cameraInfo;

    camerasToIndex.forEach(camera => {
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

// Rota de fallback para universal link deep-link (Removida pois agora é tratada pelo SSR acima)
// app.get('/camera', (req, res) => { ... });

// Suporte a caminho /camera/:code com SSR direto
app.get('/camera/:code', (req, res) => {
    const code = req.params.code;
    if (!/^\d{6}$/.test(code)) return res.redirect('/camera');
    req.query.code = code;
    serveCameraPage(req, res);
});

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

    } catch (error) {
        console.error("[FIRESTORE_LOAD_ERROR] Não foi possível carregar informações do Firestore.", error);
        cameraInfo = [];
    }
}

// --- Middlewares de Autenticação (sem alterações) ---
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


// --- Rotas da API ---

app.get('/proxy/camera', async (req, res) => {
    const { code } = req.query;
    if (!code || !/^\d{6}$/.test(code)) {
        return res.status(400).send('Código da câmera inválido.');
    }
    const url = `https://cameras.riobranco.ac.gov.br/api/camera?code=${code}`;
    try {
        const response = await axios.get(url, { responseType: 'stream', timeout: 8000 });
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
        METRICS.proxySuccesses++;
        METRICS.lastProxySuccessAt = Date.now();
    } catch (error) {
        METRICS.proxyFailures++;
        METRICS.lastProxyFailureAt = Date.now();
        res.status(502).sendFile(ERROR_IMAGE_PATH);
    }
});

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

app.get('/metrics', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(METRICS);
});


// ESTA ROTA FOI MANTIDA E FUNCIONA EXATAMENTE COMO ANTES PARA O SEU APLICATIVO
app.get('/status-cameras', verifyOptionalAdmin, (req, res) => {
    if (req.userIsAdmin) {
        res.json(cachedCameraStatus);
    } else {
        const publicCameras = cachedCameraStatus.filter(camera => camera.level === 1 || !camera.level);
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


// --- ROTA DE DADOS PARA O DASHBOARD (sem alterações) ---
app.get('/api/dashboard-data', verifyAdmin, async (req, res) => {
    try {
        const listUsersResult = await admin.auth().listUsers(1000);
        const totalUsers = listUsersResult.users.length;
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const signupsByDay = { labels: [], values: Array(7).fill(0) };
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            signupsByDay.labels.push(date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit' }));
        }
        listUsersResult.users.forEach(user => {
            const creationTime = new Date(user.metadata.creationTime);
            const diffDays = Math.floor((today - creationTime) / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays < 7) {
                const index = 6 - diffDays;
                signupsByDay.values[index]++;
            }
        });
        res.json({ totalUsers, signupsByDay });
    } catch (error) {
        console.error('Erro ao buscar estatísticas de usuários:', error);
        res.status(500).json({ message: "Não foi possível carregar as estatísticas." });
    }
});

// --- Lógica de Verificação de Câmeras (sem alterações) ---
async function checkCameraStatus(code, signal) {
    const url = `https://cameras.riobranco.ac.gov.br/api/camera?code=${code}`;
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: CONFIG.REQUEST_TIMEOUT,
            signal: signal
        });
        const isOnline = Buffer.byteLength(response.data) > CONFIG.MIN_IMAGE_SIZE_KB * 1024;
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
