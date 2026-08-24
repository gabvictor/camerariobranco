const path = require('path');

// Resolve project root path
const projectRoot = 'c:/Users/gabvictor/Desktop/camerariobranco-main';
const axios = require(path.join(projectRoot, 'node_modules/axios'));
const { admin, db } = require(path.join(projectRoot, 'src/config/firebaseAdmin'));
const CONFIG = require(path.join(projectRoot, 'src/config/appConfig'));

async function checkCameraImage(code) {
    const url = `https://cameras.riobranco.ac.gov.br/api/camera?code=${code}&timestamp=${Date.now()}`;
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer':    'https://deolhonotransito.riobranco.ac.gov.br',
        'Origin':     'https://deolhonotransito.riobranco.ac.gov.br',
        'Accept':     'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    };
    try {
        const start = Date.now();
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers
        });
        const duration = Date.now() - start;
        const sizeBytes = Buffer.byteLength(response.data);
        const minSizeBytes = (CONFIG.MIN_IMAGE_SIZE_KB || 5) * 1024;
        const isOnline = sizeBytes > minSizeBytes;
        return {
            ok: true,
            status: response.status,
            sizeBytes,
            durationMs: duration,
            isOnline,
            contentType: response.headers['content-type']
        };
    } catch (error) {
        return {
            ok: false,
            message: error.message,
            status: error.response ? error.response.status : null
        };
    }
}

async function run() {
    console.log("Checking cameras from Firestore...");
    const snapshot = await db.collection('cameras').get();
    if (snapshot.empty) {
        console.log("❌ No cameras found in Firestore.");
        process.exit(1);
    }
    console.log(`✅ Found ${snapshot.size} cameras in Firestore.`);
    
    const cameras = snapshot.docs.map(doc => doc.data());
    
    console.log(`\nTesting all ${cameras.length} cameras concurrently...`);
    let onlineCount = 0;
    const batchSize = 30;
    
    for (let i = 0; i < cameras.length; i += batchSize) {
        const batch = cameras.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (cam) => {
            const result = await checkCameraImage(cam.codigo);
            return { cam, result };
        }));
        
        for (const { cam, result } of results) {
            if (result.ok && result.isOnline) {
                onlineCount++;
                console.log(`✔ Online: ${cam.nome} (${cam.codigo}) - Status: ${result.status}, Size: ${result.sizeBytes} bytes, Duration: ${result.durationMs}ms`);
            }
        }
    }
    console.log(`\nDone checking. Total online found: ${onlineCount}`);
}

run().catch(err => {
    console.error("FATAL ERROR:", err);
});
