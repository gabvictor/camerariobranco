/**
 * @contract ISponsorRepository
 * Define a interface de persistência para patrocinadores e planos.
 * Princípio da Inversão de Dependência (Clean Architecture).
 */
class ISponsorRepository {
    /** @returns {Promise<import('../entities/Sponsor')[]>} */
    async findAll() { throw new Error('ISponsorRepository.findAll() não implementado'); }

    /** @returns {Promise<import('../entities/Sponsor')|null>} */
    async findById(id) { throw new Error('ISponsorRepository.findById() não implementado'); }

    /** @returns {Promise<import('../entities/Sponsor')[]>} */
    async findActive() { throw new Error('ISponsorRepository.findActive() não implementado'); }

    /** @returns {Promise<import('../entities/Sponsor')|null>} */
    async findByCameraCode(code) { throw new Error('ISponsorRepository.findByCameraCode() não implementado'); }

    /** @returns {Promise<import('../entities/Sponsor')>} */
    async save(sponsor) { throw new Error('ISponsorRepository.save() não implementado'); }

    /** @returns {Promise<boolean>} */
    async delete(id) { throw new Error('ISponsorRepository.delete() não implementado'); }

    /** @returns {Promise<import('../entities/SponsorshipPlan')[]>} */
    async getPlans() { throw new Error('ISponsorRepository.getPlans() não implementado'); }

    /** @returns {Promise<void>} */
    async savePlan(plan) { throw new Error('ISponsorRepository.savePlan() não implementado'); }
}

module.exports = ISponsorRepository;
