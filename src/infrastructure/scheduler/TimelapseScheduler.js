const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { formatRioBrancoTime, formatRioBrancoDate } = require('../../utils/dateUtils');

/**
 * @scheduler TimelapseScheduler
 * Captura snapshots a cada 30 minutos das câmeras e armazena localmente em disco.
 * Mantém apenas os últimos 24 horas de registros (buffer rotativo).
 */
class TimelapseScheduler {
    /**
     * @param {import('../database/FirebaseCameraRepository')} cameraRepo
     * @param {import('../../application/services/CameraCache')} cameraCache
     * @param {string} storageDir
     */
    constructor(cameraRepo, cameraCache, storageDir) {
        this.cameraRepo = cameraRepo;
        this.cameraCache = cameraCache;
        this.storageDir = storageDir || path.join(__dirname, '..', '..', '..', 'public', 'timelapse');
        this.intervalMs = 30 * 60 * 1000; // 30 minutos
        this.retentionMs = 24 * 60 * 60 * 1000; // 24 horas
        this._timer = null;

        this._ensureStorageDir();
    }

    _ensureStorageDir() {
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }
    }

    /** Inicia o agendador de capturas */
    start() {
        this._ensureStorageDir();
        // Executa uma captura inicial após 10 segundos
        setTimeout(() => this.captureAll(), 10000);

        this._timer = setInterval(() => {
            this.captureAll();
        }, this.intervalMs);

        console.log('✔ TimelapseScheduler iniciado (gravação a cada 30 min em disco local).');
        return this;
    }

    /**
     * Captura snapshot de todas as câmeras online
     */
    async captureAll() {
        const cameras = this.cameraCache.getOnline();
        if (cameras.length === 0) return;

        const now = Date.now();
        console.log(`[TIMELAPSE] Capturando frames de ${cameras.length} câmeras online...`);

        // Executa em lotes de 10 para não sobrecarregar
        const batchSize = 10;
        for (let i = 0; i < cameras.length; i += batchSize) {
            const batch = cameras.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(cam => this._captureCamera(cam.codigo, now)));
        }

        // Limpa frames mais antigos que 24 horas
        this._cleanupOldFrames();
    }

    async _captureCamera(codigo, timestamp) {
        const camDir = path.join(this.storageDir, codigo);
        if (!fs.existsSync(camDir)) {
            fs.mkdirSync(camDir, { recursive: true });
        }

        const url = `https://cameras.riobranco.ac.gov.br/api/camera?code=${codigo}&timestamp=${timestamp}`;
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://deolhonotransito.riobranco.ac.gov.br',
                    'Origin': 'https://deolhonotransito.riobranco.ac.gov.br'
                }
            });

            if (Buffer.byteLength(response.data) > 10 * 1024) {
                const filePath = path.join(camDir, `${timestamp}.jpg`);
                fs.writeFileSync(filePath, response.data);
            }
        } catch (error) {
            // Ignora falhas pontuais de captura
        }
    }

    /**
     * Remove frames com mais de 24 horas
     */
    _cleanupOldFrames() {
        try {
            const cutoff = Date.now() - this.retentionMs;
            const cameraDirs = fs.readdirSync(this.storageDir);

            for (const camDir of cameraDirs) {
                const fullCamPath = path.join(this.storageDir, camDir);
                if (!fs.statSync(fullCamPath).isDirectory()) continue;

                const files = fs.readdirSync(fullCamPath);
                for (const file of files) {
                    if (!file.endsWith('.jpg')) continue;
                    const timestamp = parseInt(file.replace('.jpg', ''), 10);
                    if (Number.isFinite(timestamp) && timestamp < cutoff) {
                        fs.unlinkSync(path.join(fullCamPath, file));
                    }
                }
            }
        } catch (e) {
            console.error('[TIMELAPSE_CLEANUP_ERROR]', e.message);
        }
    }

    /**
     * Retorna a lista de frames disponíveis para uma câmera nas últimas 24h
     * @param {string} cameraCode
     * @returns {Array<{timestamp: number, url: string, timeFormatted: string}>}
     */
    getFrames(cameraCode) {
        const camDir = path.join(this.storageDir, cameraCode);
        if (!fs.existsSync(camDir)) return [];

        const files = fs.readdirSync(camDir);
        const frames = [];

        for (const file of files) {
            if (!file.endsWith('.jpg')) continue;
            const ts = parseInt(file.replace('.jpg', ''), 10);
            if (Number.isFinite(ts)) {
                const timeFormatted = formatRioBrancoTime(ts);
                const dateFormatted = formatRioBrancoDate(ts);

                frames.push({
                    timestamp: ts,
                    url: `/timelapse/${cameraCode}/${file}`,
                    timeFormatted,
                    dateFormatted,
                    fullLabel: `${dateFormatted} às ${timeFormatted}`
                });
            }
        }

        return frames.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Altera o intervalo de captura dinamicamente
     * @param {number} minutes
     */
    setIntervalMinutes(minutes) {
        const mins = Math.max(1, Math.min(parseInt(minutes, 10) || 30, 1440));
        this.intervalMs = mins * 60 * 1000;

        if (this._timer) {
            clearInterval(this._timer);
            this._timer = setInterval(() => {
                this.captureAll();
            }, this.intervalMs);
        }

        console.log(`✔ TimelapseScheduler atualizado para intervalo de ${mins} minuto(s).`);
        return mins;
    }

    getIntervalMinutes() {
        return Math.round(this.intervalMs / (60 * 1000));
    }

    /**
     * Executa captura imediata de todas as câmeras online
     */
    async captureNow() {
        await this.captureAll();
        return this.getStats();
    }

    /**
     * Exclui todas as fotos de timelapse salvas
     */
    deleteAllFrames() {
        try {
            if (fs.existsSync(this.storageDir)) {
                const cameraDirs = fs.readdirSync(this.storageDir);
                for (const camDir of cameraDirs) {
                    const fullCamPath = path.join(this.storageDir, camDir);
                    if (fs.statSync(fullCamPath).isDirectory()) {
                        const files = fs.readdirSync(fullCamPath);
                        for (const file of files) {
                            fs.unlinkSync(path.join(fullCamPath, file));
                        }
                        fs.rmdirSync(fullCamPath);
                    }
                }
            }
            this._ensureStorageDir();
            console.log('✔ Todas as fotos do Timelapse foram excluídas com sucesso.');
            return { success: true, message: 'Todos os snapshots foram excluídos.' };
        } catch (error) {
            console.error('[TIMELAPSE_DELETE_ALL_ERROR]', error);
            throw error;
        }
    }

    /**
     * Retorna estatísticas de uso do Timelapse
     */
    getStats() {
        let totalFrames = 0;
        let totalSizeBytes = 0;
        let cameraCount = 0;

        try {
            if (fs.existsSync(this.storageDir)) {
                const cameraDirs = fs.readdirSync(this.storageDir);
                for (const camDir of cameraDirs) {
                    const fullCamPath = path.join(this.storageDir, camDir);
                    if (fs.statSync(fullCamPath).isDirectory()) {
                        const files = fs.readdirSync(fullCamPath).filter(f => f.endsWith('.jpg'));
                        if (files.length > 0) {
                            cameraCount++;
                            totalFrames += files.length;
                            for (const file of files) {
                                try {
                                    totalSizeBytes += fs.statSync(path.join(fullCamPath, file)).size;
                                } catch (_) {}
                            }
                        }
                    }
                }
            }
        } catch (_) {}

        const totalSizeMb = (totalSizeBytes / (1024 * 1024)).toFixed(2);

        return {
            totalFrames,
            cameraCount,
            totalSizeBytes,
            totalSizeFormatted: `${totalSizeMb} MB`,
            intervalMinutes: this.getIntervalMinutes()
        };
    }
}

module.exports = TimelapseScheduler;
