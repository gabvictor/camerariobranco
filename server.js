const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const admin = require('firebase-admin');

// --- INÍCIO: CONFIGURAÇÃO SEGURA DO FIREBASE ADMIN ---
try {
    let serviceAccount;
    // Prioriza a variável de ambiente (para produção, como no Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        console.log("✔ Firebase Admin SDK a inicializar com credenciais de ambiente.");
    } else {
        // Fallback para o ficheiro local (para desenvolvimento no seu computador)
        // IMPORTANTE: O ficheiro 'serviceAccountKey.json' NÃO DEVE ser enviado para o GitHub.
        serviceAccount = require('./serviceAccountKey.json');
        console.log("✔ Firebase Admin SDK a inicializar com ficheiro local.");
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✔ Firebase Admin SDK inicializado com sucesso.");
} catch (error) {
    console.error("[ERRO CRÍTICO] Falha ao inicializar o Firebase Admin SDK.");
    console.error("Verifique se o ficheiro 'serviceAccountKey.json' existe (para desenvolvimento local) ou se a variável de ambiente 'FIREBASE_SERVICE_ACCOUNT_JSON' está configurada corretamente (para produção).");
}
const ADMIN_EMAIL = "vgabvictor@gmail.com";
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
const CAMERA_INFO_FILE = path.join(__dirname, 'cameras_info.json');
const ASSETS_FOLDER = path.join(__dirname, 'assets');
const ERROR_IMAGE_PATH = path.join(ASSETS_FOLDER, 'placeholder_error.webp');

// --- Estado da Aplicação ---
let nextScanTimestamp = Date.now();
let isScanning = false;
let scanTimeoutOccurred = false;
let cameraInfo = [];
let cachedCameraStatus = [];

// --- Middlewares ---
app.use(cors());
app.use(express.json());

// --- Servir ficheiros estáticos (HTML, CSS, JS do cliente) a partir do diretório raiz ---
app.use(express.static(__dirname));
app.use('/assets', express.static(ASSETS_FOLDER));

// --- Lógica de Carregamento de Metadados ---
async function loadCameraInfo() {
    try {
        const infoData = await fs.readFile(CAMERA_INFO_FILE, 'utf8');
        cameraInfo = JSON.parse(infoData);
        console.log("✔ Informações de câmeras carregadas.");
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log("Arquivo 'cameras_info.json' não encontrado. Será criado um novo.");
            cameraInfo = [];
            await fs.writeFile(CAMERA_INFO_FILE, '[]', 'utf8');
        } else {
            console.warn("[WARN] Não foi possível carregar 'cameras_info.json'.");
            cameraInfo = [];
        }
    }
}

// --- Rotas da API ---

// Middleware de verificação de admin
const verifyAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(403).json({ message: 'Acesso negado: Token não fornecido.' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        if (decodedToken.email === ADMIN_EMAIL) {
            req.user = decodedToken;
            next();
        } else {
            res.status(403).json({ message: 'Acesso negado: Permissões insuficientes.' });
        }
    } catch (error) {
        console.error('Erro ao verificar token:', error);
        res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
};


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
    } catch (error) {
        res.status(502).sendFile(ERROR_IMAGE_PATH);
    }
});

app.get('/status-cameras', (req, res) => res.json(cachedCameraStatus));

app.get('/api/sync-info', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    res.json({
        updateInterval: CONFIG.UPDATE_INTERVAL_MS,
        nextScanTimestamp: nextScanTimestamp,
        scanTimeoutOccurred: scanTimeoutOccurred,
    });
});

app.post('/api/update-camera-info', async (req, res) => {
    const { codigo, nome, categoria, descricao, coords } = req.body;
    if (!codigo || !nome) {
        return res.status(400).json({ message: 'Código e nome são obrigatórios.' });
    }
    try {
        const currentInfo = [...cameraInfo];
        const cameraIndex = currentInfo.findIndex(c => c.codigo === codigo);
        const newInfo = { codigo, nome, categoria, descricao, coords };
        if (cameraIndex > -1) {
            currentInfo[cameraIndex] = { ...currentInfo[cameraIndex], ...newInfo };
        } else {
            currentInfo.push(newInfo);
        }
        await fs.writeFile(CAMERA_INFO_FILE, JSON.stringify(currentInfo, null, 2), 'utf8');
        await loadCameraInfo();
        const currentStatuses = cachedCameraStatus.map(c => ({ codigo: c.codigo, status: c.status }));
        updateStatusCache(currentStatuses);
        res.status(200).json({ message: 'Informações da câmera atualizadas com sucesso!' });
    } catch (error) {
        console.error('[UPDATE_INFO_ERROR]', error);
        res.status(500).json({ message: 'Erro ao salvar as informações.' });
    }
});


// --- ROTA DE DADOS PARA O DASHBOARD ---
app.get('/api/dashboard-data', verifyAdmin, async (req, res) => {
    try {
        const listUsersResult = await admin.auth().listUsers(1000);
        const totalUsers = listUsersResult.users.length;

        const today = new Date();
        today.setHours(23, 59, 59, 999);

        const signupsByDay = {
            labels: [],
            values: Array(7).fill(0)
        };

        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            signupsByDay.labels.push(date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
        }

        listUsersResult.users.forEach(user => {
            const creationTime = new Date(user.metadata.creationTime);
            const diffDays = Math.floor((today - creationTime) / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays < 7) {
                const index = 6 - diffDays;
                signupsByDay.values[index]++;
            }
        });

        res.json({
            totalUsers,
            signupsByDay
        });

    } catch (error) {
        console.error('Erro ao buscar estatísticas de usuários:', error);
        res.status(500).json({ message: "Não foi possível carregar as estatísticas." });
    }
});


// --- Lógica de Verificação de Câmeras ---
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
        if (error.name === 'AbortError' || error.code === 'ECONNABORTED' || error.code === 'ECONNRESET' || error.message === 'canceled') {
        } else {
             console.error(`[${new Date().toLocaleTimeString()}] [CHECK_ERROR] Câmera ${code}: ${error.message}`);
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
            descricao: info ? info.descricao : ""
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
        const codes = Array.from({ length: CONFIG.CAMERA_CODE_END - CONFIG.CAMERA_CODE_START + 1 }, (_, i) => 
            (CONFIG.CAMERA_CODE_START + i).toString().padStart(6, '0')
        );
        const allStatuses = [];
        for (let i = 0; i < codes.length; i += CONFIG.CONCURRENCY_LIMIT) {
            const batch = codes.slice(i, i + CONFIG.CONCURRENCY_LIMIT);
            const promises = batch.map(code => checkCameraStatus(code, controller.signal));
            const results = await Promise.allSettled(promises);
            results.forEach(result => {
                if (result.status === 'fulfilled') allStatuses.push(result.value);
            });
            if (controller.signal.aborted) {
                console.log('[INFO] A varredura foi abortada, interrompendo o processamento de lotes.');
                break;
            }
        }
        return allStatuses;
    })();

    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Scan timeout')), CONFIG.SCAN_TIMEOUT_MS)
    );

    try {
        const allStatuses = await Promise.race([scanningPromise, timeoutPromise]);
        
        updateStatusCache(allStatuses);

        const duration = (Date.now() - startTime) / 1000;
        console.log(`✔ Varredura concluída em ${duration.toFixed(2)}s. ${cachedCameraStatus.filter(c => c.status === 'online').length} câmeras online encontradas.`);

    } catch (error) {
        if (error.message === 'Scan timeout') {
            console.warn(`[TIMEOUT] A varredura excedeu ${CONFIG.SCAN_TIMEOUT_MS / 1000}s. Abortando requisições pendentes...`);
            controller.abort();
            scanTimeoutOccurred = true;
        } else {
            console.error('[SCAN_ERROR] Erro inesperado durante a varredura:', error);
        }
    } finally {
        isScanning = false;
    }
}


// --- Agendador e Inicialização ---
function runScheduledScan() {
    scanAllCameras().finally(() => {
        if (scanTimeoutOccurred) {
            console.log(`Próxima tentativa de varredura em ${CONFIG.SCAN_RETRY_DELAY_MS / 1000}s.`);
            nextScanTimestamp = Date.now() + CONFIG.SCAN_RETRY_DELAY_MS;
            setTimeout(runScheduledScan, CONFIG.SCAN_RETRY_DELAY_MS);
        } else {
            nextScanTimestamp = Date.now() + CONFIG.UPDATE_INTERVAL_MS;
            setTimeout(runScheduledScan, CONFIG.UPDATE_INTERVAL_MS);
        }
    });
}

async function startServer() {
    await loadCameraInfo();
    const server = app.listen(CONFIG.PORT, () => {
        console.log(`Servidor executando em http://localhost:${CONFIG.PORT}`);
        runScheduledScan();
    });
    
    process.on('SIGINT', () => {
        console.log('\nDesligando servidor...');
        server.close(() => process.exit(isScanning ? 1 : 0));
    });
}

startServer();

