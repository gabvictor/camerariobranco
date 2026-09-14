/**
 * server.js — Bootstrap declarativo
 *
 * Este arquivo é uma Facade: apenas conecta as peças.
 * Toda lógica de negócio está na camada de Aplicação.
 * Toda persistência está na camada de Infraestrutura.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const axios = require('axios');
const os = require('os');

const PUBLIC_FOLDER = path.join(__dirname, 'public');
const ADMIN_VIEWS_FOLDER = path.join(__dirname, 'src', 'views', 'admin');
const ERROR_IMAGE_PATH = path.join(PUBLIC_FOLDER, 'assets', 'offline.png');

// ─── Infraestrutura ───────────────────────────────────────────────────────────
const { admin, db, ADMIN_EMAIL } = require('./src/config/firebaseAdmin');
const CONFIG = require('./src/config/appConfig');
const { tarpit, verifyAdminPageSession, isUserAdmin, parseCookies } = require('./src/middlewares/security');
const { getRioBrancoDateStr } = require('./src/utils/dateUtils');

const escapeXml = (unsafe) => {
    if (!unsafe) return '';
    return String(unsafe).replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

// Repositories (Infrastructure)
const FirebaseCameraRepository = require('./src/infrastructure/database/FirebaseCameraRepository');
const FirebaseReportRepository = require('./src/infrastructure/database/FirebaseReportRepository');
const FirebaseSponsorRepository = require('./src/infrastructure/database/FirebaseSponsorRepository');
const SponsorLogoUploadService = require('./src/infrastructure/services/SponsorLogoUploadService');

// Scanner (Strategy + Factory)
const ScannerFactory = require('./src/infrastructure/scanner/ScannerFactory');
const ScanScheduler = require('./src/infrastructure/scheduler/ScanScheduler');
const TimelapseScheduler = require('./src/infrastructure/scheduler/TimelapseScheduler');
const RioAcreService = require('./src/infrastructure/services/RioAcreService');
const systemLogger = require('./src/infrastructure/logging/SystemLogger');
const resourceMonitor = require('./src/infrastructure/services/ResourceMonitorService');

// ─── Aplicação ────────────────────────────────────────────────────────────────
const MetricsService = require('./src/application/services/MetricsService');
const CameraCache = require('./src/application/services/CameraCache');
const CreateReportUseCase = require('./src/application/use-cases/CreateReportUseCase');
const TrackVisitUseCase = require('./src/application/use-cases/TrackVisitUseCase');
const GetDashboardDataUseCase = require('./src/application/use-cases/GetDashboardDataUseCase');
const SponsorService = require('./src/application/services/SponsorService');
const ManageSponsorUseCase = require('./src/application/use-cases/ManageSponsorUseCase');
const GetSponsorPublicDataUseCase = require('./src/application/use-cases/GetSponsorPublicDataUseCase');

// ─── Apresentação ─────────────────────────────────────────────────────────────
const CameraController = require('./src/presentation/http/controllers/CameraController');
const ReportController = require('./src/presentation/http/controllers/ReportController');
const DashboardController = require('./src/presentation/http/controllers/DashboardController');
const SponsorController = require('./src/presentation/http/controllers/SponsorController');
const cameraRoutes = require('./src/presentation/http/routes/cameraRoutes');
const adminRoutes = require('./src/presentation/http/routes/adminRoutes');
const sponsorRoutes = require('./src/presentation/http/routes/sponsorRoutes');

// ─── Helper: SSR Theme Inlining (Zero Flash Visual de Tema) ───────────────────
const applySsrTheme = (html, req) => {
    const cookies = parseCookies(req);
    if (cookies.theme === 'dark') {
        return html
            .replace('<html lang="pt-br">', '<html lang="pt-br" class="dark">')
            .replace('<html lang="pt-BR">', '<html lang="pt-BR" class="dark">')
            .replace('<html>', '<html class="dark">');
    } else if (cookies.theme === 'light') {
        return html
            .replace('<html lang="pt-br" class="dark">', '<html lang="pt-br">')
            .replace('<html lang="pt-BR" class="dark">', '<html lang="pt-BR">')
            .replace('<html class="dark">', '<html>');
    }
    return html;
};

// ─── Composição (Dependency Injection manual) ─────────────────────────────────
const metrics = new MetricsService();
const cameraCache = new CameraCache();
const cameraRepo = new FirebaseCameraRepository(db);
const reportRepo = new FirebaseReportRepository(db);
const sponsorRepo = new FirebaseSponsorRepository(db);
const sponsorLogoUpload = new SponsorLogoUploadService(path.join(PUBLIC_FOLDER, 'uploads', 'sponsors'));
const sponsorService = new SponsorService(sponsorRepo, cameraRepo, metrics);
const manageSponsorUC = new ManageSponsorUseCase(sponsorRepo);
const getSponsorPublicDataUC = new GetSponsorPublicDataUseCase(sponsorRepo, cameraRepo);

const scanner = ScannerFactory.create();
const scheduler = new ScanScheduler(scanner);

const createReport = new CreateReportUseCase(reportRepo);
const trackVisit = new TrackVisitUseCase(db);
const dashboardUC = new GetDashboardDataUseCase(admin.auth(), cameraRepo, metrics, trackVisit);
const rioAcreService = new RioAcreService();
const timelapseScheduler = new TimelapseScheduler(cameraRepo, cameraCache, path.join(PUBLIC_FOLDER, 'timelapse'));

const cameraCtrl = new CameraController(cameraCache, metrics, cameraRepo, trackVisit)
    .setDb(db)
    .setSiteConfig({ showAppBanner: true })
    .setRioAcreService(rioAcreService)
    .setTimelapseScheduler(timelapseScheduler);

const reportCtrl = new ReportController(createReport, reportRepo).setDb(db);
const dashboardCtrl = new DashboardController(dashboardUC);
const sponsorCtrl = new SponsorController(sponsorService, manageSponsorUC, getSponsorPublicDataUC, sponsorLogoUpload);

// ─── Observer: Conecta Scanner → Cache ───────────────────────────────────────
scheduler.on('scan:complete', async ({ statuses }) => {
    const allCameras = await cameraRepo.findAll();
    cameraCache.update(statuses, allCameras);
});

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    originAgentCluster: false,
    frameguard: { action: 'sameorigin' }  // bloqueia iframes por padrão
}));

// ─── Middleware: libera iframes apenas para /embed/* ──────────────────────────
app.use('/embed', (req, res, next) => {
    // Remove o X-Frame-Options herdado do Helmet e permite qualquer origem
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    next();
});

const allowedOrigins = [
    CONFIG.SITE_BASE_URL,
    `https://${CONFIG.SITE_DOMAIN}`,
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://10.10.0.71:3001',
    'http://10.10.0.71'
].filter(Boolean);

const allowedOriginSet = new Set(allowedOrigins);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOriginSet.has(origin)) return callback(null, true);
        if (/^https:\/\/([a-z0-9-]+\.)?camerasriobranco\.(com\.br|site)$/.test(origin)) return callback(null, true);
        if (/^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    credentials: true
}));

app.use(express.json({ limit: CONFIG.JSON_BODY_LIMIT }));
app.use(tarpit);
app.use((req, res, next) => {
    // Evita cache persistente de HTML, JS e CSS para refletir alterações instantaneamente no navegador
    if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.startsWith('/script/') || req.path.startsWith('/css/')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        metrics.recordRequest(duration, res.statusCode >= 500);
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// ─── Firebase Session Cookie Auth ───────────────────────────────────────────
app.post('/api/auth/session-login', async (req, res) => {
    const idToken = req.body?.idToken;
    if (!idToken) return res.status(400).json({ error: 'Token não fornecido.' });

    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        if (!isUserAdmin(decoded.email)) {
            return res.status(403).json({ error: 'Permissões insuficientes.' });
        }

        const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 dias
        const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });

        const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.setHeader('Set-Cookie', `__session=${sessionCookie}; Max-Age=${expiresIn / 1000}; Path=/; HttpOnly; SameSite=Lax${isHttps ? '; Secure' : ''}`);
        res.json({ success: true });
    } catch (error) {
        console.error('[SESSION_LOGIN_ERROR]', error.message);
        res.status(401).json({ error: 'Falha ao criar sessão de administrador.' });
    }
});

app.post('/api/auth/session-logout', (req, res) => {
    res.setHeader('Set-Cookie', `__session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
    res.json({ success: true });
});

// ─── Well-known / App Links ───────────────────────────────────────────────────
app.get('/.well-known/assetlinks.json', async (req, res) => {
    const filePath = path.join(PUBLIC_FOLDER, '.well-known', 'assetlinks.json');
    try {
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(fs.readFileSync(filePath, 'utf8'));
    } catch {
        res.status(200).json([{
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
                namespace: 'android_app',
                package_name: 'com.gabvictor.camrb',
                sha256_cert_fingerprints: ['95:B7:14:22:06:61:38:B2:46:32:45:18:72:7B:B4:0F:85:4B:0C:24:CF:DE:2C:FD:E4:39:3F:BC:7A:88:8C:34']
            }
        }]);
    }
});

app.get(['/apple-app-site-association', '/.well-known/apple-app-site-association'], (req, res) => {
    const teamId = process.env.APPLE_TEAM_ID;
    const bundleId = process.env.IOS_BUNDLE_ID;
    const details = (teamId && bundleId)
        ? [{ appID: `${teamId}.${bundleId}`, paths: ['/camera*', '/camera.html*'] }]
        : [];
    res.setHeader('Content-Type', 'application/json');
    res.json({ applinks: { apps: [], details } });
});

// ─── SSR: Homepage com Injeção Instantânea de Câmeras e Tema ──────────────────
const serveIndexPage = (req, res) => {
    let html;
    try {
        html = fs.readFileSync(path.join(PUBLIC_FOLDER, 'index.html'), 'utf8');
    } catch {
        return res.status(500).send('Erro interno ao carregar a página inicial.');
    }

    html = applySsrTheme(html, req);

    const allPublicCameras = cameraCache.getAll().filter(c => c.level === 1 || !c.level).map(cam => ({
        ...cam,
        views: metrics.topCameras[cam.codigo] || 0
    }));

    const totalCount = allPublicCameras.length;
    const onlineCount = allPublicCameras.filter(c => c.status === 'online').length;
    const offlineCount = totalCount - onlineCount;

    // Preenche os contadores reais diretamente no HTML antes do envio
    html = html
        .replace('id="count-online" class="ml-1.5 opacity-60 text-xs font-bold">0<', `id="count-online" class="ml-1.5 opacity-60 text-xs font-bold">${onlineCount}<`)
        .replace('id="count-all" class="ml-1.5 opacity-60 text-xs">0<', `id="count-all" class="ml-1.5 opacity-60 text-xs">${totalCount}<`)
        .replace('id="count-offline" class="ml-1.5 opacity-60 text-xs">0<', `id="count-offline" class="ml-1.5 opacity-60 text-xs">${offlineCount}<`)
        .replace('id="content-wrapper" class="min-h-screen flex flex-col" style="display: none;"', 'id="content-wrapper" class="min-h-screen flex flex-col" style="display: flex;"');

    // Injeta dados de câmeras no script do head para renderização em 0ms
    const injectedScript = `<script>window.INITIAL_CAMERAS = ${JSON.stringify(allPublicCameras)};</script>`;
    html = html.replace('</head>', `${injectedScript}\n</head>`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
};

app.get('/', serveIndexPage);
app.get('/index.html', serveIndexPage);

// ─── SSR: Camera Page ─────────────────────────────────────────────────────────
const serveCameraPage = async (req, res) => {
    const code = req.query.code || req.params.code;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${req.get('host')}`;

    let html;
    try { html = fs.readFileSync(path.join(PUBLIC_FOLDER, 'camera.html'), 'utf8'); }
    catch { return res.status(500).send('Erro interno ao carregar a página.'); }

    html = applySsrTheme(html, req);
    metrics.recordPageView(code);
    html = html.replace('<head>', `<head>\n    <base href="${baseUrl}/">`);

    const camera = cameraCache.findByCode(code) || cameraRepo.getCached().find(c => c.codigo === code);
    if (camera?.level === 3) return res.redirect(301, '/');

    if (!camera) {
        const errorPath = path.join(PUBLIC_FOLDER, '404.html');
        try {
            let errorHtml = fs.readFileSync(errorPath, 'utf8');
            errorHtml = applySsrTheme(errorHtml, req);
            return res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8').send(errorHtml);
        } catch {
            return res.status(404).sendFile(errorPath);
        }
    }

    const title = `🔴 Ao Vivo: ${camera.nome} | Câmeras Rio Branco`;
    const description = `Assista agora às imagens em tempo real da câmera ${camera.nome}. Monitoramento de trânsito e segurança 24h em Rio Branco, Acre.`;
    const canonical = `${baseUrl}/camera/${camera.codigo}`;
    const isOnline = camera.status === 'online';
    const imageUrl = isOnline ? `${baseUrl}/proxy/camera/${camera.codigo}?t=${Date.now()}` : `${baseUrl}/assets/offline.png`;
    const staticSnapshotUrl = `${baseUrl}/proxy/camera/${camera.codigo}`;

    const metaMap = [
        [/<title>.*?<\/title>/is, `<title>${title}</title>`],
        [/<meta\s+name=["']description["']\s+content=["'][^"']*["']>/is, `<meta name="description" content="${description}">`],
        [/<link\s+rel=["']canonical["']\s+href=["'][^"']*["']>/is, `<link rel="canonical" href="${canonical}">`],
        [/<meta\s+name=["']robots["']\s+content=["'][^"']*["']>/is, `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">`],
        [/<meta\s+property=["']og:title["']\s+content=["'][^"']*["']>/is, `<meta property="og:title" content="${title}">`],
        [/<meta\s+property=["']og:description["']\s+content=["'][^"']*["']>/is, `<meta property="og:description" content="${description}">`],
        [/<meta\s+property=["']og:url["']\s+content=["'][^"']*["']>/is, `<meta property="og:url" content="${canonical}">`],
        [/<meta\s+property=["']og:image["']\s+content=["'][^"']*["']>/is, `<meta property="og:image" content="${imageUrl}">`],
        [/<meta\s+property=["']og:image:secure_url["']\s+content=["'][^"']*["']>/is, `<meta property="og:image:secure_url" content="${imageUrl}">`],
        [/<meta\s+property=["']twitter:title["']\s+content=["'][^"']*["']>/is, `<meta property="twitter:title" content="${title}">`],
        [/<meta\s+property=["']twitter:description["']\s+content=["'][^"']*["']>/is, `<meta property="twitter:description" content="${description}">`],
        [/<meta\s+property=["']twitter:url["']\s+content=["'][^"']*["']>/is, `<meta property="twitter:url" content="${canonical}">`],
        [/<meta\s+property=["']twitter:image["']\s+content=["'][^"']*["']>/is, `<meta property="twitter:image" content="${imageUrl}">`]
    ];
    metaMap.forEach(([pattern, replacement]) => {
        html = html.replace(pattern, replacement);
    });

    if (isOnline) {
        html = html
            .replace('Verificando status...', 'Online')
            .replace('text-sm font-medium text-gray-500 dark:text-gray-400 tracking-wide', 'text-sm font-medium text-emerald-600 dark:text-emerald-400 font-bold tracking-wide')
            .replace('bg-gray-300 dark:bg-gray-600', 'bg-emerald-500')
            .replace('animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 hidden', 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75');
    }

    const structuredData = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'VideoObject',
                name: title,
                description,
                thumbnailUrl: [staticSnapshotUrl, `${baseUrl}/assets/camrb.png`],
                uploadDate: new Date().toISOString(),
                contentUrl: `${baseUrl}/proxy/camera/${camera.codigo}`,
                embedUrl: `${baseUrl}/embed/${camera.codigo}`,
                isLiveBroadcast: true,
                publication: {
                    '@type': 'BroadcastEvent',
                    isLiveBroadcast: true,
                    startDate: new Date().toISOString()
                }
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    {
                        '@type': 'ListItem',
                        position: 1,
                        name: 'Início',
                        item: `${baseUrl}/`
                    },
                    {
                        '@type': 'ListItem',
                        position: 2,
                        name: 'Câmeras',
                        item: `${baseUrl}/`
                    },
                    {
                        '@type': 'ListItem',
                        position: 3,
                        name: camera.nome,
                        item: canonical
                    }
                ]
            }
        ]
    };

    const sponsor = await sponsorRepo.findByCameraCode(code);
    if (sponsor) {
        html = html.replace('</head>', `<script>window.SERVER_CAM_SPONSOR = ${JSON.stringify(sponsor.toPublicJSON())};</script>\n</head>`);
    }

    html = html
        .replace('</head>', `<script>window.SERVER_CAM_CODE = "${code}";</script>\n</head>`)
        .replace('</head>', `<script type="application/ld+json">${JSON.stringify(structuredData)}</script>\n</head>`)
        .replace(/<img id="camera-feed" src="[^"]*"/, `<img id="camera-feed" src="${isOnline ? `${baseUrl}/proxy/camera/${camera.codigo}` : `${baseUrl}/assets/offline.png`}"`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
};

// ─── Camera Proxy ─────────────────────────────────────────────────────────────
const proxyCameraHandler = async (req, res) => {
    const code = req.params.code || req.query.code;
    if (!code || !/^\d{6}$/.test(code)) return res.status(400).send('Código inválido.');

    const camera = cameraRepo.getCached().find(c => c.codigo === code);
    if (camera?.level === 3) {
        const token = req.query.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split('Bearer ')[1] : null);
        let isAdminUser = false;
        if (token) {
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                if (isUserAdmin(decoded.email)) isAdminUser = true;
            } catch (_) { }
        }
        if (!isAdminUser) return res.status(403).send('Acesso negado.');
    }

    const url = `https://cameras.riobranco.ac.gov.br/api/camera?code=${code}&timestamp=${Date.now()}`;
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://deolhonotransito.riobranco.ac.gov.br',
                'Origin': 'https://deolhonotransito.riobranco.ac.gov.br',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'same-site'
            }
        });
        if (Buffer.byteLength(response.data) / 1024 < CONFIG.MIN_IMAGE_SIZE_KB) {
            return res.status(404).sendFile(ERROR_IMAGE_PATH);
        }
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(response.data);
        metrics.recordProxySuccess();
    } catch {
        metrics.recordProxyFailure();
        res.status(502).sendFile(ERROR_IMAGE_PATH);
    }
};

// Gerenciador central de transmissão MJPEG contínua de alta velocidade (Multipart/x-mixed-replace)
const mjpegStreams = new Map();

function getOrCreateCameraStream(code) {
    if (mjpegStreams.has(code)) {
        return mjpegStreams.get(code);
    }

    const streamInfo = {
        subscribers: new Set(),
        timer: null,
        lastFrame: null,
        isFetching: false
    };

    const fetchAndBroadcast = async () => {
        if (streamInfo.subscribers.size === 0) {
            if (streamInfo.timer) clearTimeout(streamInfo.timer);
            mjpegStreams.delete(code);
            return;
        }

        let nextDelay = 0;
        if (!streamInfo.isFetching) {
            streamInfo.isFetching = true;
            try {
                const response = await axios.get(`https://cameras.riobranco.ac.gov.br/api/camera?code=${code}&timestamp=${Date.now()}`, {
                    responseType: 'arraybuffer',
                    timeout: 5000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer':    'https://deolhonotransito.riobranco.ac.gov.br',
                        'Origin':     'https://deolhonotransito.riobranco.ac.gov.br',
                        'Accept':     'image/jpeg,*/*'
                    }
                });

                if (Buffer.byteLength(response.data) / 1024 >= CONFIG.MIN_IMAGE_SIZE_KB) {
                    const frameData = Buffer.from(response.data);
                    streamInfo.lastFrame = frameData;

                    const header = `--myboundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${frameData.length}\r\n\r\n`;
                    for (const clientRes of streamInfo.subscribers) {
                        try {
                            if (!clientRes.writableEnded && !clientRes.closed) {
                                clientRes.write(header);
                                clientRes.write(frameData);
                                clientRes.write('\r\n');
                            }
                        } catch (_) {
                            streamInfo.subscribers.delete(clientRes);
                        }
                    }
                }
                const configuredInterval = (cameraCtrl && cameraCtrl.getStreamIntervalMs) ? cameraCtrl.getStreamIntervalMs() : 0;
                nextDelay = configuredInterval; // Intervalo dinâmico configurado no painel administrativo
            } catch (_) {
                // Se a prefeitura demorar ou oscilar, aguarda 2.5s antes de tentar novamente (sem floodar)
                nextDelay = 2500;
            } finally {
                streamInfo.isFetching = false;
            }
        }

        if (streamInfo.subscribers.size > 0) {
            streamInfo.timer = setTimeout(fetchAndBroadcast, nextDelay);
        } else {
            mjpegStreams.delete(code);
        }
    };

    streamInfo.timer = setTimeout(fetchAndBroadcast, 0);
    mjpegStreams.set(code, streamInfo);
    return streamInfo;
}

const streamCameraHandler = async (req, res) => {
    const code = req.params.code || req.query.code;
    if (!code || !/^\d{6}$/.test(code)) return res.status(400).send('Código inválido.');

    const camera = cameraRepo.getCached().find(c => c.codigo === code);
    if (camera?.level === 3) {
        const token = req.query.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split('Bearer ')[1] : null);
        let isAdminUser = false;
        if (token) {
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                if (isUserAdmin(decoded.email)) isAdminUser = true;
            } catch (_) {}
        }
        if (!isAdminUser) return res.status(403).send('Acesso negado.');
    }

    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=--myboundary',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Connection': 'close',
        'Access-Control-Allow-Origin': '*'
    });

    const stream = getOrCreateCameraStream(code);

    if (stream.lastFrame) {
        try {
            res.write(`--myboundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${stream.lastFrame.length}\r\n\r\n`);
            res.write(stream.lastFrame);
            res.write('\r\n');
        } catch (_) {}
    }

    stream.subscribers.add(res);

    req.on('close', () => {
        stream.subscribers.delete(res);
        if (stream.subscribers.size === 0) {
            if (stream.timer) clearTimeout(stream.timer);
            mjpegStreams.delete(code);
        }
    });
};

// ─── Rotas Especiais (SSR + Proxy + Stream) ──────────────────────────────────
app.get('/camera.html', (req, res) => {
    const code = req.query.code || req.query.id;
    if (code && /^\d{6}$/.test(code)) return res.redirect(301, `/camera/${code}`);
    return res.redirect(301, '/');
});
app.get('/camera', (req, res) => {
    const code = req.query.code || req.query.id;
    if (code && /^\d{6}$/.test(code)) return res.redirect(301, `/camera/${code}`);
    return res.redirect(301, '/');
});
app.get('/camera/:code', (req, res) => {
    if (!/^\d{6}$/.test(req.params.code)) return res.redirect(301, '/');
    serveCameraPage(req, res);
});
app.get('/proxy/camera', proxyCameraHandler);
app.get('/proxy/camera/:code', proxyCameraHandler);
app.get('/stream/camera', streamCameraHandler);
app.get('/stream/camera/:code', streamCameraHandler);

// ─── Rotas Modulares ─────────────────────────────────────────────────────────
app.use('/', cameraRoutes(cameraCtrl));
app.use('/', sponsorRoutes(sponsorCtrl));
app.use('/api', adminRoutes(reportCtrl, dashboardCtrl));

// ─── System Resources API & SSE Stream (Protegida) ───────────────────────────
const { verifyAdmin } = require('./src/middlewares/security');

app.get('/api/admin/system-resources/stream', verifyAdmin, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const sendSnapshot = () => {
        try {
            if (!res.writableEnded && !res.closed) {
                const data = resourceMonitor.getSystemResources(mjpegStreams, cameraRepo, metrics, timelapseScheduler);
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        } catch (_) {}
    };

    sendSnapshot();
    const interval = setInterval(sendSnapshot, 1000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

app.get('/api/admin/system-resources', verifyAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(resourceMonitor.getSystemResources(mjpegStreams, cameraRepo, metrics, timelapseScheduler));
});

// ─── Health / Sync ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const snap = scheduler.getStatus();
    res.json({
        status: 'ok',
        isScanning: snap.isScanning,
        nextScanTimestamp: snap.nextScanTimestamp,
        cachedCount: cameraCache.count,
        onlineCount: cameraCache.onlineCount,
        uptimeMs: Date.now() - metrics.startTime,
        metrics: metrics.getSnapshot()
    });
});

app.get('/api/sync-info', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const snap = scheduler.getStatus();
    res.json({
        updateInterval: CONFIG.UPDATE_INTERVAL_MS,
        nextScanTimestamp: snap.nextScanTimestamp,
        scanTimeoutOccurred: snap.scanTimeoutOccurred
    });
});

// ─── Robots.txt Dinâmico ──────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const robotsPath = path.join(PUBLIC_FOLDER, 'robots.txt');
    try {
        let content = fs.readFileSync(robotsPath, 'utf8');
        content = content.replace(/Sitemap: .*/, `Sitemap: ${CONFIG.SITE_BASE_URL}/sitemap.xml`);
        res.send(content);
    } catch {
        res.sendFile(robotsPath);
    }
});

// ─── Sitemap Dinâmico Otimizado (Google Search & Imagens) ────────────────────
app.get('/sitemap.xml', (req, res) => {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.setHeader('X-Robots-Tag', 'noindex');

    const baseUrl = CONFIG.SITE_BASE_URL;
    const lastMod = getRioBrancoDateStr();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';

    // Páginas principais
    const staticPages = [
        { path: '', changefreq: 'daily', priority: '1.0', img: `${baseUrl}/assets/camrb.png`, title: 'Câmeras Rio Branco Ao Vivo 24h', caption: 'Monitoramento de trânsito e segurança em tempo real em Rio Branco, Acre' },
        { path: 'rio', changefreq: 'hourly', priority: '0.9', img: `${baseUrl}/proxy/camera/001426`, title: 'Nível do Rio Acre em Tempo Real', caption: 'Telemetria oficial da ANA/CPRM e câmera ao vivo da Ponte Metálica' },
        { path: 'timelapses', changefreq: 'daily', priority: '0.8', img: `${baseUrl}/assets/camrb.png`, title: 'Galeria de Timelapses 24h de Rio Branco' },
        { path: 'mapa', changefreq: 'weekly', priority: '0.8', img: `${baseUrl}/assets/camrb.png`, title: 'Mapa Interativo de Câmeras de Rio Branco' },
        { path: 'sobre', changefreq: 'monthly', priority: '0.7' },
        { path: 'novidades', changefreq: 'weekly', priority: '0.7' },
        { path: 'contato', changefreq: 'monthly', priority: '0.6' },
        { path: 'termos', changefreq: 'monthly', priority: '0.5' }
    ];

    staticPages.forEach(p => {
        const loc = p.path ? `${baseUrl}/${p.path}` : `${baseUrl}/`;
        xml += '  <url>\n';
        xml += `    <loc>${loc}</loc>\n`;
        xml += `    <lastmod>${lastMod}</lastmod>\n`;
        xml += `    <changefreq>${p.changefreq}</changefreq>\n`;
        xml += `    <priority>${p.priority}</priority>\n`;
        if (p.img) {
            xml += '    <image:image>\n';
            xml += `      <image:loc>${p.img}</image:loc>\n`;
            xml += `      <image:title>${escapeXml(p.title)}</image:title>\n`;
            if (p.caption) {
                xml += `      <image:caption>${escapeXml(p.caption)}</image:caption>\n`;
            }
            xml += '    </image:image>\n';
        }
        xml += '  </url>\n';
    });

    // Câmeras públicas
    const cachedFromService = cameraCache.getPublic ? cameraCache.getPublic() : [];
    const cameras = cachedFromService.length > 0
        ? cachedFromService
        : cameraRepo.getCached().filter(c => c.level === 1 || !c.level);

    cameras.forEach(camera => {
        if (!camera.codigo || camera.level === 3) return;
        const isOnline = camera.status === 'online';
        const camName = escapeXml(camera.nome || `Câmera ${camera.codigo}`);
        const camUrl = `${baseUrl}/camera/${camera.codigo}`;
        const imgUrl = `${baseUrl}/proxy/camera/${camera.codigo}`;

        xml += '  <url>\n';
        xml += `    <loc>${camUrl}</loc>\n`;
        xml += `    <lastmod>${lastMod}</lastmod>\n`;
        xml += `    <changefreq>${isOnline ? 'always' : 'daily'}</changefreq>\n`;
        xml += `    <priority>${isOnline ? '0.9' : '0.6'}</priority>\n`;
        xml += '    <image:image>\n';
        xml += `      <image:loc>${imgUrl}</image:loc>\n`;
        xml += `      <image:title>Câmera Ao Vivo: ${camName}</image:title>\n`;
        xml += `      <image:caption>Transmissão ao vivo de trânsito e segurança em Rio Branco - AC: ${camName}</image:caption>\n`;
        xml += '    </image:image>\n';
        xml += '  </url>\n';
    });

    xml += '</urlset>';
    res.send(xml);
});

// ─── Redirecionamentos Canônicos 301 (Elimina URLs duplicadas no Google) ─────
app.get('/index.html', (req, res) => res.redirect(301, '/'));
['rio', 'timelapses', 'contato', 'novidades', 'sobre', 'mapa', 'login', 'metrics', 'termos', 'perfil', 'patrocine'].forEach(p => {
    app.get(`/${p}.html`, (req, res) => res.redirect(301, `/${p}`));
});

// ─── Static Files (Públicos apenas) ──────────────────────────────────────────
app.use(express.static(PUBLIC_FOLDER));

// ─── Clean URL Routes Públicas ────────────────────────────────────────────────
const page = (file) => (req, res) => {
    const filePath = path.join(PUBLIC_FOLDER, file);
    try {
        let html = fs.readFileSync(filePath, 'utf8');
        html = applySsrTheme(html, req);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch {
        res.sendFile(filePath);
    }
};
app.get('/rio', page('rio.html'));
app.get('/timelapses', page('timelapses.html'));
app.get('/contato', page('contato.html'));
app.get('/novidades', page('novidades.html'));
app.get('/sobre', page('sobre.html'));
app.get('/mapa', page('mapa.html'));
app.get('/login', page('login.html'));
app.get('/metrics', page('metrics.html'));
app.get('/termos', page('termos.html'));
app.get('/perfil', page('perfil.html'));
app.get('/patrocine', page('patrocine.html'));
app.get('/embed/:id', (req, res) => {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.sendFile(path.join(PUBLIC_FOLDER, 'embed.html'));
});

// ─── Clean URL Routes Administrativas (Protegidas no Servidor) ────────────────
const adminPage = (file) => (req, res) => res.sendFile(path.join(ADMIN_VIEWS_FOLDER, file));
app.get('/admin', verifyAdminPageSession, adminPage('admin.html'));
app.get('/admin/resources', verifyAdminPageSession, adminPage('resources.html'));
app.get('/admin/logs', verifyAdminPageSession, adminPage('logs.html'));
app.get('/admin/suggestions', verifyAdminPageSession, adminPage('suggestions.html'));
app.get('/admin/reports', verifyAdminPageSession, adminPage('reports.html'));
app.get('/admin/comments', verifyAdminPageSession, adminPage('comments.html'));
app.get('/admin/comments/:cameraId', verifyAdminPageSession, adminPage('comments.html'));
app.get('/admin/comments/:cameraId/:commentId', verifyAdminPageSession, adminPage('comments.html'));
app.get('/admin/analise-cameras', verifyAdminPageSession, adminPage('analise-cameras.html'));
app.get('/dashboard', verifyAdminPageSession, adminPage('dashboard.html'));

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
    const filePath = path.join(PUBLIC_FOLDER, '404.html');
    try {
        let html = fs.readFileSync(filePath, 'utf8');
        html = applySsrTheme(html, req);
        res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
    } catch {
        res.status(404).sendFile(filePath);
    }
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
    // 1. Carrega dados do Firestore
    await cameraRepo.refresh();
    await sponsorRepo.refresh();
    await sponsorRepo.getPlans();

    // 2. Carrega config do site
    try {
        const configDoc = await db.collection('site_config').doc('global').get();
        if (configDoc.exists) {
            const cfg = configDoc.data();
            cameraCtrl.setSiteConfig(cfg);
            if (cfg.timelapseIntervalMinutes) {
                timelapseScheduler.setIntervalMinutes(cfg.timelapseIntervalMinutes);
            }
        } else {
            await db.collection('site_config').doc('global').set({ showAppBanner: true, timelapseIntervalMinutes: 30 });
        }
    } catch (e) { console.warn('Config não carregada:', e.message); }

    // 3. Carrega métricas persistidas
    setTimeout(async () => {
        try {
            const doc = await db.collection('metrics').doc('global_views').get();
            if (doc.exists) {
                const data = doc.data();
                const todayStr = getRioBrancoDateStr();
                metrics.hydrate({
                    total: data.total || 0,
                    today: data.date === todayStr ? (data.today || 0) : 0,
                    topCameras: data.date === todayStr ? (data.topCameras || {}) : {}
                });
            }
        } catch (e) { console.error('Erro ao carregar métricas:', e); }
    }, 5000);

    // 4. Salva métricas a cada 5 min
    setInterval(async () => {
        try {
            await db.collection('metrics').doc('global_views').set({
                total: metrics.totalViews,
                today: metrics.viewsToday,
                date: getRioBrancoDateStr(),
                topCameras: metrics.topCameras
            }, { merge: true });
        } catch (e) { console.error('Erro ao salvar métricas:', e); }
    }, 5 * 60 * 1000);

    // 5. Inicia servidor
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Servidor rodando!`);
        console.log(`Local:   http://localhost:${CONFIG.PORT}`);
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    console.log(`Rede:    http://${net.address}:${CONFIG.PORT} (${name})`);
                }
            }
        }
        console.log('');
    });

    // 6. Inicia agendador de varreduras e timelapse
    scheduler.start();
    timelapseScheduler.start();

    const shutdown = async (signal) => {
        console.log(`\n[${signal}] Salvando métricas e desligando...`);
        try {
            await db.collection('metrics').doc('global_views').set({
                total: metrics.totalViews,
                today: metrics.viewsToday,
                date: getRioBrancoDateStr(),
                topCameras: metrics.topCameras
            }, { merge: true });
            console.log('✔ Métricas salvas com sucesso.');
        } catch (e) {
            console.error('Erro ao salvar métricas no desligamento:', e.message);
        }
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch(err => {
    console.error('[FATAL] Falha no bootstrap:', err);
    process.exit(1);
});
