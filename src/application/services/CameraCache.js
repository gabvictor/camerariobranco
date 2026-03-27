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
     * enriquecendo com os dados das câmeras.
     *
     * @param {Array<{codigo, status}>} statuses
     * @param {Array<object>} cameraInfoList
     */
    update(statuses, cameraInfoList) {
        this._cache = statuses.map(status => {
            const info = cameraInfoList.find(i => i.codigo === status.codigo);
            return {
                ...status,
                nome:      info ? info.nome      : `Câmera ${status.codigo}`,
                categoria: info ? info.categoria : 'Sem Categoria',
                coords:    info ? info.coords    : null,
                descricao: info ? info.descricao : '',
                level:     info ? info.level     : 1
            };
        }).sort((a, b) =>
            (a.status === 'online' ? -1 : 1) - (b.status === 'online' ? -1 : 1) ||
            a.nome.localeCompare(b.nome)
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
