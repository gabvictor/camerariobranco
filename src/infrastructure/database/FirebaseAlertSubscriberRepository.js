const SUBSCRIBERS = 'alertSubscribers';
const STATE_DOC = { collection: 'system', id: 'rioAlertState' };

/**
 * Inscritos nos alertas do Rio Acre e estado do disparador.
 * Acesso somente pelo servidor (Admin SDK): as regras do Firestore bloqueiam o cliente.
 */
class FirebaseAlertSubscriberRepository {
    constructor(db) {
        this._db = db;
    }

    _col() {
        return this._db.collection(SUBSCRIBERS);
    }

    async getSubscriber(id) {
        const snap = await this._col().doc(id).get();
        return snap.exists ? { id, ...snap.data() } : null;
    }

    async saveSubscriber(sub) {
        const { id, ...data } = sub;
        await this._col().doc(id).set(data);
    }

    async listActiveSubscribers() {
        const snap = await this._col().where('status', '==', 'active').get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    async countByStatus() {
        const snap = await this._col().select('status').get();
        const out = { ativos: 0, pendentes: 0, cancelados: 0 };
        snap.docs.forEach((d) => {
            const status = d.get('status');
            if (status === 'active') out.ativos++;
            else if (status === 'pending') out.pendentes++;
            else if (status === 'unsubscribed') out.cancelados++;
        });
        return out;
    }

    async listPendingSubscribers() {
        const snap = await this._col().where('status', '==', 'pending').get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    async deleteSubscriber(id) {
        await this._col().doc(id).delete();
    }

    async markNotified(id, eventId) {
        await this._col().doc(id).update({ lastEventId: eventId, lastNotifiedAt: Date.now() });
    }

    async getState() {
        const snap = await this._db.collection(STATE_DOC.collection).doc(STATE_DOC.id).get();
        return snap.exists ? snap.data() : null;
    }

    async saveState(state) {
        await this._db.collection(STATE_DOC.collection).doc(STATE_DOC.id).set(state);
    }
}

module.exports = FirebaseAlertSubscriberRepository;
