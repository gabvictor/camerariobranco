/**
 * @use-case GetDashboardDataUseCase
 * Agrega dados de usuários, câmeras e métricas para o painel administrativo.
 *
 * SRP: A lógica que antes estava em 55 linhas dentro do handler HTTP
 *      agora é testável de forma independente.
 */
class GetDashboardDataUseCase {
    /**
     * @param {object} adminAuth — Firebase Admin Auth instance
     * @param {import('../../domain/contracts/ICameraRepository')} cameraRepository
     * @param {import('../../application/services/MetricsService')} metricsService
     * @param {import('../../application/use-cases/TrackVisitUseCase')} trackVisitUseCase
     */
    constructor(adminAuth, cameraRepository, metricsService, trackVisitUseCase) {
        this.adminAuth       = adminAuth;
        this.cameraRepo      = cameraRepository;
        this.metricsService  = metricsService;
        this.trackVisit      = trackVisitUseCase;
    }

    async execute() {
        // Parallel fetch: users + cameras + traffic
        const [listUsersResult, allCameras, trafficStats] = await Promise.all([
            this.adminAuth.listUsers(1000),
            this.cameraRepo.findAll(),
            this.trackVisit.getStats()
        ]);

        const users       = listUsersResult.users;
        const oneDayAgo   = Date.now() - 86400000;

        // ─── Users ───────────────────────────────────────────────────────────────
        const totalUsers     = users.length;
        const activeUsers24h = users.filter(u =>
            new Date(u.metadata.lastSignInTime).getTime() > oneDayAgo
        ).length;

        const signupsByDay = { labels: [], values: [] };
        const now = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            signupsByDay.labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
            const startOfDay = new Date(d.setHours(0, 0, 0, 0)).getTime();
            const endOfDay   = new Date(d.setHours(23, 59, 59, 999)).getTime();
            signupsByDay.values.push(
                users.filter(u => {
                    const ct = new Date(u.metadata.creationTime).getTime();
                    return ct >= startOfDay && ct <= endOfDay;
                }).length
            );
        }

        const recentUsers = users
            .sort((a, b) => new Date(b.metadata.creationTime) - new Date(a.metadata.creationTime))
            .slice(0, 5)
            .map(u => ({
                email: u.email,
                creationTime: u.metadata.creationTime,
                lastSignInTime: u.metadata.lastSignInTime
            }));

        // ─── Cameras ─────────────────────────────────────────────────────────────
        const categories = {};
        allCameras.forEach(cam => {
            const c = cam.categoria || 'Outros';
            categories[c] = (categories[c] || 0) + 1;
        });

        const topCameras = Object.entries(this.metricsService.topCameras)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([code, views]) => {
                const info = allCameras.find(c => c.codigo === code);
                return { codigo: code, nome: info ? info.nome : `Câmera ${code}`, views };
            });

        return {
            totalUsers,
            activeUsers24h,
            totalCameras: allCameras.length,
            recentUsers,
            signupsByDay,
            categoryData: { labels: Object.keys(categories), values: Object.values(categories) },
            viewsToday: trafficStats.viewsToday,
            totalViews: trafficStats.totalViews,
            topCameras
        };
    }
}

module.exports = GetDashboardDataUseCase;
