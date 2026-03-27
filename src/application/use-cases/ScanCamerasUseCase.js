const CONFIG = require('../../config/appConfig');

/**
 * @use-case ScanCamerasUseCase
 * Orquestra a varredura de todas as câmeras usando o scanner injetado.
 *
 * Strategy Pattern: Recebe qualquer implementação de IScannerService.
 * Observer Pattern: Emite eventos ao final para desacoplar cache e métricas.
 * DIP: Não conhece Axios, Firebase ou HTTP — só o contrato IScannerService.
 */
class ScanCamerasUseCase {
    /**
     * @param {import('../../domain/contracts/IScannerService')} scanner
     */
    constructor(scanner) {
        this.scanner = scanner;
    }

    /**
     * Executa a varredura completa de câmeras no intervalo de códigos configurado.
     * @returns {Promise<Array<{codigo: string, status: 'online'|'offline'}>>}
     */
    async execute() {
        const codes = Array.from(
            { length: CONFIG.CAMERA_CODE_END - CONFIG.CAMERA_CODE_START + 1 },
            (_, i) => (CONFIG.CAMERA_CODE_START + i).toString().padStart(6, '0')
        );

        const controller = new AbortController();
        const allStatuses = [];

        const scanPromise = (async () => {
            for (let i = 0; i < codes.length; i += CONFIG.CONCURRENCY_LIMIT) {
                if (controller.signal.aborted) break;
                const batch = codes.slice(i, i + CONFIG.CONCURRENCY_LIMIT);
                const results = await Promise.allSettled(
                    batch.map(code => this.scanner.checkStatus(code, controller.signal))
                );
                results.forEach(r => {
                    if (r.status === 'fulfilled') allStatuses.push(r.value);
                });
            }
            return allStatuses;
        })();

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => {
                controller.abort();
                reject(new Error('SCAN_TIMEOUT'));
            }, CONFIG.SCAN_TIMEOUT_MS)
        );

        return Promise.race([scanPromise, timeoutPromise]);
    }
}

module.exports = ScanCamerasUseCase;
