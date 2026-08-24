/**
 * @controller DashboardController
 * Delega para GetDashboardDataUseCase — handler de 3 linhas vs 55 linhas anteriores.
 */
class DashboardController {
    /**
     * @param {import('../../../application/use-cases/GetDashboardDataUseCase')} dashboardUseCase
     */
    constructor(dashboardUseCase) {
        this.dashboardUseCase = dashboardUseCase;
        this.getDashboard = this.getDashboard.bind(this);
    }

    /** GET /api/dashboard-data */
    async getDashboard(req, res) {
        try {
            const data = await this.dashboardUseCase.execute();
            res.json(data);
        } catch (error) {
            console.error('Erro ao buscar dados do dashboard:', error);
            res.status(500).json({ message: 'Erro interno ao buscar dados.' });
        }
    }
}

module.exports = DashboardController;
