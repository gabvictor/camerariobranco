/**
 * @contract IReportRepository
 * Define o contrato para persistência de reportes.
 */
class IReportRepository {
    /** @returns {Promise<{id: string, ...}[]>} */
    async findAll({ limit, orderBy } = {}) { throw new Error('IReportRepository.findAll() não implementado'); }

    /** @returns {Promise<string>} id do documento criado */
    async create(report) { throw new Error('IReportRepository.create() não implementado'); }

    /** @returns {Promise<void>} */
    async updateStatus(id, status) { throw new Error('IReportRepository.updateStatus() não implementado'); }

    /** @returns {Promise<void>} */
    async delete(id) { throw new Error('IReportRepository.delete() não implementado'); }
}

module.exports = IReportRepository;
