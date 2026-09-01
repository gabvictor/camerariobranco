const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const LOCAL_SECRET_PATH = path.resolve(process.cwd(), 'serviceAccountKey.json');
const DEPLOY_SECRET_PATH = '/etc/secrets/serviceAccountKey.json';
const ENV_SECRET_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

const resolveSecretPath = () => {
    const candidates = [ENV_SECRET_PATH, DEPLOY_SECRET_PATH, LOCAL_SECRET_PATH].filter(Boolean);
    return candidates.find(candidate => {
        try {
            return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
        } catch {
            return false;
        }
    });
};

let db;
let serviceAccount = {};

try {
    const secretPath = resolveSecretPath();

    if (!secretPath) {
        throw new Error('Arquivo serviceAccountKey.json não encontrado. Defina FIREBASE_SERVICE_ACCOUNT_PATH ou adicione o arquivo na raiz do projeto.');
    }

    serviceAccount = JSON.parse(fs.readFileSync(secretPath, 'utf8'));

    const defaultBucket = process.env.FIREBASE_STORAGE_BUCKET
        || serviceAccount.storage_bucket
        || `${serviceAccount.project_id}.firebasestorage.app`;

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: defaultBucket
    });

    db = admin.firestore();
    console.log(`✔ Firebase Admin inicializado com credenciais de: ${secretPath}`);
} catch (error) {
    console.error('[ERRO CRÍTICO] Falha ao inicializar Firebase Admin SDK:', error.message);
    process.exit(1);
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || serviceAccount.admin_email || '').toLowerCase();

module.exports = { admin, db, ADMIN_EMAIL };
