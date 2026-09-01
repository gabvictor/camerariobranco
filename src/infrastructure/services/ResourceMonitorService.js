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

    getCpuUsage() {
        const now = Date.now();
        const timeDiff = (now - this.lastCpuCheck) * 1000; // microsegundos
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

    getSystemResources(mjpegStreamsMap, cameraRepo, metrics, timelapseScheduler) {
        // Métricas de CPU e Memória
        const cpuPercent = this.getCpuUsage();
        const memory = this.getMemoryMetrics();

        // Transmissões MJPEG Ativas
        const activeStreams = [];
        let totalSubscribers = 0;

        if (mjpegStreamsMap) {
            for (const [code, stream] of mjpegStreamsMap.entries()) {
                const subCount = stream.subscribers ? stream.subscribers.size : 0;
                totalSubscribers += subCount;

                const camData = cameraRepo && cameraRepo.getCached ? cameraRepo.getCached().find(c => c.codigo === code) : null;
                const frameSize = stream.lastFrame ? stream.lastFrame.length : 0;

                activeStreams.push({
                    code,
                    name: camData ? camData.nome : `Câmera ${code}`,
                    subscribersCount: subCount,
                    isFetching: stream.isFetching || false,
                    frameSizeBytes: frameSize,
                    frameSizeFormatted: this._formatBytes(frameSize),
                    status: subCount > 0 ? 'active' : 'idle'
                });
            }
        }

        // Métricas de Timelapse
        const timelapseStats = timelapseScheduler ? timelapseScheduler.getStats() : { totalFrames: 0, totalSizeBytes: 0, totalSizeFormatted: '0 MB' };

        // Métricas de Tráfego / Proxy
        const proxyStats = metrics ? metrics.getSnapshot() : { totalViews: 0, proxySuccess: 0, proxyFailures: 0 };

        return {
            timestamp: new Date().toISOString(),
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
            streaming: {
                activeStreamsCount: activeStreams.length,
                totalSubscribers,
                streams: activeStreams
            },
            timelapse: timelapseStats,
            network: {
                proxySuccess: proxyStats.proxySuccess || 0,
                proxyFailures: proxyStats.proxyFailures || 0,
                totalViews: proxyStats.totalViews || 0,
                viewsToday: proxyStats.viewsToday || 0
            }
        };
    }
}

const resourceMonitor = new ResourceMonitorService();
module.exports = resourceMonitor;
