/**
 * @contract IScannerService
 * Define o contrato para qualquer serviço que verifica o status de uma câmera.
 * Permite implementar Strategy Pattern — ex: PrefeituraScanner, MockScanner.
 */
class IScannerService {
    /**
     * Verifica o status de uma câmera pelo seu código.
     * @param {string} code — Código de 6 dígitos da câmera
     * @param {AbortSignal} [signal] — Sinal para cancelamento
     * @returns {Promise<{codigo: string, status: 'online'|'offline'}>}
     */
    async checkStatus(code, signal) {
        throw new Error('IScannerService.checkStatus() não implementado');
    }
}

module.exports = IScannerService;
