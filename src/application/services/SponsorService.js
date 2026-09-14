/**
 * @service SponsorService
 * Gerenciamento de estado, agregação de métricas e enriquecimento de dados de patrocinadores.
 */
class SponsorService {
    /**
     * @param {import('../../domain/contracts/ISponsorRepository')} sponsorRepository
     * @param {import('../../domain/contracts/ICameraRepository')} cameraRepository
     * @param {import('../../application/services/MetricsService')} metricsService
     */
    constructor(sponsorRepository, cameraRepository, metricsService) {
        this.sponsorRepo = sponsorRepository;
        this.cameraRepo = cameraRepository;
        this.metrics = metricsService;
    }

    /**
     * Retorna todos os patrocinadores enriquecidos com dados de câmeras e métricas.
     * @returns {Promise<Array>}
     */
    async getAllEnriched() {
        const [sponsors, cameras] = await Promise.all([
            this.sponsorRepo.findAll(),
            this.cameraRepo.findAll()
        ]);

        const cameraMap = new Map(cameras.map(c => [c.codigo, c]));
        const topCameras = this.metrics ? this.metrics.topCameras : {};

        return sponsors.map(sponsor => {
            const sponsorJson = sponsor.toJSON();
            const enrichedCameras = sponsor.cameraCodigos.map(code => {
                const cam = cameraMap.get(code);
                return {
                    codigo: code,
                    nome: cam ? cam.nome : `Câmera ${code}`,
                    categoria: cam ? cam.categoria : 'Sem Categoria',
                    status: cam ? cam.status : 'offline',
                    views: topCameras[code] || 0
                };
            });

            return {
                ...sponsorJson,
                camerasDetalhadas: enrichedCameras,
                statusCalculado: sponsor.getStatusCalculado()
            };
        });
    }

    /**
     * Agrega métricas e estatísticas financeiras e de audiência para o painel administrativo.
     */
    async getAdminDashboardStats() {
        const enrichedList = await this.getAllEnriched();
        const plans = await this.sponsorRepo.getPlans();

        let totalMonthlyRevenue = 0;
        let activeCount = 0;
        let expiringCount = 0;
        let expiredCount = 0;
        let inactiveCount = 0;
        let futureCount = 0;

        const sponsoredCamerasSet = new Set();
        let totalSponsoredViews = 0;
        const planDistribution = {};

        // Inicializa distribuição de planos
        plans.forEach(p => {
            planDistribution[p.id] = { nome: p.nome, count: 0, revenue: 0 };
        });

        enrichedList.forEach(s => {
            const status = s.statusCalculado;
            if (status === 'ativo') {
                activeCount++;
                totalMonthlyRevenue += Number(s.valorMensal) || 0;
            } else if (status === 'expirando') {
                expiringCount++;
                activeCount++; // Expirando ainda está ativo
                totalMonthlyRevenue += Number(s.valorMensal) || 0;
            } else if (status === 'expirado') {
                expiredCount++;
            } else if (status === 'inativo') {
                inactiveCount++;
            } else if (status === 'futuro') {
                futureCount++;
            }

            // Distribuição por plano para patrocinadores ativos
            if (status === 'ativo' || status === 'expirando') {
                if (!planDistribution[s.planoId]) {
                    planDistribution[s.planoId] = { nome: s.planoNome, count: 0, revenue: 0 };
                }
                planDistribution[s.planoId].count++;
                planDistribution[s.planoId].revenue += Number(s.valorMensal) || 0;

                // Câmeras associadas
                (s.cameraCodigos || []).forEach(code => {
                    sponsoredCamerasSet.add(code);
                });

                (s.camerasDetalhadas || []).forEach(cam => {
                    totalSponsoredViews += Number(cam.views) || 0;
                });
            }
        });

        return {
            totalSponsors: enrichedList.length,
            activeCount,
            expiringCount,
            expiredCount,
            inactiveCount,
            futureCount,
            totalMonthlyRevenue,
            totalSponsoredCameras: sponsoredCamerasSet.size,
            totalSponsoredViews,
            planDistribution,
            plans
        };
    }
}

module.exports = SponsorService;
