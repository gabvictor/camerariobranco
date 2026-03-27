/**
 * server.js — Bootstrap declarativo
 *
 * Este arquivo é uma Facade:  apenas conecta as peças.
 * Toda lógica de negócio está na camada de Aplicação.
 * Toda persistência está na camada de Infraestrutura.
 */

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const helmet   = require('helmet');
const axios    = require('axios');
const os       = require('os');

// ─── Infraestrutura ───────────────────────────────────────────────────────────
const { admin, db }     = require('./src/config/firebaseAdmin');
const CONFIG            = require('./src/config/appConfig');
const { tarpit, requestLogger, verifyAdmin } = require('./src/middlewares/security');

// Repositories (Infrastructure)
const FirebaseCameraRepository = require('./src/infrastructure/database/FirebaseCameraRepository');
const FirebaseReportRepository = require('./src/infrastructure/database/FirebaseReportRepository');

// Scanner (Strategy + Factory)
const ScannerFactory = require('./src/infrastructure/scanner/ScannerFactory');
const ScanScheduler  = require('./src/infrastructure/scheduler/ScanScheduler');

// ─── Aplicação ────────────────────────────────────────────────────────────────
const MetricsService          = require('./src/application/services/MetricsService');
const CameraCache             = require('./src/application/services/CameraCache');
const CreateReportUseCase     = require('./src/application/use-cases/CreateReportUseCase');
const TrackVisitUseCase       = require('./src/application/use-cases/TrackVisitUseCase');
const GetDashboardDataUseCase = require('./src/application/use-cases/GetDashboardDataUseCase');

// ─── Apresentação ─────────────────────────────────────────────────────────────
const CameraController    = require('./src/presentation/http/controllers/CameraController');
const ReportController    = require('./src/presentation/http/controllers/ReportController');
const DashboardController = require('./src/presentation/http/controllers/DashboardController');
const cameraRoutes        = require('./src/presentation/http/routes/cameraRoutes');
const adminRoutes         = require('./src/presentation/http/routes/adminRoutes');

// ─── Composição (Dependency Injection manual) ─────────────────────────────────
const metrics       = new MetricsService();
const cameraCache   = new CameraCache();
const cameraRepo    = new FirebaseCameraRepository(db);
const reportRepo    = new FirebaseReportRepository(db);
const scanner       = ScannerFactory.create();
const scheduler     = new ScanScheduler(scanner);

const createReport  = new CreateReportUseCase(reportRepo);
const trackVisit    = new TrackVisitUseCase(db);
const dashboardUC   = new GetDashboardDataUseCase(admin.auth(), cameraRepo, metrics, trackVisit);

const cameraCtrl    = new CameraController(cameraCache, metrics, cameraRepo, trackVisit)
    .setDb(db)
    .setSiteConfig({ showAppBanner: true });

const reportCtrl    = new ReportController(createReport, reportRepo).setDb(db);
const dashboardCtrl = new DashboardController(dashboardUC);

// ─── Observer: Conecta Scanner → Cache ───────────────────────────────────────
scheduler.on('scan:complete', async ({ statuses }) => {
    const allCameras = await cameraRepo.findAll();
    cameraCache.update(statuses, allCameras);
});

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
const PUBLIC_FOLDER   = path.join(__dirname, 'public');
const ERROR_IMAGE_PATH = path.join(PUBLIC_FOLDER, 'assets', 'offline.png');

app.use(helmet({
    contentSecurityPolicy:    false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy:  { policy: 'same-origin-allow-popups' },
    originAgentCluster:       false
}));
app.use(cors());
app.use(express.json());
app.use(tarpit);
app.use((req, res, next) => {
    metrics.recordRequest(0); // duração registrada no 'finish'
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (res.statusCode >= 500) metrics.recordRequest(duration, true);
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
    });
    next();
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
    const teamId   = process.env.APPLE_TEAM_ID;
    const bundleId = process.env.IOS_BUNDLE_ID;
    const details  = (teamId && bundleId)
        ? [{ appID: `${teamId}.${bundleId}`, paths: ['/camera*', '/camera.html*'] }]
        : [];
    res.setHeader('Content-Type', 'application/json');
    res.json({ applinks: { apps: [], details } });
});

// ─── SSR: Camera Page ─────────────────────────────────────────────────────────
const serveCameraPage = (req, res) => {
    const code     = req.query.code || req.params.code;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl  = `${protocol}://${req.get('host')}`;

    let html;
    try { html = fs.readFileSync(path.join(PUBLIC_FOLDER, 'camera.html'), 'utf8'); }
    catch { return res.status(500).send('Erro interno ao carregar a página.'); }

    metrics.recordPageView(code);
    html = html.replace('<head>', `<head>\n    <base href="${baseUrl}/">`);

    const camera = cameraCache.findByCode(code) || cameraRepo.getCached().find(c => c.codigo === code);
    if (camera?.level === 3) return res.redirect('/');

    if (camera) {
        const title       = `🔴 Ao Vivo: ${camera.nome} | Câmeras Rio Branco`;
        const description = `Assista agora às imagens em tempo real da câmera ${camera.nome}. Monitoramento de trânsito e segurança 24h em Rio Branco, Acre.`;
        const canonical   = `${baseUrl}/camera/${camera.codigo}`;
        const isOnline    = camera.status === 'online';
        const imageUrl    = isOnline ? `${baseUrl}/proxy/camera/${camera.codigo}?t=${Date.now()}` : `${baseUrl}/assets/offline.png`;

        const metaMap = [
            ['<title>.*?</title>', `<title>${title}</title>`],
            ['<meta name="description" content="[^"]*">', `<meta name="description" content="${description}">`],
            ['<link rel="canonical" href="[^"]*">', `<link rel="canonical" href="${canonical}">`],
            ['<meta property="og:title" content="[^"]*">', `<meta property="og:title" content="${title}">`],
            ['<meta property="og:description" content="[^"]*">', `<meta property="og:description" content="${description}">`],
            ['<meta property="og:url" content="[^"]*">', `<meta property="og:url" content="${canonical}">`],
            ['<meta property="og:image" content="[^"]*">', `<meta property="og:image" content="${imageUrl}">`],
            ['<meta property="twitter:title" content="[^"]*">', `<meta property="twitter:title" content="${title}">`],
            ['<meta property="twitter:description" content="[^"]*">', `<meta property="twitter:description" content="${description}">`],
            ['<meta property="twitter:url" content="[^"]*">', `<meta property="twitter:url" content="${canonical}">`],
            ['<meta property="twitter:image" content="[^"]*">', `<meta property="twitter:image" content="${imageUrl}">`]
        ];
        metaMap.forEach(([pattern, replacement]) => {
            html = html.replace(new RegExp(pattern), replacement);
        });

        if (isOnline) {
            html = html
                .replace('Verificando status...', 'Online')
                .replace('text-sm font-medium text-gray-500 dark:text-gray-400 tracking-wide', 'text-sm font-medium text-emerald-600 dark:text-emerald-400 font-bold tracking-wide')
                .replace('bg-gray-300 dark:bg-gray-600', 'bg-emerald-500')
                .replace('animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 hidden', 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75');
        }

        html = html
            .replace('</head>', `<script>window.SERVER_CAM_CODE = "${code}";</script>\n</head>`)
            .replace('</head>', `<script type="application/ld+json">${JSON.stringify({
                '@context': 'https://schema.org', '@type': 'VideoObject',
                name: title, description, thumbnailUrl: [imageUrl],
                uploadDate: new Date().toISOString(),
                contentUrl: `${baseUrl}/proxy/camera/${camera.codigo}`, embedUrl: canonical
            })}</script>\n</head>`)
            .replace(/<img id="camera-feed" src="[^"]*"/, `<img id="camera-feed" src="${isOnline ? `${baseUrl}/proxy/camera/${camera.codigo}` : `${baseUrl}/assets/offline.png`}"`);
    }

    res.send(html);
};

// ─── Camera Proxy ─────────────────────────────────────────────────────────────
const proxyCameraHandler = async (req, res) => {
    const code = req.params.code || req.query.code;
    if (!code || !/^\d{6}$/.test(code)) return res.status(400).send('Código inválido.');

    const camera = cameraRepo.getCached().find(c => c.codigo === code);
    if (camera?.level === 3) {
        const token = req.query.token;
        let isAdminUser = false;
        if (token) {
            try {
                const { ADMIN_EMAIL } = require('./src/config/firebaseAdmin');
                const decoded = await admin.auth().verifyIdToken(token);
                if (decoded.email === ADMIN_EMAIL) isAdminUser = true;
            } catch (_) {}
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
                'Referer':    'https://deolhonotransito.riobranco.ac.gov.br',
                'Origin':     'https://deolhonotransito.riobranco.ac.gov.br',
                'Accept':     'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'same-site'
            }
        });
        if (Buffer.byteLength(response.data) / 1024 < CONFIG.MIN_IMAGE_SIZE_KB) {
            return res.status(404).sendFile(ERROR_IMAGE_PATH);
        }
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.send(response.data);
        metrics.recordProxySuccess();
    } catch {
        metrics.recordProxyFailure();
        res.status(502).sendFile(ERROR_IMAGE_PATH);
    }
};

// ─── Rotas Especiais (SSR + Proxy) ───────────────────────────────────────────
app.get('/camera.html', serveCameraPage);
app.get('/camera', (req, res) => {
    if (req.query.code && /^\d{6}$/.test(req.query.code)) return res.redirect(301, `/camera/${req.query.code}`);
    return res.redirect(301, '/');
});
app.get('/camera/:code', (req, res) => {
    if (!/^\d{6}$/.test(req.params.code)) return res.redirect('/');
    serveCameraPage(req, res);
});
app.get('/proxy/camera',        proxyCameraHandler);
app.get('/proxy/camera/:code',  proxyCameraHandler);

// ─── Rotas Modulares ─────────────────────────────────────────────────────────
app.use('/', cameraRoutes(cameraCtrl));
app.use('/api', adminRoutes(reportCtrl, dashboardCtrl));

// ─── Health / Sync ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const snap = scheduler.getStatus();
    res.json({
        status: 'ok',
        isScanning:        snap.isScanning,
        nextScanTimestamp: snap.nextScanTimestamp,
        cachedCount:       cameraCache.count,
        onlineCount:       cameraCache.onlineCount,
        uptimeMs:          Date.now() - metrics.startTime,
        metrics:           metrics.getSnapshot()
    });
});

app.get('/api/sync-info', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const snap = scheduler.getStatus();
    res.json({
        updateInterval:      CONFIG.UPDATE_INTERVAL_MS,
        nextScanTimestamp:   snap.nextScanTimestamp,
        scanTimeoutOccurred: snap.scanTimeoutOccurred
    });
});

// ─── Sitemap ─────────────────────────────────────────────────────────────────
app.get('/sitemap.xml', (req, res) => {
    res.header('Content-Type', 'application/xml');
    const baseUrl  = 'https://camerasriobranco.site';
    const lastMod  = new Date().toISOString().split('T')[0];
    let xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    xml += `<url><loc>${baseUrl}/</loc><lastmod>${lastMod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`;
    xml += `<url><loc>${baseUrl}/mapa.html</loc><lastmod>${lastMod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
    xml += `<url><loc>${baseUrl}/novidades</loc><lastmod>${lastMod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`;
    cameraCache.getAll().forEach(camera => {
        if (camera.level === 3 || !camera.codigo) return;
        xml += `<url><loc>${baseUrl}/camera/${camera.codigo}</loc><lastmod>${lastMod}</lastmod><changefreq>${camera.status === 'online' ? 'always' : 'hourly'}</changefreq><priority>${camera.status === 'online' ? '0.9' : '0.6'}</priority></url>`;
    });
    xml += '</urlset>';
    res.send(xml);
});

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(PUBLIC_FOLDER));

// ─── Clean URL Routes ─────────────────────────────────────────────────────────
const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_FOLDER, file));
app.get('/novidades',                               page('novidades.html'));
app.get('/sobre',                                   page('sobre.html'));
app.get('/mapa',                                    page('mapa.html'));
app.get('/admin',                                   page('admin.html'));
app.get('/admin/reports',                           page('reports.html'));
app.get('/admin/comments',                          page('comments.html'));
app.get('/admin/comments/:cameraId',                page('comments.html'));
app.get('/admin/comments/:cameraId/:commentId',     page('comments.html'));
app.get('/login',                                   page('login.html'));
app.get('/metrics',                                 page('metrics.html'));
app.get('/termos',                                  page('termos.html'));
app.get('/perfil',                                  page('perfil.html'));
app.get('/dashboard',                               page('dashboard.html'));
app.get('/embed/:id',                               page('embed.html'));

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_FOLDER, '404.html')));

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
    // 1. Carrega dados do Firestore
    await cameraRepo.refresh();

    // 2. Carrega config do site
    try {
        const configDoc = await db.collection('site_config').doc('global').get();
        if (configDoc.exists) {
            cameraCtrl.setSiteConfig(configDoc.data());
        } else {
            await db.collection('site_config').doc('global').set({ showAppBanner: true });
        }
    } catch (e) { console.warn('Config não carregada:', e.message); }

    // 3. Carrega métricas persistidas
    setTimeout(async () => {
        try {
            const doc = await db.collection('metrics').doc('global_views').get();
            if (doc.exists) {
                const data = doc.data();
                const todayStr = new Date().toISOString().split('T')[0];
                metrics.hydrate({
                    total:      data.total || 0,
                    today:      data.date === todayStr ? (data.today || 0) : 0,
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
                date:  new Date().toISOString().split('T')[0],
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

    // 6. Inicia agendador de varreduras
    scheduler.start();

    process.on('SIGINT', () => {
        console.log('\nDesligando...');
        process.exit(0);
    });
}

bootstrap().catch(err => {
    console.error('[FATAL] Falha no bootstrap:', err);
    process.exit(1);
});
