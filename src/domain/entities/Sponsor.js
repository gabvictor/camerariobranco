function parseSafeIsoDate(value, fallback = new Date()) {
    if (!value) {
        return fallback instanceof Date ? fallback.toISOString() : new Date(fallback).toISOString();
    }
    // Suporte a Firestore Timestamp (.toDate())
    if (typeof value === 'object' && typeof value.toDate === 'function') {
        return value.toDate().toISOString();
    }
    // Suporte a objeto Timestamp serializado com _seconds ou seconds
    if (typeof value === 'object' && ('_seconds' in value || 'seconds' in value)) {
        const sec = value._seconds !== undefined ? value._seconds : value.seconds;
        return new Date(sec * 1000).toISOString();
    }
    // Instância de Date
    if (value instanceof Date) {
        return isNaN(value.getTime()) 
            ? (fallback instanceof Date ? fallback.toISOString() : new Date(fallback).toISOString()) 
            : value.toISOString();
    }
    // String ou número
    try {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    } catch (_) {}
    return fallback instanceof Date ? fallback.toISOString() : new Date(fallback).toISOString();
}

/**
 * @entity Sponsor
 * Representa um Patrocinador Comercial do CamRB.
 * Classe de domínio pura — sem acoplamento a frameworks ou bancos de dados.
 */
class Sponsor {
    /**
     * @param {object} params
     * @param {string} [params.id]
     * @param {string} params.nomeEmpresa - Razão Social ou Nome Empresarial
     * @param {string} [params.nomeComercial] - Nome fantasia ou marca exibida
     * @param {string} [params.cnpj] - CNPJ opcional
     * @param {string} [params.descricao] - Descrição curta da empresa / oferta
     * @param {string} [params.logoUrl] - URL ou caminho do logotipo otimizado
     * @param {string} [params.siteUrl] - Link do website ou página de destino
     * @param {string} [params.whatsapp] - Telefone/WhatsApp de contato comercial
     * @param {string} [params.instagram] - Usuário do Instagram
     * @param {string} [params.telefone] - Telefone fixo/geral
     * @param {string} [params.planoId] - ID do plano ('individual', 'regional', 'destaque', etc.)
     * @param {string} [params.planoNome] - Nome do plano exibido
     * @param {number} [params.valorMensal] - Valor mensal cobrado (R$)
     * @param {string[]} [params.cameraCodigos] - Lista de códigos de câmeras patrocinadas
     * @param {string|Date|object} params.dataInicio - Data de início do patrocínio
     * @param {string|Date|object} params.dataTermino - Data de término/expiração do patrocínio
     * @param {number} [params.posicao] - Ordem/prioridade de exibição (1 = maior prioridade)
     * @param {string} [params.statusManual] - Status manual atribuído pelo admin ('ativo', 'inativo')
     * @param {string} [params.statusPagamento] - Status de pagamento ('manual_approved', 'pending', 'active', 'expired', 'cancelled')
     * @param {string} [params.observacoes] - Notas administrativas internas
     * @param {Array<object>} [params.historicoRenovacoes] - Registro histórico de renovações
     * @param {string|Date|object} [params.createdAt]
     * @param {string|Date|object} [params.updatedAt]
     */
    constructor({
        id,
        nomeEmpresa,
        nomeComercial,
        cnpj,
        descricao,
        logoUrl,
        siteUrl,
        whatsapp,
        instagram,
        telefone,
        planoId = 'individual',
        planoNome = 'Cota Individual',
        valorMensal = 149.00,
        cameraCodigos = [],
        dataInicio,
        dataTermino,
        posicao = 1,
        statusManual = 'ativo',
        statusPagamento = 'manual_approved',
        observacoes = '',
        historicoRenovacoes = [],
        createdAt,
        updatedAt
    }) {
        if (!nomeEmpresa || typeof nomeEmpresa !== 'string' || nomeEmpresa.trim().length === 0) {
            throw new Error('Sponsor.nomeEmpresa é obrigatório');
        }

        this.id = id || null;
        this.nomeEmpresa = nomeEmpresa.trim();
        this.nomeComercial = (nomeComercial && String(nomeComercial).trim()) || this.nomeEmpresa;
        this.cnpj = cnpj ? String(cnpj).trim() : '';
        this.descricao = descricao ? String(descricao).trim() : '';
        this.logoUrl = logoUrl || '/assets/camrb.png';
        this.siteUrl = siteUrl ? String(siteUrl).trim() : '';
        this.whatsapp = whatsapp ? String(whatsapp).trim().replace(/\D/g, '') : '';
        this.instagram = instagram ? String(instagram).trim().replace(/^@/, '') : '';
        this.telefone = telefone ? String(telefone).trim() : '';
        
        this.planoId = planoId;
        this.planoNome = planoNome;
        this.valorMensal = Number(valorMensal) || 0;
        
        this.cameraCodigos = Array.isArray(cameraCodigos)
            ? cameraCodigos.map(c => String(c).trim()).filter(Boolean)
            : [];

        const now = new Date();
        this.dataInicio = parseSafeIsoDate(dataInicio, now);
        
        const defaultEnd = new Date(now);
        defaultEnd.setDate(defaultEnd.getDate() + 30);
        this.dataTermino = parseSafeIsoDate(dataTermino, defaultEnd);

        this.posicao = Number(posicao) || 1;
        this.statusManual = statusManual === 'inativo' ? 'inativo' : 'ativo';
        this.statusPagamento = statusPagamento || 'manual_approved';
        this.observacoes = observacoes ? String(observacoes) : '';
        this.historicoRenovacoes = Array.isArray(historicoRenovacoes) ? historicoRenovacoes : [];
        
        this.createdAt = parseSafeIsoDate(createdAt, now);
        this.updatedAt = parseSafeIsoDate(updatedAt, now);
    }

    /**
     * Calcula o status real do patrocínio considerando datas e status manual.
     * @returns {'ativo'|'expirando'|'expirado'|'futuro'|'inativo'}
     */
    getStatusCalculado() {
        if (this.statusManual === 'inativo') {
            return 'inativo';
        }

        const now = Date.now();
        const start = new Date(this.dataInicio).getTime();
        const end = new Date(this.dataTermino).getTime();

        if (now < start) {
            return 'futuro';
        }

        if (now > end) {
            return 'expirado';
        }

        // Se expira em menos de 7 dias
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (end - now <= sevenDaysMs) {
            return 'expirando';
        }

        return 'ativo';
    }

    /**
     * Retorna se o patrocinador está efetivamente ativo para exibição pública.
     * @returns {boolean}
     */
    isAtivoPublico() {
        const status = this.getStatusCalculado();
        return status === 'ativo' || status === 'expirando';
    }

    /**
     * Verifica se patrocina uma câmera específica.
     * @param {string} cameraCode
     * @returns {boolean}
     */
    patrocinaCamera(cameraCode) {
        if (!this.isAtivoPublico()) return false;
        const normalized = String(cameraCode).trim();
        return this.cameraCodigos.includes(normalized);
    }

    /**
     * Retorna se é um patrocinador da categoria Destaque.
     * @returns {boolean}
     */
    isDestaque() {
        return this.planoId === 'destaque';
    }

    /**
     * Serializa para objeto plano (para persistência no banco).
     */
    toJSON() {
        return {
            id: this.id,
            nomeEmpresa: this.nomeEmpresa,
            nomeComercial: this.nomeComercial,
            cnpj: this.cnpj,
            descricao: this.descricao,
            logoUrl: this.logoUrl,
            siteUrl: this.siteUrl,
            whatsapp: this.whatsapp,
            instagram: this.instagram,
            telefone: this.telefone,
            planoId: this.planoId,
            planoNome: this.planoNome,
            valorMensal: this.valorMensal,
            cameraCodigos: this.cameraCodigos,
            dataInicio: this.dataInicio,
            dataTermino: this.dataTermino,
            posicao: this.posicao,
            statusManual: this.statusManual,
            statusCalculado: this.getStatusCalculado(),
            statusPagamento: this.statusPagamento,
            observacoes: this.observacoes,
            historicoRenovacoes: this.historicoRenovacoes,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Retorna apenas informações seguras para exibição pública (sem dados administrativos/financeiros).
     */
    toPublicJSON() {
        return {
            id: this.id,
            nome: this.nomeComercial || this.nomeEmpresa,
            descricao: this.descricao,
            logoUrl: this.logoUrl,
            siteUrl: this.siteUrl,
            whatsapp: this.whatsapp,
            instagram: this.instagram,
            planoId: this.planoId,
            isDestaque: this.isDestaque(),
            cameraCodigos: this.cameraCodigos
        };
    }
}

module.exports = Sponsor;
