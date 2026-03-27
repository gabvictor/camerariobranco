/**
 * @contract ICameraRepository
 * Define o contrato (interface) para persistência de câmeras.
 * Qualquer implementação concreta (Firebase, Postgres, Mock) DEVE implementar estes métodos.
 *
 * Princípio: Dependency Inversion — a aplicação depende desta abstração,
 * não da implementação concreta do Firestore.
 */
class ICameraRepository {
    /** @returns {Promise<Camera[]>} */
    async findAll() { throw new Error('ICameraRepository.findAll() não implementado'); }

    /** @returns {Promise<Camera|null>} */
    async findById(id) { throw new Error('ICameraRepository.findById() não implementado'); }

    /** @returns {Promise<void>} */
    async save(camera) { throw new Error('ICameraRepository.save() não implementado'); }
}

module.exports = ICameraRepository;
