const Report = require('../../domain/entities/Report');

/**
 * @use-case CreateReportUseCase
 * Cria um reporte de problema para uma câmera.
 * DIP: Depende de IReportRepository, não do Firestore diretamente.
 */
class CreateReportUseCase {
    /**
     * @param {import('../../domain/contracts/IReportRepository')} reportRepository
     */
    constructor(reportRepository) {
        this.reportRepository = reportRepository;
    }

    /**
     * @param {{ cameraId, issueType, description, userEmail, userAgent }} data
     * @returns {Promise<string>} ID do reporte criado
     */
    async execute(data) {
        const report = new Report(data); // validates via entity constructor
        return this.reportRepository.create(report);
    }
}

module.exports = CreateReportUseCase;
