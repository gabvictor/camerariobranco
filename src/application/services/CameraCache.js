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
     * enriquecendo com os dados das câmeras cadastradas.
     *
     * @param {Array<{codigo, status}>} statuses
     * @param {Array<object>} cameraInfoList
     */
    update(statuses, cameraInfoList = []) {
        const statusMap = new Map((statuses || []).map(s => [s.codigo, s.status]));

        // Se houver câmeras cadastradas no repositório, usa elas como base oficial
        if (Array.isArray(cameraInfoList) && cameraInfoList.length > 0) {
            const validCams = cameraInfoList.filter(c => c && c.codigo);
            this._cache = validCams.map(cam => ({
                ...cam,
                status: statusMap.get(cam.codigo) || 'offline',
                nome: cam.nome || `Câmera ${cam.codigo}`,
                categoria: cam.categoria || cam.bairro || 'Sem Categoria',
                coords: cam.coords || null,
                descricao: cam.descricao || '',
                level: cam.level || 1
            })).sort((a, b) =>
                (a.status === 'online' ? -1 : 1) - (b.status === 'online' ? -1 : 1) ||
                a.nome.localeCompare(b.nome)
            );
            return;
        }

        // Fallback apenas se a lista de câmeras do Firestore estiver vazia
        this._cache = (statuses || []).map(status => ({
            ...status,
            nome: `Câmera ${status.codigo}`,
            categoria: 'Sem Categoria',
            coords: null,
            descricao: '',
            level: 1
        }));
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
