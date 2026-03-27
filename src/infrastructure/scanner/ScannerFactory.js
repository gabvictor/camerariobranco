const PrefeituraScanner = require('./PrefeituraScanner');

/**
 * @factory ScannerFactory
 * Cria a instância correta de IScannerService com base em configuração.
 *
 * Factory Pattern: O caller não precisa saber qual implementação usar.
 * Adicionar um 'MockScanner' para testes é só adicionar um case aqui.
 */
class ScannerFactory {
    /** @returns {import('../../domain/contracts/IScannerService')} */
    static create(source = process.env.SCANNER_SOURCE || 'prefeitura') {
        switch (source) {
            case 'prefeitura':
                return new PrefeituraScanner();
            default:
                throw new Error(`ScannerFactory: fonte desconhecida '${source}'. Use: prefeitura`);
        }
    }
}

module.exports = ScannerFactory;
