/**
 * @entity SponsorshipPlan
 * Representa um Plano Comercial de Patrocínio do CamRB.
 */
class SponsorshipPlan {
    /**
     * @param {object} params
     * @param {string} params.id - Ex: 'individual', 'regional', 'destaque'
     * @param {string} params.nome - Ex: 'Cota Individual'
     * @param {number} params.valor - Ex: 149.00
     * @param {number} params.maxCameras - Quantidade máxima de câmeras incluídas
     * @param {string} params.descricao - Resumo do plano
     * @param {string[]} params.beneficios - Lista de benefícios
     * @param {boolean} [params.destaqueHome] - Se ganha destaque na página inicial
     * @param {string} [params.badge] - Texto de destaque visual (ex: 'Mais Popular')
     * @param {boolean} [params.ativo]
     */
    constructor({
        id,
        nome,
        valor,
        maxCameras = 1,
        descricao = '',
        beneficios = [],
        destaqueHome = false,
        badge = '',
        ativo = true
    }) {
        if (!id) throw new Error('SponsorshipPlan.id é obrigatório');
        if (!nome) throw new Error('SponsorshipPlan.nome é obrigatório');

        this.id = id;
        this.nome = nome;
        this.valor = Number(valor) || 0;
        this.maxCameras = Number(maxCameras) || 1;
        this.descricao = descricao;
        this.beneficios = Array.isArray(beneficios) ? beneficios : [];
        this.destaqueHome = Boolean(destaqueHome);
        this.badge = badge || '';
        this.ativo = ativo !== false;
    }

    toJSON() {
        return {
            id: this.id,
            nome: this.nome,
            valor: this.valor,
            maxCameras: this.maxCameras,
            descricao: this.descricao,
            beneficios: this.beneficios,
            destaqueHome: this.destaqueHome,
            badge: this.badge,
            ativo: this.ativo
        };
    }
}

module.exports = SponsorshipPlan;
