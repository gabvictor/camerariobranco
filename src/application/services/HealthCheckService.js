/**
 * HealthCheckService.js
 * Diagnóstico ativo de dependências e integridade operacional do sistema CamRB.
 */

const axios = require('axios');
const os = require('os');
const { admin, db } = require('../../config/firebaseAdmin');

class HealthCheckService {
    /**
     * @param {import('../../infrastructure/services/RioAcreService')} [rioAcreService]
     * @param {import('../../infrastructure/database/FirebaseCameraRepository')} [cameraRepo]
     */
    constructor(rioAcreService = null, cameraRepo = null) {
        this._rioAcreService = rioAcreService;
        this._cameraRepo = cameraRepo;
    }

    /**
     * Testa a disponibilidade e latência da API externa da Prefeitura
     */
    async checkPrefeituraApi() {
        const start = Date.now();
        try {
            // Testa com uma câmera padrão com os headers exigidos pelo backend da Prefeitura
            const response = await axios.get(`https://cameras.riobranco.ac.gov.br/api/camera?code=001426&timestamp=${Date.now()}`, {
                timeout: 6000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://deolhonotransito.riobranco.ac.gov.br',
                    'Origin': 'https://deolhonotransito.riobranco.ac.gov.br',
                    'Accept': 'image/jpeg,image/*,*/*'
                },
                responseType: 'arraybuffer'
            });
            const latency = Date.now() - start;
            const hasData = response.status === 200 && response.data && response.data.length > 500;
            return {
                status: hasData ? 'healthy' : 'degraded',
                latencyMs: latency,
                message: hasData ? `OK (${response.data.length} bytes recebidos)` : 'Resposta inválida ou frame vazio',
                details: { statusCode: response.status, dataSize: response.data ? response.data.length : 0 }
            };
        } catch (error) {
            return {
                status: 'down',
                latencyMs: Date.now() - start,
                message: error.code === 'ECONNABORTED' ? 'Timeout na conexão com a Prefeitura' : (error.message || 'Falha na conexão'),
                details: { error: error.message, code: error.code }
            };
        }
    }

    /**
     * Testa leitura e gravação no Cloud Firestore
     */
    async checkFirestore() {
        const start = Date.now();
        if (!db) {
            return { status: 'down', latencyMs: 0, message: 'Firestore não inicializado.' };
        }
        try {
            const testRef = db.collection('system_health').doc('ping');
            await testRef.set({ lastPing: new Date().toISOString(), by: 'HealthCheckService' }, { merge: true });
            const snap = await testRef.get();
            const latency = Date.now() - start;
            return {
                status: snap.exists ? 'healthy' : 'degraded',
                latencyMs: latency,
                message: snap.exists ? 'Leitura e escrita operacionais' : 'Falha na persistência',
                details: { testedAt: new Date().toISOString() }
            };
        } catch (error) {
            return {
                status: 'down',
                latencyMs: Date.now() - start,
                message: error.message || 'Erro de comunicação com Firestore',
                details: { error: error.message }
            };
        }
    }

    /**
     * Testa disponibilidade do Firebase Storage
     */
    async checkStorage() {
        const start = Date.now();
        try {
            const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'camerasriobranco.firebasestorage.app';
            const bucket = admin.storage().bucket(bucketName);
            const [exists] = await bucket.exists();
            const latency = Date.now() - start;
            return {
                status: exists ? 'healthy' : 'degraded',
                latencyMs: latency,
                message: exists ? `Bucket ${bucketName} ativo` : 'Bucket não encontrado ou sem permissão',
                details: { bucket: bucketName }
            };
        } catch (error) {
            return {
                status: 'degraded',
                latencyMs: Date.now() - start,
                message: error.message || 'Aviso no Storage',
                details: { error: error.message }
            };
        }
    }

    /**
     * Testa serviço de telemetria do Rio Acre
     */
    async checkRioAcreService() {
        const start = Date.now();
        try {
            if (this._rioAcreService && typeof this._rioAcreService.getNivelRioAcre === 'function') {
                const data = await this._rioAcreService.getNivelRioAcre();
                const latency = Date.now() - start;
                const hasNivel = Boolean(data && data.nivel);
                const nivelStr = (data.nivel && (data.nivel.formatado || data.nivel.metros)) ? (data.nivel.formatado || `${data.nivel.metros} m`) : `${data.nivel} m`;
                const statusStr = (data.status && data.status.tipo) ? data.status.tipo : (data.status || 'Normal');
                return {
                    status: hasNivel ? 'healthy' : 'degraded',
                    latencyMs: latency,
                    message: hasNivel ? `Nível atual: ${nivelStr} (${statusStr})` : 'Dados parciais da telemetria',
                    details: data || {}
                };
            }
            return { status: 'healthy', latencyMs: 0, message: 'Serviço ativo' };
        } catch (error) {
            return {
                status: 'degraded',
                latencyMs: Date.now() - start,
                message: error.message || 'Erro ao consultar telemetria',
                details: { error: error.message }
            };
        }
    }

    /**
     * Executa diagnóstico completo de todos os subsistemas
     */
    async runFullDiagnostic() {
        const timestamp = new Date().toISOString();
        const [prefeitura, firestore, storage, rioAcre] = await Promise.all([
            this.checkPrefeituraApi(),
            this.checkFirestore(),
            this.checkStorage(),
            this.checkRioAcreService()
        ]);

        const services = { prefeitura, firestore, storage, rioAcre };
        const statuses = Object.values(services).map(s => s.status);

        let overallStatus = 'healthy';
        if (statuses.includes('down')) {
            overallStatus = 'critical';
        } else if (statuses.includes('degraded')) {
            overallStatus = 'warning';
        }

        return {
            timestamp,
            overallStatus,
            services,
            environment: {
                platform: os.platform(),
                arch: os.arch(),
                nodeVersion: process.version,
                totalMemoryFormatted: `${Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10} GB`,
                freeMemoryFormatted: `${Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10} GB`,
                uptimeFormatted: `${Math.floor(process.uptime() / 60)} minutos`
            }
        };
    }
}

module.exports = HealthCheckService;
