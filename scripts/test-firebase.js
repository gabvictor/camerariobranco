/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const { admin, db } = require('../src/config/firebaseAdmin');

async function testAuth() {
    const users = await admin.auth().listUsers(1);
    return { ok: true, usersChecked: users.users.length };
}

async function testFirestore() {
    const ref = db.collection('system_health').doc('firebase_test');
    const payload = { testedAt: new Date().toISOString(), source: 'automated-script' };
    await ref.set(payload, { merge: true });
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Documento de teste não foi criado no Firestore');
    await ref.delete();
    return { ok: true };
}

async function testStorage() {
    const projectId = process.env.FIREBASE_PROJECT_ID || 'camerasriobranco';
    const candidateBuckets = [
        process.env.FIREBASE_STORAGE_BUCKET,
        `${projectId}.firebasestorage.app`,
        `${projectId}.appspot.com`
    ].filter(Boolean);

    try {
        const keyFilename = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(process.cwd(), 'serviceAccountKey.json');
        const storage = new Storage({ projectId, keyFilename });
        const [buckets] = await storage.getBuckets({ project: projectId });
        buckets.forEach((bucket) => candidateBuckets.push(bucket.name));
    } catch (error) {
        console.warn('⚠️ Não foi possível listar buckets automaticamente:', error.message);
    }

    let lastError;

    for (const bucketName of [...new Set(candidateBuckets)]) {
        try {
            const bucket = admin.storage().bucket(bucketName);
            const testName = `healthchecks/firebase-storage-${Date.now()}.txt`;
            const testContent = Buffer.from('firebase storage healthcheck');

            await bucket.file(testName).save(testContent, {
                contentType: 'text/plain',
                metadata: { cacheControl: 'private, max-age=0, no-store' }
            });

            const [exists] = await bucket.file(testName).exists();
            if (!exists) throw new Error('Arquivo de teste não foi encontrado no Storage');

            await bucket.file(testName).delete({ ignoreNotFound: true });
            return { ok: true, bucket: bucket.name };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Nenhum bucket de Storage configurado/encontrado para teste.');
}

async function run() {
    const report = {
        timestamp: new Date().toISOString(),
        auth: null,
        firestore: null,
        storage: null,
        success: false,
        errors: []
    };

    const tests = [
        ['auth', testAuth],
        ['firestore', testFirestore],
        ['storage', testStorage]
    ];

    for (const [name, fn] of tests) {
        try {
            report[name] = await fn();
            console.log(`✅ Firebase ${name}: OK`);
        } catch (error) {
            report[name] = { ok: false, message: error.message };
            report.errors.push(`${name}: ${error.message}`);
            console.error(`❌ Firebase ${name}:`, error.message);
        }
    }

    report.success = report.errors.length === 0;

    const outputPath = path.join(process.cwd(), 'firebase-test-report.json');
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    console.log(`📄 Relatório salvo em: ${outputPath}`);
    if (!report.success) process.exit(1);
}

run().catch((error) => {
    console.error('[FATAL] Falha ao executar testes Firebase:', error);
    process.exit(1);
});
