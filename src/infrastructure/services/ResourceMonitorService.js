/**
 * ResourceMonitorService.js
 * Monitor de recursos de hardware, processos e transmissões ativas em tempo real.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

class ResourceMonitorService {
    constructor() {
        this.lastCpuUsage = process.cpuUsage();
        this.lastCpuCheck = Date.now();
        this.cpuHistory = [];
        this.memoryHistory = [];
        this.maxHistoryLength = 30;

        // Auto-sample a cada 2 segundos
        this._sampleTimer = setInterval(() => {
            this._recordSample();
        }, 2000);
        this._sampleTimer.unref();
    }

    _formatBytes(bytes, decimals = 2) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    _formatUptime(seconds) {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const parts = [];
        if (d > 0) parts.push(`${d}d`);
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        parts.push(`${s}s`);
        return parts.join(' ');
    }

    _recordSample() {
        try {
            const cpu = this.getCpuUsage();
            const mem = this.getMemoryMetrics();
            const timeLabel = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            this.cpuHistory.push({ time: timeLabel, value: cpu });
            if (this.cpuHistory.length > this.maxHistoryLength) this.cpuHistory.shift();

            this.memoryHistory.push({
                time: timeLabel,
                heapMb: Math.round(mem.process.heapUsed / (1024 * 1024)),
                rssMb: Math.round(mem.process.rss / (1024 * 1024)),
                sysPercent: mem.system.usedPercent
            });
            if (this.memoryHistory.length > this.maxHistoryLength) this.memoryHistory.shift();
        } catch (_) {}
    }

    getCpuUsage() {
        const now = Date.now();
        const timeDiff = (now - this.lastCpuCheck) * 1000; // microsegundos
        if (timeDiff <= 0) return 0;
        const usageDiff = process.cpuUsage(this.lastCpuUsage);
        
        this.lastCpuCheck = now;
        this.lastCpuUsage = process.cpuUsage();

        const numCpus = os.cpus().length || 1;
        const totalUsage = (usageDiff.user + usageDiff.system) / timeDiff;
        const percent = Math.min(100, Math.max(0, Math.round((totalUsage / numCpus) * 100 * 10) / 10));
        return percent;
    }

    getMemoryMetrics() {
        const mem = process.memoryUsage();
        const totalSysMem = os.totalmem();
        const freeSysMem = os.freemem();
        const usedSysMem = totalSysMem - freeSysMem;

        return {
            process: {
                rss: mem.rss,
                rssFormatted: this._formatBytes(mem.rss),
                heapUsed: mem.heapUsed,
                heapUsedFormatted: this._formatBytes(mem.heapUsed),
                heapTotal: mem.heapTotal,
                heapTotalFormatted: this._formatBytes(mem.heapTotal),
                external: mem.external,
                externalFormatted: this._formatBytes(mem.external)
            },
            system: {
                total: totalSysMem,
                totalFormatted: this._formatBytes(totalSysMem),
                free: freeSysMem,
                freeFormatted: this._formatBytes(freeSysMem),
                used: usedSysMem,
                usedFormatted: this._formatBytes(usedSysMem),
                usedPercent: Math.round((usedSysMem / totalSysMem) * 100)
            }
        };
    }

    getSystemResources(mjpegStreamsMap, cameraRepo, metrics, timelapseScheduler, scheduler, rioAcreService, cameraCache, sitePresenceMap) {
        // Métricas de CPU e Memória
        const cpuPercent = this.getCpuUsage();
        const memory = this.getMemoryMetrics();

        // 1. Resolução consolidada de câmeras com status dinâmico do scanner
        let allCameras = [];
        const repoCams = cameraRepo && cameraRepo.getCached ? cameraRepo.getCached() : [];
        const cachedCams = cameraCache && cameraCache.getAll ? cameraCache.getAll() : [];

        if (cachedCams.length > 0) {
            allCameras = cachedCams;
        } else if (repoCams.length > 0) {
            allCameras = repoCams.map(r => ({
                ...r,
                status: r.status || 'offline'
            }));
        }

        // Transmissões MJPEG Ativas com Identificação de Espectadores
        const activeStreams = [];
        let totalSubscribers = 0;
        let estimatedBandwidthBytesPerSec = 0;

        // Adiciona usuários ativos navegando em qualquer página do site
        if (sitePresenceMap && sitePresenceMap.size > 0) {
            const pageGroups = new Map();
            let validPagePresenceCount = 0;

            for (const [, v] of sitePresenceMap.entries()) {
                const path = v.path || '/';

                // Ignora rotas de câmera se já estiverem presentes nas transmissões MJPEG ou forem páginas de câmera
                if (path.startsWith('/camera/') || path.startsWith('/embed/')) {
                    const camCode = path.split('/')[2];
                    if (camCode && mjpegStreamsMap && mjpegStreamsMap.has(camCode)) {
                        continue;
                    }
                }

                let group = pageGroups.get(path);
                if (!group) {
                    group = {
                        code: v.pageCode || 'PAGE',
                        name: v.pageTitle || 'Página Web',
                        categoria: v.pageCategory || 'Navegação Web',
                        path: path,
                        viewers: []
                    };
                    pageGroups.set(path, group);
                }

                group.viewers.push({
                    name: v.name || 'Anônimo',
                    email: v.email || null,
                    isLoggedIn: Boolean(v.isLoggedIn),
                    connectedAt: v.connectedAt
                });
                validPagePresenceCount++;
            }

            totalSubscribers += validPagePresenceCount;

            for (const group of pageGroups.values()) {
                activeStreams.push({
                    code: group.code,
                    name: group.name,
                    categoria: group.categoria,
                    subscribersCount: group.viewers.length,
                    viewers: group.viewers,
                    isFetching: false,
                    frameSizeBytes: 0,
                    frameSizeFormatted: 'Navegação Web',
                    status: 'active',
                    isPage: true,
                    url: group.path
                });
            }
        }

        if (mjpegStreamsMap) {
            for (const [code, stream] of mjpegStreamsMap.entries()) {
                const subCount = stream.subscribers ? stream.subscribers.size : 0;
                totalSubscribers += subCount;

                const camData = allCameras.find(c => c.codigo === code) || (cameraRepo && cameraRepo.getCached ? cameraRepo.getCached().find(c => c.codigo === code) : null);
                const frameSize = stream.lastFrame ? stream.lastFrame.length : 0;
                
                // Estimativa de banda: frameSize * 2 fps * subCount
                if (subCount > 0) {
                    estimatedBandwidthBytesPerSec += frameSize * 2 * subCount;
                }

                // Lista de espectadores identificados (logados ou anônimos)
                const viewersList = [];
                if (stream.subscribers) {
                    if (stream.subscribers instanceof Map) {
                        for (const [, v] of stream.subscribers.entries()) {
                            viewersList.push({
                                name: v.name || 'Anônimo',
                                email: v.email || null,
                                isLoggedIn: Boolean(v.isLoggedIn),
                                connectedAt: v.connectedAt
                            });
                        }
                    } else if (stream.subscribers instanceof Set) {
                        for (let i = 0; i < stream.subscribers.size; i++) {
                            viewersList.push({
                                name: 'Anônimo',
                                email: null,
                                isLoggedIn: false,
                                connectedAt: new Date().toISOString()
                            });
                        }
                    }
                }

                activeStreams.push({
                    code,
                    name: camData ? camData.nome : `Câmera ${code}`,
                    categoria: camData ? (camData.categoria || camData.bairro) : 'Rio Branco',
                    subscribersCount: subCount,
                    viewers: viewersList,
                    isFetching: stream.isFetching || false,
                    frameSizeBytes: frameSize,
                    frameSizeFormatted: this._formatBytes(frameSize),
                    status: subCount > 0 ? 'active' : 'idle'
                });
            }
        }

        // Métricas de Câmeras
        const totalCameras = allCameras.length;
        const onlineCameras = allCameras.filter(c => c.status === 'online').length;
        const offlineCameras = totalCameras - onlineCameras;
        const camerasWithCoords = allCameras.filter(c => Boolean(c.coords)).length;

        // Métricas de Timelapse
        const timelapseStats = timelapseScheduler ? timelapseScheduler.getStats() : { totalFrames: 0, totalSizeBytes: 0, totalSizeFormatted: '0 MB' };

        // Métricas de Tráfego / Proxy
        const proxyStats = metrics ? metrics.getSnapshot() : { totalViews: 0, proxySuccess: 0, proxyFailures: 0, viewsToday: 0, topCameras: {} };

        // Scanner Status
        const scannerStatus = scheduler ? scheduler.getStatus() : { isScanning: false, nextScanInSeconds: 60, lastScan: {} };

        // Telemetria Rio Acre
        let rioAcreInfo = null;
        if (rioAcreService && typeof rioAcreService.getNivelRioAcre === 'function') {
            try {
                // Leitura síncrona/rápida em cache
                rioAcreInfo = rioAcreService.getLastCachedNivel ? rioAcreService.getLastCachedNivel() : null;
            } catch (_) {}
        }

        // Calcula score de saúde geral (0 - 100)
        let healthScore = 100;
        if (cpuPercent > 85) healthScore -= 20;
        else if (cpuPercent > 65) healthScore -= 10;

        if (memory.system.usedPercent > 90) healthScore -= 25;
        else if (memory.system.usedPercent > 80) healthScore -= 10;

        if (totalCameras > 0 && onlineCameras === 0) healthScore -= 30;

        let systemStatusText = 'Operacional';
        let systemStatusColor = 'emerald';
        if (healthScore < 60) {
            systemStatusText = 'Crítico / Atenção';
            systemStatusColor = 'red';
        } else if (healthScore < 85) {
            systemStatusText = 'Degradado / Moderado';
            systemStatusColor = 'amber';
        }

        return {
            timestamp: new Date().toISOString(),
            health: {
                score: Math.max(0, healthScore),
                status: systemStatusText,
                color: systemStatusColor
            },
            uptime: {
                processUptimeSeconds: Math.floor(process.uptime()),
                processUptimeFormatted: this._formatUptime(process.uptime()),
                systemUptimeSeconds: Math.floor(os.uptime()),
                systemUptimeFormatted: this._formatUptime(os.uptime())
            },
            hardware: {
                cpuPercent,
                cpuCount: os.cpus().length,
                cpuModel: os.cpus()[0] ? os.cpus()[0].model : 'Desconhecido',
                loadAverage: os.loadavg(),
                platform: os.platform(),
                arch: os.arch(),
                nodeVersion: process.version
            },
            memory,
            history: {
                cpu: this.cpuHistory,
                memory: this.memoryHistory
            },
            cameras: {
                total: totalCameras,
                online: onlineCameras,
                offline: offlineCameras,
                withCoords: camerasWithCoords,
                percentOnline: totalCameras > 0 ? Math.round((onlineCameras / totalCameras) * 100) : 0
            },
            scanner: scannerStatus,
            streaming: {
                activeStreamsCount: activeStreams.length,
                totalSubscribers,
                estimatedBandwidthFormatted: this._formatBytes(estimatedBandwidthBytesPerSec) + '/s',
                streams: activeStreams
            },
            timelapse: timelapseStats,
            network: {
                proxySuccess: proxyStats.proxySuccess || 0,
                proxyFailures: proxyStats.proxyFailures || 0,
                totalViews: proxyStats.totalViews || 0,
                viewsToday: proxyStats.viewsToday || 0,
                errorRatePercent: (proxyStats.proxySuccess + proxyStats.proxyFailures) > 0
                    ? Math.round((proxyStats.proxyFailures / (proxyStats.proxySuccess + proxyStats.proxyFailures)) * 1000) / 10
                    : 0
            },
            rioAcre: rioAcreInfo
        };
    }
}

const resourceMonitor = new ResourceMonitorService();
module.exports = resourceMonitor;
