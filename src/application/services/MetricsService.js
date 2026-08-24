/**
 * @service MetricsService
 * Responsável exclusivamente por gerenciar métricas de runtime em memória.
 *
 * SRP: Este serviço não salva nem carrega dados — apenas gerencia o estado
 * das métricas durante a vida do processo.
 */
class MetricsService {
    constructor() {
        this._data = {
            startTime: Date.now(),
            requestCount: 0,
            errorsCount: 0,
            proxySuccesses: 0,
            proxyFailures: 0,
            totalRequestDurationMs: 0,
            lastRequestAt: null,
            lastProxySuccessAt: null,
            lastProxyFailureAt: null,
            viewsToday: 0,
            totalViews: 0,
            topCameras: {}
        };
    }

    // ─── Getters ─────────────────────────────────────────────────────────────────
    getSnapshot() { return { ...this._data }; }
    get topCameras() { return this._data.topCameras; }
    get viewsToday() { return this._data.viewsToday; }
    get totalViews() { return this._data.totalViews; }
    get startTime() { return this._data.startTime; }

    // ─── Mutations ───────────────────────────────────────────────────────────────
    recordRequest(durationMs, isError = false) {
        this._data.requestCount++;
        this._data.totalRequestDurationMs += durationMs;
        this._data.lastRequestAt = Date.now();
        if (isError) this._data.errorsCount++;
    }

    recordProxySuccess() {
        this._data.proxySuccesses++;
        this._data.lastProxySuccessAt = Date.now();
    }

    recordProxyFailure() {
        this._data.proxyFailures++;
        this._data.lastProxyFailureAt = Date.now();
    }

    recordPageView(cameraCode) {
        this._data.viewsToday++;
        this._data.totalViews++;
        if (cameraCode) {
            this._data.topCameras[cameraCode] = (this._data.topCameras[cameraCode] || 0) + 1;
        }
    }

    /**
     * Usado ao carregar métricas persistidas do banco.
     * @param {{total: number, today: number, topCameras: object}} data
     */
    hydrate({ total, today, topCameras }) {
        this._data.totalViews  = total      || 0;
        this._data.viewsToday  = today      || 0;
        this._data.topCameras  = topCameras || {};
    }

    getAverageRequestMs() {
        return this._data.requestCount > 0
            ? Math.round(this._data.totalRequestDurationMs / this._data.requestCount)
            : 0;
    }
}

module.exports = MetricsService;
