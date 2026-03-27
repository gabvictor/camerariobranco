const ICameraRepository = require('../../domain/contracts/ICameraRepository');
const Camera = require('../../domain/entities/Camera');
const { admin } = require('../../config/firebaseAdmin');

/**
 * @repository FirebaseCameraRepository
 * Implementação concreta de ICameraRepository usando Firestore.
 *
 * Repository Pattern: Isola completamente o acesso ao Firestore.
 * Se precisar trocar para Postgres, crie PostgresCameraRepository implementando
 * ICameraRepository — nenhum outro arquivo precisa mudar.
 */
class FirebaseCameraRepository extends ICameraRepository {
    constructor(db) {
        super();
        this.db = db;
        this._cache = []; // Cache interno de câmeras carregadas
    }

    /**
     * Retorna todas as câmeras do Firestore como entidades Camera.
     * @returns {Promise<Camera[]>}
     */
    async findAll() {
        if (this._cache.length > 0) return this._cache;
        return this.refresh();
    }

    /**
     * Força recarga do cache a partir do Firestore.
     * @returns {Promise<Camera[]>}
     */
    async refresh() {
        const snapshot = await this.db.collection('cameras').get();
        if (snapshot.empty) {
            console.warn("[WARN] Coleção 'cameras' no Firestore está vazia.");
            this._cache = [];
            return [];
        }
        // Não forçamos new Camera() aqui para não quebrar com dados incompletos no Firestore
        this._cache = snapshot.docs.map(doc => doc.data());
        console.log(`✔ ${this._cache.length} câmeras carregadas do Firestore.`);
        return this._cache;
    }

    /** @returns {Promise<object|null>} */
    async findById(id) {
        const doc = await this.db.collection('cameras').doc(id).get();
        return doc.exists ? doc.data() : null;
    }

    /**
     * Persiste ou atualiza uma câmera no Firestore.
     * @param {Camera} camera
     */
    async save(camera) {
        if (!(camera instanceof Camera)) {
            throw new Error('FirebaseCameraRepository.save() requer uma instância de Camera');
        }
        await this.db.collection('cameras').doc(camera.codigo).set({
            codigo:    camera.codigo,
            nome:      camera.nome,
            categoria: camera.categoria,
            descricao: camera.descricao,
            coords:    camera.coords,
            level:     camera.level,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Invalida cache local
        this._cache = [];
    }

    /** Retorna o cache atual (usado pelo scanner para merge de status) */
    getCached() { return this._cache; }
    clearCache() { this._cache = []; }
}

module.exports = FirebaseCameraRepository;
