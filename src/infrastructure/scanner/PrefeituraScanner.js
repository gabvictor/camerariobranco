const axios = require('axios');
const IScannerService = require('../../domain/contracts/IScannerService');
const CONFIG = require('../../config/appConfig');

/**
 * @strategy PrefeituraScanner
 * Implementação concreta de IScannerService para a API da Prefeitura de Rio Branco.
 *
 * Strategy Pattern: Toda a lógica específica desta fonte está isolada aqui.
 * Para adicionar uma segunda fonte, basta criar outro arquivo implementando IScannerService.
 */
class PrefeituraScanner extends IScannerService {
    constructor() {
        super();
        this._headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer':    'https://deolhonotransito.riobranco.ac.gov.br',
            'Origin':     'https://deolhonotransito.riobranco.ac.gov.br',
            'Accept':     'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        };
    }

    _buildUrl(code) {
        return `https://cameras.riobranco.ac.gov.br/api/camera?code=${code}&timestamp=${Date.now()}`;
    }

    /**
     * @param {string} code
     * @param {AbortSignal} [signal]
     * @returns {Promise<{codigo: string, status: 'online'|'offline'}>}
     */
    async checkStatus(code, signal) {
        const url = this._buildUrl(code);
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: CONFIG.REQUEST_TIMEOUT,
                signal,
                headers: this._headers
            });
            const isOnline = Buffer.byteLength(response.data) > CONFIG.MIN_IMAGE_SIZE_KB * 1024;
            return { codigo: code, status: isOnline ? 'online' : 'offline' };
        } catch {
            return { codigo: code, status: 'offline' };
        }
    }
}

module.exports = PrefeituraScanner;
