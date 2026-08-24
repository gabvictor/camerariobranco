const { admin } = require('../../config/firebaseAdmin');
const { getRioBrancoDateStr } = require('../../utils/dateUtils');

/**
 * @use-case TrackVisitUseCase
 * Registra uma visita única de página com base no fuso horário do Acre (America/Rio_Branco).
 * Separado do domínio de câmeras para respeitar o SRP.
 */
class TrackVisitUseCase {
    /**
     * @param {object} db — Firestore db instance
     */
    constructor(db) {
        this.db = db;
    }

    async execute() {
        const today = getRioBrancoDateStr();
        const statsRef = this.db.collection('stats').doc('traffic');
        const dailyRef = statsRef.collection('daily').doc(today);

        await Promise.all([
            statsRef.set({ totalViews: admin.firestore.FieldValue.increment(1) }, { merge: true }),
            dailyRef.set({ views: admin.firestore.FieldValue.increment(1) }, { merge: true })
        ]);
    }

    async getStats() {
        const today = getRioBrancoDateStr();
        const statsRef = this.db.collection('stats').doc('traffic');
        const [statsDoc, dailyDoc] = await Promise.all([
            statsRef.get(),
            statsRef.collection('daily').doc(today).get()
        ]);
        return {
            totalViews: statsDoc.exists ? (statsDoc.data().totalViews || 0) : 0,
            viewsToday: dailyDoc.exists ? (dailyDoc.data().views || 0) : 0
        };
    }
}

module.exports = TrackVisitUseCase;
