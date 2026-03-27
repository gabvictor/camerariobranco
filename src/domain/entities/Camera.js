/**
 * @entity Camera
 * Representa uma câmera pública de monitoramento.
 * Esta classe é pura — sem dependências de framework ou banco de dados.
 */
class Camera {
    constructor({ codigo, nome, categoria, descricao, coords, level, status }) {
        if (!codigo) throw new Error('Camera.codigo é obrigatório');
        if (!nome)   throw new Error('Camera.nome é obrigatório');

        this.codigo    = codigo;
        this.nome      = nome;
        this.categoria = categoria || 'Sem Categoria';
        this.descricao = descricao || '';
        this.coords    = coords    || null;
        this.level     = Number(level) || 1;
        this.status    = status    || 'offline';
    }

    isOnline()   { return this.status === 'online'; }
    isRestricted() { return this.level === 3; }
    isPublic()   { return this.level === 1 || !this.level; }
}

module.exports = Camera;
