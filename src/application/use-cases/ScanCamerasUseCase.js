const CONFIG = require('../../config/appConfig');
const { setMaxListeners } = require('events');

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
     * Executa a varredura completa de câmeras no intervalo de códigos configurado
     * e inclui também quaisquer códigos adicionais fornecidos.
     * @param {string[]} [extraCodes=[]]
     * @returns {Promise<Array<{codigo: string, status: 'online'|'offline'}>>}
     */
    async execute(extraCodes = []) {
        const rangeCodes = Array.from(
            { length: CONFIG.CAMERA_CODE_END - CONFIG.CAMERA_CODE_START + 1 },
            (_, i) => (CONFIG.CAMERA_CODE_START + i).toString().padStart(6, '0')
        );

        const codeSet = new Set([...rangeCodes, ...(Array.isArray(extraCodes) ? extraCodes : [])]);
        const codes = Array.from(codeSet).sort();

        const controller = new AbortController();
        try { setMaxListeners(CONFIG.CONCURRENCY_LIMIT + 10, controller.signal); } catch (_) {}
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

        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                controller.abort();
                reject(new Error('SCAN_TIMEOUT'));
            }, CONFIG.SCAN_TIMEOUT_MS);
        });

        try {
            return await Promise.race([scanPromise, timeoutPromise]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }
}

module.exports = ScanCamerasUseCase;
