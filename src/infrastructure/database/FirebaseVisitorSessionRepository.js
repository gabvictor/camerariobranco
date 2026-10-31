const SESSIONS = 'visitor_sessions';

/**
 * Perfis de visita (detalhe, apagados após a retenção) e resumo diário.
 * Acesso somente pelo servidor (Admin SDK); nenhum cliente lê ou escreve.
 */
class FirebaseVisitorSessionRepository {
    /**
     * @param {object} db     Firestore
     * @param {object} admin  firebase-admin (para increment/serverTimestamp)
     */
    constructor(db, admin) {
        this._db = db;
        this._admin = admin;
    }

    _daily(date) {
        return this._db.collection('stats').doc('visitors').collection('daily').doc(date);
    }

    async saveSession(record) {
        await this._db.collection(SESSIONS).doc(`${record.sid}_${record.startedAtMs}`).set(record);
    }

    /** Soma os contadores do dia (increment atômico), sem sobrescrever o que já existe. */
    async addDaily(date, d) {
        const FieldValue = this._admin.firestore.FieldValue;
        const inc = (n) => FieldValue.increment(n);
        const mapInc = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, inc(v)]));

        await this._daily(date).set({
            date,
            sessions: inc(d.sessions), seconds: inc(d.seconds), bounces: inc(d.bounces),
            logged: inc(d.logged), withCamera: inc(d.withCamera), pageViews: inc(d.pageViews),
            hours: mapInc(d.hours), devices: mapInc(d.devices),
            cameraSeconds: mapInc(d.cameraSeconds), cameraSessions: mapInc(d.cameraSessions),
            pageSeconds: mapInc(d.pageSeconds),
            cameraNames: d.cameraNames || {}, pagePaths: d.pagePaths || {},
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    }

    /** @returns {Promise<Record<string, object>>} data -> contadores do dia */
    async getDaily(dates) {
        const refs = dates.map((date) => this._daily(date));
        if (!refs.length) return {};
        const snaps = await this._db.getAll(...refs);
        const out = {};
        snaps.forEach((snap, i) => { if (snap.exists) out[dates[i]] = snap.data(); });
        return out;
    }

    async listSessions({ sinceMs, limit = 200 }) {
        const snap = await this._db.collection(SESSIONS)
            .where('endedAtMs', '>=', sinceMs)
            .orderBy('endedAtMs', 'desc')
            .limit(limit)
            .get();
        return snap.docs.map((d) => d.data());
    }

    /** Apaga perfis com mais de `cutoffMs`; devolve quantos foram removidos. */
    async purgeOlderThan(cutoffMs) {
        let removed = 0;
        for (let round = 0; round < 10; round++) {
            const snap = await this._db.collection(SESSIONS).where('endedAtMs', '<', cutoffMs).limit(400).get();
            if (snap.empty) break;
            const batch = this._db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            removed += snap.size;
            if (snap.size < 400) break;
        }
        return removed;
    }
}

module.exports = FirebaseVisitorSessionRepository;
