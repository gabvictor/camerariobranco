const IReportRepository = require('../../domain/contracts/IReportRepository');
const Report = require('../../domain/entities/Report');
const { admin } = require('../../config/firebaseAdmin');

/**
 * @repository FirebaseReportRepository
 * Implementação concreta de IReportRepository usando Firestore.
 */
class FirebaseReportRepository extends IReportRepository {
    constructor(db) {
        super();
        this.db = db;
    }

    /** @returns {Promise<Array<{id: string, ...}>>} */
    async findAll({ limit = 50 } = {}) {
        const snapshot = await this.db
            .collection('reports')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    /**
     * @param {Report} report
     * @returns {Promise<string>} ID do documento criado
     */
    async create(report) {
        const docRef = await this.db.collection('reports').add({
            cameraId:    report.cameraId,
            issueType:   report.issueType,
            description: report.description,
            userEmail:   report.userEmail,
            userAgent:   report.userAgent,
            status:      report.status,
            timestamp:   admin.firestore.FieldValue.serverTimestamp()
        });
        return docRef.id;
    }

    /** @returns {Promise<void>} */
    async updateStatus(id, status) {
        if (!Report.isValidStatus(status)) {
            throw new Error(`Status inválido: ${status}. Válidos: ${Report.STATUSES.join(', ')}`);
        }
        const ref = this.db.collection('reports').doc(id);
        const doc = await ref.get();
        if (!doc.exists) throw new Error(`Reporte ${id} não encontrado`);
        await ref.update({ status });
    }

    /** @returns {Promise<void>} */
    async delete(id) {
        const ref = this.db.collection('reports').doc(id);
        const doc = await ref.get();
        if (!doc.exists) throw new Error(`Reporte ${id} não encontrado`);
        await ref.delete();
    }
}

module.exports = FirebaseReportRepository;
