/**
 * Test Suite: Sistema de Patrocínios Comerciais - CamRB
 * Executa validações de domínio, use-cases, serviços de imagem e regras de negócio.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Sponsor = require('../src/domain/entities/Sponsor');
const SponsorshipPlan = require('../src/domain/entities/SponsorshipPlan');
const SponsorService = require('../src/application/services/SponsorService');
const ManageSponsorUseCase = require('../src/application/use-cases/ManageSponsorUseCase');
const GetSponsorPublicDataUseCase = require('../src/application/use-cases/GetSponsorPublicDataUseCase');
const SponsorLogoUploadService = require('../src/infrastructure/services/SponsorLogoUploadService');

async function runTests() {
    console.log('🧪 Iniciando bateria de testes do Sistema de Patrocínios...\n');

    // ─── 1. Testes de Entidade Sponsor ───────────────────────────────────────────
    console.log('▶ [1/6] Testando Entidade Sponsor e Status Dinâmico...');

    const today = new Date();
    const pastDate = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const expiredDate = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const futureStart = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const futureEnd = new Date(today.getTime() + 40 * 24 * 60 * 60 * 1000).toISOString();
    const activeStart = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const activeEnd = new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const expiringEnd = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

    // Teste Ativo
    const sponsorAtivo = new Sponsor({
        id: 'sp-1',
        nomeEmpresa: 'Empresa Alfa Ltda',
        nomeComercial: 'Alfa Burguer',
        cnpj: '12.345.678/0001-90',
        descricao: 'A melhor hamburgueria de Rio Branco',
        logoUrl: '/uploads/sponsors/alfa.webp',
        siteUrl: 'https://alfaburguer.com.br',
        whatsapp: '68999991111',
        planoId: 'destaque',
        planoNome: 'Cota Destaque',
        valorMensal: 399,
        statusManual: 'ativo',
        dataInicio: activeStart,
        dataTermino: activeEnd,
        cameraCodigos: ['001409', '001381'],
        posicao: 1,
        observacoes: 'Contrato semestral'
    });

    assert.strictEqual(sponsorAtivo.getStatusCalculado(), 'ativo', 'Status deve ser "ativo"');
    assert.strictEqual(sponsorAtivo.isAtivoPublico(), true, 'Sponsor deve ser ativo público');
    assert.strictEqual(sponsorAtivo.isDestaque(), true, 'Sponsor deve ser destaque');
    assert.strictEqual(sponsorAtivo.patrocinaCamera('001409'), true, 'Deve patrocinar 001409');
    assert.strictEqual(sponsorAtivo.patrocinaCamera('999999'), false, 'Não deve patrocinar 999999');

    // Teste Expirando (<= 7 dias)
    const sponsorExpirando = new Sponsor({
        ...sponsorAtivo.toJSON(),
        id: 'sp-expirando',
        dataTermino: expiringEnd
    });
    assert.strictEqual(sponsorExpirando.getStatusCalculado(), 'expirando', 'Status deve ser "expirando"');
    assert.strictEqual(sponsorExpirando.isAtivoPublico(), true, 'Sponsor expirando ainda deve ser visível publicamente');

    // Teste Expirado
    const sponsorExpirado = new Sponsor({
        ...sponsorAtivo.toJSON(),
        id: 'sp-expirado',
        dataInicio: pastDate,
        dataTermino: expiredDate
    });
    assert.strictEqual(sponsorExpirado.getStatusCalculado(), 'expirado', 'Status deve ser "expirado"');
    assert.strictEqual(sponsorExpirado.isAtivoPublico(), false, 'Sponsor expirado não deve ser ativo público');

    // Teste Futuro
    const sponsorFuturo = new Sponsor({
        ...sponsorAtivo.toJSON(),
        id: 'sp-futuro',
        dataInicio: futureStart,
        dataTermino: futureEnd
    });
    assert.strictEqual(sponsorFuturo.getStatusCalculado(), 'futuro', 'Status deve ser "futuro"');
    assert.strictEqual(sponsorFuturo.isAtivoPublico(), false, 'Sponsor futuro não deve estar ativo antes do início');

    // Teste Inativo Manual
    const sponsorInativo = new Sponsor({
        ...sponsorAtivo.toJSON(),
        id: 'sp-inativo',
        statusManual: 'inativo'
    });
    assert.strictEqual(sponsorInativo.getStatusCalculado(), 'inativo', 'Status deve ser "inativo"');
    assert.strictEqual(sponsorInativo.isAtivoPublico(), false, 'Sponsor inativo não deve ser ativo público');

    console.log('  ✔ Cálculo de status ativo, expirando, expirado, futuro e inativo validado!');

    // ─── 2. Testes de Segurança & Sanitização Pública ─────────────────────────────
    console.log('▶ [2/6] Testando Serialização Pública vs Administrativa...');

    const publicData = sponsorAtivo.toPublicJSON();
    assert.strictEqual(publicData.cnpj, undefined, 'CNPJ NÃO deve ser exposto publicamente');
    assert.strictEqual(publicData.observacoes, undefined, 'Observações internas NÃO devem ser expostas publicamente');
    assert.strictEqual(publicData.valorMensal, undefined, 'Valor contratual NÃO deve ser exposto publicamente');
    assert.strictEqual(publicData.nome, 'Alfa Burguer', 'Nome público deve ser Alfa Burguer');
    assert.strictEqual(publicData.planoId, 'destaque', 'Plano deve ser destaque');

    const adminData = sponsorAtivo.toJSON();
    assert.strictEqual(adminData.cnpj, '12.345.678/0001-90', 'CNPJ deve estar presente no toJSON');
    assert.strictEqual(adminData.valorMensal, 399, 'Valor deve estar presente no toJSON');
    assert.strictEqual(adminData.statusCalculado, 'ativo', 'Status calculado deve estar presente');

    console.log('  ✔ Dados sensíveis blindados com sucesso nas respostas públicas!');

    // ─── 3. Testes de Repositório Mock & Use-Cases ────────────────────────────────
    console.log('▶ [3/6] Testando Mock Repository e ManageSponsorUseCase...');

    const defaultPlans = [
        new SponsorshipPlan({ id: 'individual', nome: 'Cota Individual', valor: 149, maxCameras: 1 }),
        new SponsorshipPlan({ id: 'regional', nome: 'Cota Regional', valor: 249, maxCameras: 2 }),
        new SponsorshipPlan({ id: 'destaque', nome: 'Cota Destaque', valor: 399, maxCameras: 4, destaqueHome: true })
    ];

    class MockSponsorRepo {
        constructor() {
            this.sponsors = new Map();
            this.plans = new Map(defaultPlans.map(p => [p.id, p]));
        }
        async findAll() { return Array.from(this.sponsors.values()); }
        async findActive() { return Array.from(this.sponsors.values()).filter(s => s.isAtivoPublico()); }
        async findById(id) { return this.sponsors.get(id) || null; }
        async findByCameraCode(code) {
            return Array.from(this.sponsors.values()).find(s => s.patrocinaCamera(code)) || null;
        }
        async save(sponsor) {
            if (!sponsor.id) sponsor.id = 'sp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
            this.sponsors.set(sponsor.id, sponsor);
            return sponsor;
        }
        async delete(id) { return this.sponsors.delete(id); }
        async getPlans() { return Array.from(this.plans.values()); }
        async savePlan(plan) { this.plans.set(plan.id, plan); return plan; }
    }

    class MockCameraRepo {
        async findAll() {
            return [
                { codigo: '001409', nome: 'Rotatória da Corrente', status: 'online', categoria: 'Centro' },
                { codigo: '001381', nome: 'Av. Ceará - Centro', status: 'online', categoria: 'Centro' },
                { codigo: '001426', nome: 'Ponte Metálica', status: 'online', categoria: 'Rio Acre' }
            ];
        }
    }

    const mockRepo = new MockSponsorRepo();
    const mockCamRepo = new MockCameraRepo();
    const mockMetrics = { topCameras: { '001409': 1500, '001381': 800, '001426': 2200 } };

    const sponsorService = new SponsorService(mockRepo, mockCamRepo, mockMetrics);
    const manageUseCase = new ManageSponsorUseCase(mockRepo);
    const publicUseCase = new GetSponsorPublicDataUseCase(mockRepo, mockCamRepo);

    // Criar patrocinador 1 (Individual)
    const sp1 = await manageUseCase.create({
        nomeEmpresa: 'Auto Peças Acre Ltda',
        nomeComercial: 'Acre Peças',
        planoId: 'individual',
        valorMensal: 149,
        cameraCodigos: ['001409'],
        whatsapp: '68999992222',
        siteUrl: 'https://acrepecas.com.br'
    }, 'admin@camrb.com');

    // Criar patrocinador 2 (Destaque)
    const sp2 = await manageUseCase.create({
        nomeEmpresa: 'Supermercado Central S.A.',
        nomeComercial: 'Super Central',
        planoId: 'destaque',
        valorMensal: 399,
        cameraCodigos: ['001409', '001381', '001426'],
        siteUrl: 'https://supercentral.com.br'
    }, 'admin@camrb.com');

    assert(sp1.id, 'Sponsor 1 deve ter ID gerado');
    assert(sp2.id, 'Sponsor 2 deve ter ID gerado');

    console.log('  ✔ Criação de patrocinadores via use-case concluída!');

    // ─── 4. Testes de Renovação & Dashboard Stats ────────────────────────────────
    console.log('▶ [4/6] Testando Renovação de Contrato e Dashboard KPIs...');

    const novaDataTermino = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const renewedSp = await manageUseCase.renew(sp1.id, {
        novaDataTermino: novaDataTermino,
        novoValor: 179,
        novoPlanoId: 'individual',
        novasCameras: ['001409', '001381'],
        observacaoRenovacao: 'Renovação com acréscimo de câmera'
    }, 'admin@camrb.com');

    assert.strictEqual(renewedSp.valorMensal, 179, 'Valor renovado deve ser 179');
    assert.strictEqual(renewedSp.cameraCodigos.length, 2, 'Câmeras devem ter sido atualizadas para 2');
    assert.strictEqual(renewedSp.historicoRenovacoes.length, 2, 'Deve ter 2 registros no histórico (criação + renovação)');
    assert.strictEqual(renewedSp.historicoRenovacoes[1].valorAnterior, 149, 'Histórico deve registrar valor anterior de 149');

    // Validação de Dashboard Stats
    const stats = await sponsorService.getAdminDashboardStats();
    assert.strictEqual(stats.activeCount, 2, 'Total de patrocinadores ativos deve ser 2');
    assert.strictEqual(stats.totalMonthlyRevenue, 179 + 399, 'MRR deve somar 179 + 399 = 578');
    assert.strictEqual(stats.totalSponsoredCameras, 3, 'Total de câmeras patrocinadas únicas deve ser 3');
    assert(stats.totalSponsoredViews > 0, 'Total de views patrocinadas deve ser maior que 0');

    // Validação de Dados Públicos
    const publicOverview = await publicUseCase.getPublicOverview();
    assert.strictEqual(publicOverview.highlights.length, 1, 'Deve haver 1 destaque');
    assert.strictEqual(publicOverview.sponsors.length, 2, 'Deve haver 2 patrocinadores públicos');
    assert(publicOverview.sponsoredCamerasMap['001409'], 'Câmera 001409 deve estar no mapa público');

    // Validação de Patrocinador por Câmera
    const camSponsor = await publicUseCase.getSponsorForCamera('001426');
    assert.strictEqual(camSponsor.nome, 'Super Central', 'Câmera 001426 deve ser apresentada por Super Central');

    console.log('  ✔ Renovação contratual, MRR (R$ 578), Lookup de Câmeras e Métricas validados!');

    // ─── 5. Testes de Otimização de Logo com Sharp ───────────────────────────────
    console.log('▶ [5/6] Testando Processamento e Otimização de Imagens (Sharp)...');

    const uploadService = new SponsorLogoUploadService();

    // Gera uma imagem PNG 1200x800 em memória para teste
    const rawImageBuffer = await sharp({
        create: {
            width: 1200,
            height: 800,
            channels: 4,
            background: { r: 99, g: 102, b: 241, alpha: 1 }
        }
    }).png().toBuffer();

    const result = await uploadService.processAndSaveLogo(rawImageBuffer, 'test-corp');
    assert(result.url.startsWith('/uploads/sponsors/'), 'URL pública deve iniciar com /uploads/sponsors/');
    assert(result.fileName.endsWith('.webp'), 'Nome do arquivo deve terminar em .webp');

    const savedFilePath = path.join(uploadService.uploadsDir, result.fileName);
    assert(fs.existsSync(savedFilePath), 'Arquivo otimizado deve existir no disco');

    const fileBuffer = fs.readFileSync(savedFilePath);
    const metadata = await sharp(fileBuffer).metadata();
    assert.strictEqual(metadata.format, 'webp', 'Metadado do Sharp deve ser WebP');
    assert(metadata.width <= 600, 'Largura máxima deve ser redimensionada para <= 600px');
    assert(metadata.height <= 300, 'Altura máxima deve ser redimensionada para <= 300px');

    // Limpa arquivo de teste criado
    try {
        fs.unlinkSync(savedFilePath);
    } catch (e) {
        // Ignora em caso de delay do SO
    }

    console.log(`  ✔ Sharp converteu PNG (1200x800) -> WebP (${metadata.width}x${metadata.height}) com sucesso!`);

    // ─── 6. Testes de Edição de Planos Comerciais ────────────────────────────────
    console.log('▶ [6/6] Testando Gestão e Edição de Planos Comerciais...');

    const updatedPlan = await manageUseCase.updatePlan('individual', {
        valor: 199,
        descricao: 'Plano com 1 câmera e identificação completa'
    });
    assert.strictEqual(updatedPlan.valor, 199, 'Valor do plano individual deve ter sido atualizado para 199');

    console.log('  ✔ Flexibilidade de preços e parâmetros de planos validada!\n');

    console.log('===========================================================');
    console.log('🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
    console.log('===========================================================');
}

runTests().catch(err => {
    console.error('❌ Erro no teste:', err);
    process.exit(1);
});
