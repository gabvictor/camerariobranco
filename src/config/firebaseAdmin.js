const admin = require('firebase-admin');
const fs = require('fs');

let db;
let serviceAccount = {};

try {
    const secretPath = fs.existsSync('/etc/secrets/serviceAccountKey.json')
        ? '/etc/secrets/serviceAccountKey.json'
        : './serviceAccountKey.json';

    console.log(`✔ Carregando credenciais do Firebase de: ${secretPath}`);
    serviceAccount = JSON.parse(fs.readFileSync(secretPath, 'utf8'));

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✔ Firebase Admin SDK inicializado com sucesso.");

    db = admin.firestore();
    console.log("✔ Firebase Firestore inicializado.");
} catch (error) {
    console.error("[ERRO CRÍTICO] Falha ao inicializar o Firebase Admin SDK.", error);
    process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || serviceAccount.admin_email;

module.exports = { admin, db, ADMIN_EMAIL };
