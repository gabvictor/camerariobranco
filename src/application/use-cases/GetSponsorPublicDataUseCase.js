/**
 * @use-case GetSponsorPublicDataUseCase
 * Fornece dados públicos e seguros de patrocinadores (para Home, Página da Câmera e /patrocine).
 */
class GetSponsorPublicDataUseCase {
    /**
     * @param {import('../../domain/contracts/ISponsorRepository')} sponsorRepository
     * @param {import('../../domain/contracts/ICameraRepository')} cameraRepository
     */
    constructor(sponsorRepository, cameraRepository) {
        this.sponsorRepo = sponsorRepository;
        this.cameraRepo = cameraRepository;
    }

    /**
     * Retorna dados consolidados para a página inicial e landing page de patrocínio.
     */
    async getPublicOverview() {
        const [activeSponsors, plans, allCameras] = await Promise.all([
            this.sponsorRepo.findActive(),
            this.sponsorRepo.getPlans(),
            this.cameraRepo.findAll()
        ]);

        const cameraMap = new Map(allCameras.map(c => [c.codigo, c.nome]));

        const publicSponsors = activeSponsors.map(s => {
            const pub = s.toPublicJSON();
            return {
                ...pub,
                camerasNomes: s.cameraCodigos.map(code => cameraMap.get(code) || `Câmera ${code}`)
            };
        });

        // Patrocinadores da Cota Destaque
        const highlights = publicSponsors.filter(s => s.isDestaque);

        // Mapa de câmeras patrocinadas para lookup O(1) no frontend
        const sponsoredCamerasMap = {};
        activeSponsors.forEach(s => {
            s.cameraCodigos.forEach(code => {
                sponsoredCamerasMap[code] = {
                    sponsorId: s.id,
                    nome: s.nomeComercial || s.nomeEmpresa,
                    logoUrl: s.logoUrl,
                    isDestaque: s.isDestaque()
                };
            });
        });

        return {
            sponsors: publicSponsors,
            highlights,
            sponsoredCamerasMap,
            plans: plans.filter(p => p.ativo).map(p => p.toJSON())
        };
    }

    /**
     * Retorna o patrocinador associado a uma câmera específica.
     * @param {string} cameraCode
     */
    async getSponsorForCamera(cameraCode) {
        if (!cameraCode) return null;
        const sponsor = await this.sponsorRepo.findByCameraCode(cameraCode);
        if (!sponsor) return null;

        const allCameras = await this.cameraRepo.findAll();
        const cameraMap = new Map(allCameras.map(c => [c.codigo, c.nome]));

        return {
            ...sponsor.toPublicJSON(),
            camerasNomes: sponsor.cameraCodigos.map(code => cameraMap.get(code) || `Câmera ${code}`)
        };
    }
}

module.exports = GetSponsorPublicDataUseCase;
