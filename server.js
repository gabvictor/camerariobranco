const express = require('express');
const axios = require('axios');
const cors = require('cors');
// Mudança: Usar o módulo fs normal, não o de promises
const fs = require('fs'); 
const path = require('path');
const admin = require('firebase-admin');

// --- INÍCIO: CONFIGURAÇÃO SEGURA DO FIREBASE ADMIN ---
try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        console.log("✔ Firebase Admin SDK a inicializar com credenciais de ambiente.");
    } else {
        // Se estiver executando localmente sem a variável de ambiente,
        // ele procurará por serviceAccountKey.json no diretório raiz.
        serviceAccount = require('./serviceAccountKey.json');
        console.log("✔ Firebase Admin SDK a inicializar com ficheiro local.");
    }

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
const PUBLIC_FOLDER = path.join(__dirname, 'public');
const ASSETS_FOLDER = path.join(PUBLIC_FOLDER, 'assets');
const ERROR_IMAGE_PATH = path.join(ASSETS_FOLDER, 'placeholder_error.webp');

// --- Estado da Aplicação ---
let nextScanTimestamp = Date.now();
let isScanning = false;
let scanTimeoutOccurred = false;
let cameraInfo = []; // Agora será preenchido pelo Firestore
let cachedCameraStatus = [];


// --- ROTA DE CORREÇÃO PARA ANDROID APP LINKS (ASSETLINKS.JSON) ---
// Tenta ler o arquivo diretamente e envia o conteúdo como JSON.
app.get('/.well-known/assetlinks.json', (req, res) => {
    const filePath = path.join(PUBLIC_FOLDER, '.well-known', 'assetlinks.json');
    
    try {
        // Leitura Síncrona (apenas para arquivos pequenos e estáticos de configuração)
        const fileContent = fs.readFileSync(filePath, 'utf8');
        
        // Força o Content-Type para garantir a compatibilidade e o formato correto
        res.setHeader('Content-Type', 'application/json');
        
        // Envia o conteúdo lido
        res.status(200).send(fileContent);
        
    } catch (err) {
        console.error('[ASSETLINKS_READ_ERROR] Falha ao ler assetlinks.json:', err.message);
        // Retorna 404 se o arquivo não for encontrado ou não puder ser lido
        res.status(404).send('Not Found');
    }
});
// --- FIM DA ROTA DE CORREÇÃO ---


// --- Middlewares ---
app.use(cors());
app.use(express.json());
// O express.static serve os arquivos da pasta 'public'
app.use(express.static(PUBLIC_FOLDER));


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
    } catch (error) {
        res.status(502).sendFile(ERROR_IMAGE_PATH);
    }
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
    
    if (!codigo || !nome) {
        return res.status(400).json({ message: 'Código e nome são obrigatórios.' });
    }
    
    try {
        const db = admin.firestore();
        const cameraRef = db.collection('cameras').doc(codigo);

        const updatedData = {
            codigo,
            nome,
            categoria,
            descricao,
            coords,
            level: Number(level) || 1
        };
        
        await cameraRef.set(updatedData, { merge: true });
        
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
