/**
 * @service CameraCache
 * Mantém o estado em memória dos status das câmeras (online/offline + metadata).
 *
 * SRP: Só gerencia o cache — não busca no banco, não faz HTTP.
 * Listener do evento 'scan:complete' do ScanScheduler.
 */
class CameraCache {
    constructor() {
        this._cache = [];
    }

    /**
     * Atualiza o cache a partir dos resultados de uma varredura,
     * unificando TODAS as câmeras (da varredura completa + cadastradas no Firestore).
     *
     * @param {Array<{codigo: string, status: string}>} [statuses=[]]
     * @param {Array<object>} [cameraInfoList=[]]
     */
    update(statuses = [], cameraInfoList = []) {
        const validStatuses = Array.isArray(statuses) ? statuses : [];
        const validCameraInfoList = Array.isArray(cameraInfoList) ? cameraInfoList : [];

        const statusMap = new Map(validStatuses.map(s => [s.codigo, s.status]));
        const cameraMap = new Map(validCameraInfoList.filter(c => c && c.codigo).map(c => [c.codigo, c]));
        const existingMap = new Map(this._cache.map(c => [c.codigo, c]));

        // Une todos os códigos conhecidos (varredura + Firebase + cache atual)
        const allCodes = new Set([
            ...statusMap.keys(),
            ...cameraMap.keys(),
            ...existingMap.keys()
        ]);

        this._cache = Array.from(allCodes).map(code => {
            const firestoreInfo = cameraMap.get(code);
            const existingInfo = existingMap.get(code);

            // Determina o status: nova varredura > cache anterior > offline padrão
            const status = statusMap.get(code)
                || existingInfo?.status
                || 'offline';

            // Dados enriquecidos do Firebase têm prioridade, senão do cache anterior, senão fallback
            const nome = firestoreInfo?.nome
                || existingInfo?.nome
                || `Câmera ${code}`;

            const categoria = firestoreInfo?.categoria
                || firestoreInfo?.bairro
                || existingInfo?.categoria
                || 'Sem Categoria';

            const coords = firestoreInfo?.coords
                || existingInfo?.coords
                || null;

            const descricao = firestoreInfo?.descricao
                || existingInfo?.descricao
                || '';

            const level = (firestoreInfo?.level !== undefined)
                ? firestoreInfo.level
                : (existingInfo?.level !== undefined ? existingInfo.level : 1);

            return {
                ...(existingInfo || {}),
                ...(firestoreInfo || {}),
                codigo: code,
                status,
                nome,
                categoria,
                coords,
                descricao,
                level
            };
        }).sort((a, b) =>
            (a.status === 'online' ? -1 : 1) - (b.status === 'online' ? -1 : 1) ||
            a.nome.localeCompare(b.nome) ||
            a.codigo.localeCompare(b.codigo)
        );
    }

    /** @returns {Array} Todos os status cacheados */
    getAll() { return this._cache; }

    /** @returns {Array} Apenas câmeras online */
    getOnline() { return this._cache.filter(c => c.status === 'online'); }

    /** @returns {Array} Câmeras públicas (level 1 ou sem level) */
    getPublic() { return this._cache.filter(c => c.level === 1 || !c.level); }

    /** @returns {object|null} */
    findByCode(code) { return this._cache.find(c => c.codigo === code) || null; }

    get count() { return this._cache.length; }
    get onlineCount() { return this.getOnline().length; }
}

module.exports = CameraCache;
