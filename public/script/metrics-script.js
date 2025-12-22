import { initAuthModal, initGlobalAuthUI } from "./auth-modal.js";

const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
};

const fmtDate = (ts) => ts ? new Date(ts).toLocaleString() : '--';

const $ = (id) => document.getElementById(id);

async function loadHealth() {
    const res = await fetch('/health', { cache: 'no-store' });
    const data = await res.json();
    $('uptime').textContent = fmtTime(data.uptimeMs);
    $('last-request').textContent = `Última requisição: ${fmtDate(data.metrics.lastRequestAt)}`;
    $('online-count').textContent = String(data.onlineCount);
    $('cached-count').textContent = String(data.cachedCount);
    $('camera-info-count').textContent = String(data.cameraInfoCount);
    $('scan-status').textContent = data.isScanning ? 'Varredura ativa' : (data.scanTimeoutOccurred ? 'Timeout' : 'Ocioso');
    $('next-scan').textContent = fmtDate(data.nextScanTimestamp);
    $('req-total').textContent = String(data.metrics.requestCount);
    $('req-avg').textContent = String(data.metrics.avgRequestMs);
    $('req-errors').textContent = String(data.metrics.errorsCount);
    $('req-last').textContent = fmtDate(data.metrics.lastRequestAt);
    $('proxy-ok').textContent = String(data.metrics.proxySuccesses);
    $('proxy-fail').textContent = String(data.metrics.proxyFailures);
    $('proxy-last-ok').textContent = fmtDate(data.metrics.lastProxySuccessAt);
    $('proxy-last-fail').textContent = fmtDate(data.metrics.lastProxyFailureAt);
    const now = new Date();
    $('last-update').textContent = `Atualizado às ${now.toLocaleTimeString()}`;
    if (window.lucide) window.lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Auth
    initAuthModal();
    initGlobalAuthUI();

    // Theme Toggle
    const themeToggleBtn = $('toggle-theme');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            if (window.toggleTheme) window.toggleTheme();
        });
    }

    loadHealth().catch(() => {});
    $('refresh-btn').addEventListener('click', () => loadHealth().catch(() => {}));
    setInterval(() => loadHealth().catch(() => {}), 5000);
});
