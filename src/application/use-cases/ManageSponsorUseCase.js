const Sponsor = require('../../domain/entities/Sponsor');
const SponsorshipPlan = require('../../domain/entities/SponsorshipPlan');
const { sanitizeString, sanitizeMultiline } = require('../../utils/validation');

/**
 * @use-case ManageSponsorUseCase
 * Orquestra regras de negócio para criação, edição, renovação e exclusão de patrocinadores.
 */
class ManageSponsorUseCase {
    /**
     * @param {import('../../domain/contracts/ISponsorRepository')} sponsorRepository
     */
    constructor(sponsorRepository) {
        this.sponsorRepo = sponsorRepository;
    }

    /**
     * Cria um novo patrocinador com validação.
     * @param {object} data
     * @param {string} [adminEmail]
     * @returns {Promise<Sponsor>}
     */
    async create(data, adminEmail = 'admin') {
        const nomeEmpresa = sanitizeString(data.nomeEmpresa, { maxLength: 150 });
        if (!nomeEmpresa) {
            throw new Error('O nome da empresa é obrigatório.');
        }

        const plans = await this.sponsorRepo.getPlans();
        const selectedPlan = plans.find(p => p.id === data.planoId) || plans[0];

        const sponsor = new Sponsor({
            nomeEmpresa,
            nomeComercial: sanitizeString(data.nomeComercial || nomeEmpresa, { maxLength: 100 }),
            cnpj: sanitizeString(data.cnpj, { maxLength: 30 }),
            descricao: sanitizeMultiline(data.descricao, { maxLength: 500 }),
            logoUrl: sanitizeString(data.logoUrl, { maxLength: 500 }) || '/assets/camrb.png',
            siteUrl: sanitizeString(data.siteUrl, { maxLength: 500 }),
            whatsapp: sanitizeString(data.whatsapp, { maxLength: 30 }),
            instagram: sanitizeString(data.instagram, { maxLength: 60 }),
            telefone: sanitizeString(data.telefone, { maxLength: 30 }),
            planoId: selectedPlan ? selectedPlan.id : 'individual',
            planoNome: selectedPlan ? selectedPlan.nome : 'Cota Individual',
            valorMensal: Number(data.valorMensal !== undefined ? data.valorMensal : selectedPlan?.valor) || 0,
            cameraCodigos: Array.isArray(data.cameraCodigos) ? data.cameraCodigos : [],
            dataInicio: data.dataInicio || new Date().toISOString(),
            dataTermino: data.dataTermino,
            posicao: Number(data.posicao) || 1,
            statusManual: data.statusManual === 'inativo' ? 'inativo' : 'ativo',
            statusPagamento: data.statusPagamento || 'manual_approved',
            observacoes: sanitizeMultiline(data.observacoes, { maxLength: 1000 }),
            historicoRenovacoes: [
                {
                    tipo: 'criacao',
                    data: new Date().toISOString(),
                    valor: Number(data.valorMensal || selectedPlan?.valor || 0),
                    plano: selectedPlan ? selectedPlan.id : 'individual',
                    cameras: data.cameraCodigos || [],
                    modificadoPor: adminEmail
                }
            ]
        });

        return this.sponsorRepo.save(sponsor);
    }

    /**
     * Atualiza dados de um patrocinador existente.
     * @param {string} id
     * @param {object} data
     * @param {string} [adminEmail]
     * @returns {Promise<Sponsor>}
     */
    async update(id, data, adminEmail = 'admin') {
        const existing = await this.sponsorRepo.findById(id);
        if (!existing) {
            throw new Error('Patrocinador não encontrado.');
        }

        const plans = await this.sponsorRepo.getPlans();
        const selectedPlan = data.planoId ? plans.find(p => p.id === data.planoId) : null;

        existing.nomeEmpresa = sanitizeString(data.nomeEmpresa || existing.nomeEmpresa, { maxLength: 150 });
        existing.nomeComercial = sanitizeString(data.nomeComercial || existing.nomeComercial, { maxLength: 100 });
        if (data.cnpj !== undefined) existing.cnpj = sanitizeString(data.cnpj, { maxLength: 30 });
        if (data.descricao !== undefined) existing.descricao = sanitizeMultiline(data.descricao, { maxLength: 500 });
        if (data.logoUrl) existing.logoUrl = sanitizeString(data.logoUrl, { maxLength: 500 });
        if (data.siteUrl !== undefined) existing.siteUrl = sanitizeString(data.siteUrl, { maxLength: 500 });
        if (data.whatsapp !== undefined) existing.whatsapp = sanitizeString(data.whatsapp, { maxLength: 30 }).replace(/\D/g, '');
        if (data.instagram !== undefined) existing.instagram = sanitizeString(data.instagram, { maxLength: 60 }).replace(/^@/, '');
        if (data.telefone !== undefined) existing.telefone = sanitizeString(data.telefone, { maxLength: 30 });

        if (selectedPlan) {
            existing.planoId = selectedPlan.id;
            existing.planoNome = selectedPlan.nome;
        }

        if (data.valorMensal !== undefined) existing.valorMensal = Number(data.valorMensal) || 0;
        if (Array.isArray(data.cameraCodigos)) existing.cameraCodigos = data.cameraCodigos;
        if (data.dataInicio) existing.dataInicio = new Date(data.dataInicio).toISOString();
        if (data.dataTermino) existing.dataTermino = new Date(data.dataTermino).toISOString();
        if (data.posicao !== undefined) existing.posicao = Number(data.posicao) || 1;
        if (data.statusManual) existing.statusManual = data.statusManual === 'inativo' ? 'inativo' : 'ativo';
        if (data.statusPagamento) existing.statusPagamento = data.statusPagamento;
        if (data.observacoes !== undefined) existing.observacoes = sanitizeMultiline(data.observacoes, { maxLength: 1000 });

        existing.updatedAt = new Date().toISOString();

        return this.sponsorRepo.save(existing);
    }

    /**
     * Executa a renovação de um contrato de patrocínio, mantendo histórico imutável.
     * @param {string} id
     * @param {object} renewalData
     * @param {string} [adminEmail]
     * @returns {Promise<Sponsor>}
     */
    async renew(id, renewalData, adminEmail = 'admin') {
        const existing = await this.sponsorRepo.findById(id);
        if (!existing) {
            throw new Error('Patrocinador não encontrado.');
        }

        const { novaDataTermino, novoValor, novoPlanoId, novasCameras, observacaoRenovacao } = renewalData;

        if (!novaDataTermino) {
            throw new Error('Nova data de término é obrigatória para renovação.');
        }

        const plans = await this.sponsorRepo.getPlans();
        const plan = novoPlanoId ? plans.find(p => p.id === novoPlanoId) : null;

        const registroHistorico = {
            tipo: 'renovacao',
            renovadoEm: new Date().toISOString(),
            dataTerminoAnterior: existing.dataTermino,
            novaDataTermino: new Date(novaDataTermino).toISOString(),
            valorAnterior: existing.valorMensal,
            novoValor: novoValor !== undefined ? Number(novoValor) : existing.valorMensal,
            planoAnterior: existing.planoId,
            novoPlano: plan ? plan.id : existing.planoId,
            camerasAnteriores: [...existing.cameraCodigos],
            novasCameras: Array.isArray(novasCameras) ? novasCameras : existing.cameraCodigos,
            observacao: sanitizeString(observacaoRenovacao || '', { maxLength: 300 }),
            modificadoPor: adminEmail
        };

        existing.dataTermino = new Date(novaDataTermino).toISOString();
        if (novoValor !== undefined) existing.valorMensal = Number(novoValor);
        if (plan) {
            existing.planoId = plan.id;
            existing.planoNome = plan.nome;
        }
        if (Array.isArray(novasCameras)) {
            existing.cameraCodigos = novasCameras;
        }

        // Reativa caso estivesse expirado ou pausado
        existing.statusManual = 'ativo';
        existing.historicoRenovacoes.push(registroHistorico);
        existing.updatedAt = new Date().toISOString();

        return this.sponsorRepo.save(existing);
    }

    /**
     * Alterna status manual (ativo/inativo).
     * @param {string} id
     * @param {'ativo'|'inativo'} newStatus
     * @returns {Promise<Sponsor>}
     */
    async toggleStatus(id, newStatus) {
        const existing = await this.sponsorRepo.findById(id);
        if (!existing) throw new Error('Patrocinador não encontrado.');

        existing.statusManual = newStatus === 'inativo' ? 'inativo' : 'ativo';
        existing.updatedAt = new Date().toISOString();
        return this.sponsorRepo.save(existing);
    }

    /**
     * Exclui um patrocinador.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        return this.sponsorRepo.delete(id);
    }

    /**
     * Atualiza dados/preço de um plano comercial.
     * @param {string} planId
     * @param {object} planData
     */
    async updatePlan(planId, planData) {
        const plans = await this.sponsorRepo.getPlans();
        const existingPlan = plans.find(p => p.id === planId);
        if (!existingPlan) throw new Error('Plano não encontrado.');

        if (planData.nome) existingPlan.nome = sanitizeString(planData.nome, { maxLength: 100 });
        if (planData.valor !== undefined) existingPlan.valor = Math.max(0, Number(planData.valor));
        if (planData.maxCameras !== undefined) existingPlan.maxCameras = Math.max(1, parseInt(planData.maxCameras, 10));
        if (planData.descricao !== undefined) existingPlan.descricao = sanitizeMultiline(planData.descricao, { maxLength: 500 });
        if (Array.isArray(planData.beneficios)) existingPlan.beneficios = planData.beneficios.map(b => sanitizeString(b, { maxLength: 200 }));
        if (planData.badge !== undefined) existingPlan.badge = sanitizeString(planData.badge, { maxLength: 50 });
        if (planData.destaqueHome !== undefined) existingPlan.destaqueHome = Boolean(planData.destaqueHome);
        if (planData.ativo !== undefined) existingPlan.ativo = Boolean(planData.ativo);

        await this.sponsorRepo.savePlan(existingPlan);
        return existingPlan;
    }
}

module.exports = ManageSponsorUseCase;
