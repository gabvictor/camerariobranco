const EventEmitter = require('events');
const CONFIG = require('../../config/appConfig');
const ScanCamerasUseCase = require('../../application/use-cases/ScanCamerasUseCase');

/**
 * @scheduler ScanScheduler
 * Responsável APENAS pelo agendamento e ciclo de vida das varreduras.
 *
 * Observer Pattern (EventEmitter): Emite eventos para que outros módulos
 * (cache, métricas, logs) reajam sem acoplamento direto.
 *
 * SRP: Não sabe nada sobre câmeras, apenas agenda e emite eventos.
 *
 * Eventos emitidos:
 *   'scan:start'    — antes de iniciar
 *   'scan:complete' — { statuses, durationMs }
 *   'scan:timeout'  — varredura abortada por timeout
 *   'scan:error'    — { error }
 */
class ScanScheduler extends EventEmitter {
    /**
     * @param {import('../../domain/contracts/IScannerService')} scanner
     */
    constructor(scanner) {
        super();
        this.scanner = scanner;
        this.isScanning = false;
        this.scanTimeoutOccurred = false;
        this.nextScanTimestamp = Date.now();
        this._useCase = new ScanCamerasUseCase(scanner);
    }

    async runOnce() {
        if (this.isScanning) return;
        this.isScanning = true;
        this.scanTimeoutOccurred = false;
        const startTime = Date.now();

        this.emit('scan:start');
        console.log(`[${new Date().toLocaleTimeString()}] Iniciando varredura...`);

        try {
            const statuses = await this._useCase.execute();
            const durationMs = Date.now() - startTime;
            const online = statuses.filter(c => c.status === 'online').length;
            console.log(`✔ Varredura concluída em ${(durationMs / 1000).toFixed(2)}s. ${online} câmeras online.`);
            this.emit('scan:complete', { statuses, durationMs });
        } catch (error) {
            if (error.message === 'SCAN_TIMEOUT') {
                console.warn(`[TIMEOUT] Varredura excedeu ${CONFIG.SCAN_TIMEOUT_MS / 1000}s.`);
                this.scanTimeoutOccurred = true;
                this.emit('scan:timeout');
            } else {
                console.error('[SCAN_ERROR]', error);
                this.emit('scan:error', { error });
            }
        } finally {
            this.isScanning = false;
        }
    }

    /** Inicia o loop de varredura agendada */
    start() {
        this.runOnce().finally(() => {
            const delay = this.scanTimeoutOccurred
                ? CONFIG.SCAN_RETRY_DELAY_MS
                : CONFIG.UPDATE_INTERVAL_MS;
            console.log(`Próxima varredura em ${delay / 1000}s.`);
            this.nextScanTimestamp = Date.now() + delay;
            setTimeout(() => this.start(), delay);
        });
        return this;
    }

    getStatus() {
        return {
            isScanning: this.isScanning,
            scanTimeoutOccurred: this.scanTimeoutOccurred,
            nextScanTimestamp: this.nextScanTimestamp
        };
    }
}

module.exports = ScanScheduler;
