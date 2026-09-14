const ISponsorRepository = require('../../domain/contracts/ISponsorRepository');
const Sponsor = require('../../domain/entities/Sponsor');
const SponsorshipPlan = require('../../domain/entities/SponsorshipPlan');
const { admin } = require('../../config/firebaseAdmin');

/**
 * Planos padrão pré-configurados para inicialização
 */
const DEFAULT_PLANS = [
    new SponsorshipPlan({
        id: 'individual',
        nome: 'Cota Individual',
        valor: 149.00,
        maxCameras: 1,
        descricao: 'Ideal para comércios de bairro e empresas que desejam presença estratégica em uma câmera de grande fluxo.',
        beneficios: [
            'Associação com 1 câmera da cidade',
            'Logotipo da empresa em destaque',
            'Link direto para seu Site ou WhatsApp',
            'Identificação visual de "Apresentado por"',
            'Presença permanente na página da câmera'
        ],
        destaqueHome: false,
        badge: ''
    }),
    new SponsorshipPlan({
        id: 'regional',
        nome: 'Cota Regional',
        valor: 249.00,
        maxCameras: 2,
        descricao: 'Excelente para empresas de médio porte que atuam em bairros interligados ou avenidas principais.',
        beneficios: [
            'Associação com até 2 câmeras estratégicas',
            'Logotipo e descrição da sua empresa',
            'Botão direto de contato no WhatsApp',
            'Maior destaque nas páginas das câmeras',
            'Presença na listagem de patrocinadores'
        ],
        destaqueHome: false,
        badge: 'Mais Popular'
    }),
    new SponsorshipPlan({
        id: 'destaque',
        nome: 'Cota Destaque',
        valor: 399.00,
        maxCameras: 4,
        descricao: 'Máxima visibilidade para grandes marcas que desejam cobrir as principais entradas e vias expressas de Rio Branco.',
        beneficios: [
            'Associação com até 4 câmeras de maior audiência',
            'Cartão de Patrocinador em Destaque na Página Inicial',
            'Logotipo, descrição detalhada e link oficial',
            'Destaque no topo dos players de transmissão',
            'Prioridade máxima na exibição de parceiros'
        ],
        destaqueHome: true,
        badge: 'Maior Visibilidade'
    })
];

/**
 * @repository FirebaseSponsorRepository
 * Persistência Firestore para Patrocinadores e Planos Comerciais com cache em memória.
 */
class FirebaseSponsorRepository extends ISponsorRepository {
    constructor(db) {
        super();
        this.db = db;
        this._sponsorsCache = [];
        this._plansCache = [];
        this._lastCacheAt = 0;
        this._cacheTtlMs = 30 * 1000; // 30s cache TTL
    }

    /**
     * Carrega todos os patrocinadores do Firestore.
     * @returns {Promise<Sponsor[]>}
     */
    async findAll() {
        const now = Date.now();
        if (this._sponsorsCache.length > 0 && (now - this._lastCacheAt < this._cacheTtlMs)) {
            return this._sponsorsCache;
        }
        return this.refresh();
    }

    /**
     * Força recarga a partir do Firestore.
     * @returns {Promise<Sponsor[]>}
     */
    async refresh() {
        if (!this.db) return [];

        try {
            const snapshot = await this.db.collection('sponsors').get();
            if (snapshot.empty) {
                this._sponsorsCache = [];
                this._lastCacheAt = Date.now();
                return [];
            }

            this._sponsorsCache = snapshot.docs.map(doc => {
                const data = doc.data();
                return new Sponsor({
                    ...data,
                    id: doc.id
                });
            }).sort((a, b) => (a.posicao - b.posicao) || a.nomeComercial.localeCompare(b.nomeComercial));

            this._lastCacheAt = Date.now();
            return this._sponsorsCache;
        } catch (error) {
            console.error('[SPONSOR_REPO_ERROR] Erro ao carregar patrocinadores:', error.message);
            return this._sponsorsCache;
        }
    }

    /**
     * Busca um patrocinador por ID.
     * @param {string} id
     * @returns {Promise<Sponsor|null>}
     */
    async findById(id) {
        const all = await this.findAll();
        const found = all.find(s => s.id === id);
        if (found) return found;

        if (!this.db) return null;
        try {
            const doc = await this.db.collection('sponsors').doc(id).get();
            if (!doc.exists) return null;
            return new Sponsor({ ...doc.data(), id: doc.id });
        } catch (error) {
            console.error('[SPONSOR_REPO_ERROR] Erro ao buscar por id:', error.message);
            return null;
        }
    }

    /**
     * Retorna apenas patrocinadores ativos para exibição pública.
     * @returns {Promise<Sponsor[]>}
     */
    async findActive() {
        const all = await this.findAll();
        return all.filter(s => s.isAtivoPublico());
    }

    /**
     * Busca patrocinador ativo associado a uma câmera.
     * @param {string} cameraCode
     * @returns {Promise<Sponsor|null>}
     */
    async findByCameraCode(cameraCode) {
        const active = await this.findActive();
        const codeStr = String(cameraCode).trim();
        // Prioriza pela posição configurada
        return active.find(s => s.patrocinaCamera(codeStr)) || null;
    }

    /**
     * Salva ou atualiza um patrocinador no Firestore.
     * @param {Sponsor} sponsor
     * @returns {Promise<Sponsor>}
     */
    async save(sponsor) {
        if (!this.db) throw new Error('Firestore não inicializado');

        const data = sponsor.toJSON();
        let docRef;

        if (sponsor.id) {
            docRef = this.db.collection('sponsors').doc(sponsor.id);
            await docRef.set({
                ...data,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } else {
            docRef = this.db.collection('sponsors').doc();
            data.id = docRef.id;
            await docRef.set({
                ...data,
                id: docRef.id,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            sponsor.id = docRef.id;
        }

        // Invalida cache
        this._sponsorsCache = [];
        this._lastCacheAt = 0;
        return sponsor;
    }

    /**
     * Remove um patrocinador.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        if (!this.db) return false;
        try {
            await this.db.collection('sponsors').doc(id).delete();
            this._sponsorsCache = [];
            this._lastCacheAt = 0;
            return true;
        } catch (error) {
            console.error('[SPONSOR_REPO_ERROR] Erro ao excluir patrocinador:', error.message);
            return false;
        }
    }

    /**
     * Obtém a lista de planos cadastrados (com fallback e auto-seed).
     * @returns {Promise<SponsorshipPlan[]>}
     */
    async getPlans() {
        if (this._plansCache.length > 0) {
            return this._plansCache;
        }

        if (!this.db) return DEFAULT_PLANS;

        try {
            const snapshot = await this.db.collection('sponsorship_plans').get();
            if (snapshot.empty) {
                // Auto-seed inicial dos planos padrão no Firestore
                for (const plan of DEFAULT_PLANS) {
                    await this.db.collection('sponsorship_plans').doc(plan.id).set(plan.toJSON());
                }
                this._plansCache = DEFAULT_PLANS;
                return this._plansCache;
            }

            this._plansCache = snapshot.docs.map(doc => new SponsorshipPlan({
                ...doc.data(),
                id: doc.id
            }));

            return this._plansCache;
        } catch (error) {
            console.error('[SPONSOR_REPO_ERROR] Erro ao obter planos:', error.message);
            return DEFAULT_PLANS;
        }
    }

    /**
     * Atualiza dados de um plano comercial.
     * @param {SponsorshipPlan} plan
     */
    async savePlan(plan) {
        if (!this.db) return;
        await this.db.collection('sponsorship_plans').doc(plan.id).set(plan.toJSON(), { merge: true });
        this._plansCache = [];
    }
}

module.exports = FirebaseSponsorRepository;
