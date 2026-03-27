/**
 * @use-case TrackVisitUseCase
 * Registra uma visita única de página.
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
        const today = new Date().toISOString().split('T')[0];
        const statsRef = this.db.collection('stats').doc('traffic');
        const dailyRef = statsRef.collection('daily').doc(today);

        await this.db.runTransaction(async (t) => {
            const [statsDoc, dailyDoc] = await Promise.all([t.get(statsRef), t.get(dailyRef)]);
            t.set(statsRef, { totalViews: (statsDoc.exists ? (statsDoc.data().totalViews || 0) : 0) + 1 }, { merge: true });
            t.set(dailyRef, { views: (dailyDoc.exists ? (dailyDoc.data().views || 0) : 0) + 1 }, { merge: true });
        });
    }

    async getStats() {
        const today = new Date().toISOString().split('T')[0];
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
