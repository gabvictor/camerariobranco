import { initAuthModal, initGlobalAuthUI } from "./auth-modal.js";
import { initFooter } from "./footer-component.js";
import { initTour } from "./tour.js";

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Auth & Footer & Tour
    initAuthModal();
    initGlobalAuthUI();
    initFooter();
    initTour();

    if (window.lucide) window.lucide.createIcons();

    // Theme changes are handled globally by theme.js. We listen to themeChanged event for chart:
    window.addEventListener('themeChanged', () => {
        if (rioUnifiedChart && window.lastUnifiedPeriod && window.lastUnifiedData) {
            renderUnifiedChart(window.lastUnifiedPeriod, window.lastUnifiedData);
        }
    });

    // Configuração do Modal de Compartilhamento do Nível do Rio
    setupRioShareModal();

    // Alternador das Câmeras Hero (Ponte Metálica e Passarela Joaquim Macedo)
    setupHeroCameraSwitcher();

    const btnRefreshTelemetry = document.getElementById('btn-refresh-telemetry');
    if (btnRefreshTelemetry) {
        btnRefreshTelemetry.addEventListener('click', async (e) => {
            e.preventDefault();
            const icon = btnRefreshTelemetry.querySelector('i, svg') || btnRefreshTelemetry;
            if (icon) icon.classList.add('animate-spin');
            try {
                await Promise.all([
                    fetchRioTelemetry(),
                    loadUnifiedPeriod(currentUnifiedPeriod, true),
                    fetchRioPrevisao()
                ]);
            } finally {
                setTimeout(() => {
                    if (icon) icon.classList.remove('animate-spin');
                }, 600);
            }
        });
    }

    // Inicialização dos módulos da página do Rio Acre
    fetchRioTelemetry();
    initRioUnifiedChart();
    fetchRioPrevisao();

    // Polling regular a cada 60 segundos
    setInterval(fetchRioTelemetry, 60000);
    setInterval(fetchRioPrevisao, 120000);
});

/* ─────────────────────────────────────────────────────────────────────────────
   1. Câmeras Ao Vivo - Alternador Hero Integrado com Detecção Automática Online/Offline
   ───────────────────────────────────────────────────────────────────────────── */
function setupHeroCameraSwitcher() {
    const cameras = {
        '001334': {
            code: '001334',
            title: 'Passarela Joaquim Macedo',
            subtitle: 'Visão panorâmica da curva do Rio Acre (Calçadão da Gameleira)',
            link: '/camera/001334',
            status: 'online'
        },
        '001426': {
            code: '001426',
            title: 'Ponte Metálica',
            subtitle: 'Visão direta da régua oficial da CPRM',
            link: '/camera/001426',
            status: 'offline'
        }
    };

    let activeCamCode = '001334'; // Padrão inteligente na câmera online

    const tab1426 = document.getElementById('tab-cam-1426');
    const tab1334 = document.getElementById('tab-cam-1334');
    const tab1426Badge = document.getElementById('tab-cam-1426-badge');
    const tab1334Badge = document.getElementById('tab-cam-1334-badge');

    const heroFeed = document.getElementById('hero-camera-feed');
    const heroTitle = document.getElementById('hero-camera-title');
    const heroSubtitle = document.getElementById('hero-camera-subtitle');
    const heroHeaderStatus = document.getElementById('hero-camera-header-status');
    const heroStatusOverlay = document.getElementById('hero-camera-status-overlay');
    const heroLink = document.getElementById('hero-camera-full-link');
    const refreshBtn = document.getElementById('btn-refresh-hero-cam');

    const secondaryThumb = document.getElementById('hero-camera-secondary-thumb');
    const secondaryImg = document.getElementById('hero-thumb-img');
    const secondaryTitle = document.getElementById('hero-thumb-title');
    const secondaryStatusBadge = document.getElementById('hero-thumb-status-badge');
    const secondaryIndicator = document.getElementById('hero-thumb-indicator');
    const secondarySubtitle = document.getElementById('hero-thumb-subtitle');

    function updateUI() {
        const current = cameras[activeCamCode];
        const otherCode = activeCamCode === '001426' ? '001334' : '001426';
        const other = cameras[otherCode];

        const isCurrentOnline = current.status === 'online';
        const isOtherOnline = other.status === 'online';

        // 1. Player Principal
        if (heroTitle) heroTitle.textContent = current.title;
        if (heroLink) heroLink.href = current.link;

        if (heroSubtitle) {
            heroSubtitle.textContent = isCurrentOnline 
                ? current.subtitle 
                : `${current.subtitle} • Transmissão temporariamente fora do ar`;
        }

        if (heroHeaderStatus) {
            if (isCurrentOnline) {
                heroHeaderStatus.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60';
                heroHeaderStatus.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>Ao Vivo</span>';
            } else {
                heroHeaderStatus.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60';
                heroHeaderStatus.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span><span>Offline</span>';
            }
        }

        if (heroStatusOverlay) {
            if (isCurrentOnline) {
                heroStatusOverlay.className = 'absolute bottom-2 left-2 bg-slate-900/90 text-white text-[11px] font-medium px-2 py-0.5 rounded flex items-center gap-1.5 border border-white/10';
                heroStatusOverlay.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span><span>Ao Vivo • Monitoramento Contínuo</span>';
            } else {
                heroStatusOverlay.className = 'absolute bottom-2 left-2 bg-slate-900/95 text-white text-[11px] font-medium px-2 py-0.5 rounded flex items-center gap-1.5 border border-rose-500/30';
                heroStatusOverlay.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span><span class="text-rose-300 font-medium">Câmera Offline • Sem Sinal</span>';
            }
        }

        // 2. Tabs de Alternância
        if (activeCamCode === '001334') {
            tab1334?.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-900', 'dark:text-white', 'font-semibold', 'shadow-xs');
            tab1334?.classList.remove('text-slate-600', 'dark:text-slate-400', 'hover:text-slate-900', 'dark:hover:text-white', 'font-medium');
            tab1426?.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-900', 'dark:text-white', 'font-semibold', 'shadow-xs');
            tab1426?.classList.add('text-slate-600', 'dark:text-slate-400', 'hover:text-slate-900', 'dark:hover:text-white', 'font-medium');
        } else {
            tab1426?.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-900', 'dark:text-white', 'font-semibold', 'shadow-xs');
            tab1426?.classList.remove('text-slate-600', 'dark:text-slate-400', 'hover:text-slate-900', 'dark:hover:text-white', 'font-medium');
            tab1334?.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-900', 'dark:text-white', 'font-semibold', 'shadow-xs');
            tab1334?.classList.add('text-slate-600', 'dark:text-slate-400', 'hover:text-slate-900', 'dark:hover:text-white', 'font-medium');
        }

        // Badges das Tabs
        if (tab1334Badge) {
            if (cameras['001334'].status === 'online') {
                tab1334Badge.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500';
                tab1334Badge.textContent = '';
            } else {
                tab1334Badge.className = 'text-[9px] font-semibold text-rose-600 dark:text-rose-400';
                tab1334Badge.textContent = 'Offline';
            }
        }
        if (tab1426Badge) {
            if (cameras['001426'].status === 'online') {
                tab1426Badge.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500';
                tab1426Badge.textContent = '';
            } else {
                tab1426Badge.className = 'text-[9px] font-semibold text-rose-600 dark:text-rose-400';
                tab1426Badge.textContent = 'Offline';
            }
        }

        // 3. Miniatura Secundária
        if (secondaryTitle) secondaryTitle.textContent = other.title;
        if (secondaryImg) {
            secondaryImg.src = isOtherOnline 
                ? `/proxy/camera/${otherCode}?t=${Date.now()}` 
                : '/assets/offline.png';
        }

        if (secondaryStatusBadge) {
            if (isOtherOnline) {
                secondaryStatusBadge.className = 'px-1 py-0.2 rounded text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40';
                secondaryStatusBadge.textContent = 'Ao Vivo';
            } else {
                secondaryStatusBadge.className = 'px-1 py-0.2 rounded text-[9px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40';
                secondaryStatusBadge.textContent = 'Offline';
            }
        }

        if (secondaryIndicator) {
            secondaryIndicator.className = isOtherOnline 
                ? 'absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500' 
                : 'absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-rose-500';
        }

        if (secondarySubtitle) {
            secondarySubtitle.textContent = isOtherOnline 
                ? 'Câmera ao vivo • Clique para alternar' 
                : 'Câmera offline • Clique para alternar';
        }
    }

    function setActiveCamera(code) {
        activeCamCode = code;
        const current = cameras[code];

        if (heroFeed) {
            if (current.status === 'offline') {
                heroFeed.src = '/assets/offline.png';
            } else {
                heroFeed.src = `/proxy/camera/${code}?t=${Date.now()}`;
            }
        }

        updateUI();
    }

    // Monitorar eventos do feed para capturar mudanças dinâmicas
    if (heroFeed) {
        heroFeed.onerror = () => {
            heroFeed.src = '/assets/offline.png';
            cameras[activeCamCode].status = 'offline';
            updateUI();
        };

        heroFeed.onload = () => {
            if (heroFeed.src && !heroFeed.src.includes('offline.png')) {
                cameras[activeCamCode].status = 'online';
            } else {
                cameras[activeCamCode].status = 'offline';
            }
            updateUI();
        };
    }

    // Sincronizar status oficial das câmeras da base (/status-cameras)
    async function syncStatusFromApi() {
        try {
            const res = await fetch('/status-cameras');
            if (res.ok) {
                const list = await res.json();
                if (Array.isArray(list)) {
                    const c1426 = list.find(c => c.codigo === '001426');
                    const c1334 = list.find(c => c.codigo === '001334');
                    if (c1426 && c1426.status) cameras['001426'].status = c1426.status;
                    if (c1334 && c1334.status) cameras['001334'].status = c1334.status;
                }
            }
        } catch (_) {}

        // Regra de ouro: se uma câmera estiver offline e a outra online, prioriza a ONLINE!
        if (cameras[activeCamCode].status === 'offline') {
            const otherCode = activeCamCode === '001426' ? '001334' : '001426';
            if (cameras[otherCode].status === 'online') {
                activeCamCode = otherCode;
            }
        }

        setActiveCamera(activeCamCode);
    }

    if (tab1426) tab1426.onclick = () => setActiveCamera('001426');
    if (tab1334) tab1334.onclick = () => setActiveCamera('001334');
    if (secondaryThumb) {
        secondaryThumb.onclick = () => {
            const nextCode = activeCamCode === '001426' ? '001334' : '001426';
            setActiveCamera(nextCode);
        };
    }

    if (refreshBtn) {
        refreshBtn.onclick = () => {
            const icon = refreshBtn.querySelector('i, svg') || refreshBtn;
            icon.classList.add('animate-spin');
            syncStatusFromApi().finally(() => {
                setTimeout(() => {
                    icon.classList.remove('animate-spin');
                }, 500);
            });
        };
    }

    // Executa verificação inicial
    syncStatusFromApi();
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. Gráfico Unificado de Telemetria (24h, 7D, 15D, 30D, 90D, 1 Ano)
   ───────────────────────────────────────────────────────────────────────────── */
let rioUnifiedChart = null;
let currentUnifiedPeriod = '24h';
const unifiedDataCache = {};

async function initRioUnifiedChart() {
    const canvas = document.getElementById('rio-unified-chart');
    if (!canvas) return;

    const buttons = document.querySelectorAll('.unified-periodo-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const period = btn.getAttribute('data-period') || '24h';
            if (period === currentUnifiedPeriod) return;
            currentUnifiedPeriod = period;

            // Estilo dos botões (toolbar institucional limpa)
            buttons.forEach(b => {
                b.className = 'unified-periodo-btn px-2.5 py-1 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer';
            });
            btn.className = 'unified-periodo-btn px-2.5 py-1 rounded font-semibold bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs transition-colors cursor-pointer';

            loadUnifiedPeriod(currentUnifiedPeriod);
        });
    });

    await loadUnifiedPeriod(currentUnifiedPeriod);
}

async function loadUnifiedPeriod(period, forceRefresh = false) {
    const loader = document.getElementById('rio-unified-loader');
    const badge = document.getElementById('chart-period-badge');

    const badgeMap = {
        '24h': 'Últimas 24 Horas',
        '7': 'Últimos 7 Dias',
        '15': 'Últimos 15 Dias',
        '30': 'Últimos 30 Dias',
        '90': 'Últimos 90 Dias (3 Meses)',
        '365': 'Último 1 Ano (365 Dias)'
    };
    if (badge && badgeMap[period]) {
        badge.textContent = badgeMap[period];
    }

    try {
        if (loader) loader.style.display = 'flex';

        if (forceRefresh) {
            delete unifiedDataCache[period];
        }

        let data = unifiedDataCache[period];
        if (!data) {
            const queryDias = (period === '24h' || period === '7' || period === '15' || period === '30') 
                ? '30' 
                : period;
            
            const res = await fetch(`/api/rio-acre/historico?dias=${queryDias}`);
            if (!res.ok) throw new Error('Falha ao carregar dados do gráfico');
            const json = await res.json();
            
            if (period === '24h') {
                data = {
                    tipo: '24h',
                    leituras: json.leituras24h || [],
                    estatisticas: json.estatisticas24h || {}
                };
            } else if (period === '7' || period === '15' || period === '30') {
                const diasInt = parseInt(period, 10);
                data = {
                    tipo: 'dias',
                    pontos: (json.pontos || []).slice(-diasInt)
                };
            } else {
                data = {
                    tipo: 'dias',
                    pontos: json.pontos || []
                };
            }
            unifiedDataCache[period] = data;
        }

        window.lastUnifiedPeriod = period;
        window.lastUnifiedData = data;
        renderUnifiedChart(period, data);
    } catch (err) {
        console.warn('Erro ao carregar dados para o período:', period, err);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

function renderUnifiedChart(period, data) {
    const canvas = document.getElementById('rio-unified-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    let labels = [];
    let dataValues = [];
    let pontosRef = [];

    if (data.tipo === '24h') {
        const leituras = data.leituras || [];
        labels = leituras.map(p => p.hora);
        dataValues = leituras.map(p => p.nivel);
        pontosRef = leituras;

        // Atualizar as 4 métricas resumidas
        const stats = data.estatisticas || {};
        const elMedia = document.getElementById('stat-chart-media');
        const elMax = document.getElementById('stat-chart-max');
        const elMin = document.getElementById('stat-chart-min');
        const elVar = document.getElementById('stat-chart-var');

        if (elMedia && stats.mediaPeriodo) elMedia.textContent = `${stats.mediaPeriodo.toFixed(2).replace('.', ',')} m`;
        if (elMax && stats.maiorNivel?.metros) elMax.textContent = `${stats.maiorNivel.metros.toFixed(2).replace('.', ',')} m`;
        if (elMin && stats.menorNivel?.metros) elMin.textContent = `${stats.menorNivel.metros.toFixed(2).replace('.', ',')} m`;
        
        if (elVar && leituras.length >= 2) {
            const first = leituras[0].nivel;
            const last = leituras[leituras.length - 1].nivel;
            const diff = Number((last - first).toFixed(2));
            const sign = diff > 0 ? '+' : '';
            elVar.textContent = `${sign}${diff.toFixed(2).replace('.', ',')} m`;
        }
    } else {
        const pontos = data.pontos || [];
        pontosRef = pontos;

        if (period === '7') {
            labels = pontos.map(p => `${p.diaSemana || ''} ${p.data}`.trim());
        } else {
            labels = pontos.map(p => p.data);
        }
        dataValues = pontos.map(p => p.nivel);

        // Atualizar as 4 métricas resumidas
        if (pontos.length > 0) {
            const sum = pontos.reduce((acc, p) => acc + p.nivel, 0);
            const avg = sum / pontos.length;
            const max = Math.max(...pontos.map(p => p.max ?? p.nivel));
            const min = Math.min(...pontos.map(p => p.min ?? p.nivel));
            const first = pontos[0].nivel;
            const last = pontos[pontos.length - 1].nivel;
            const diff = Number((last - first).toFixed(2));
            const sign = diff > 0 ? '+' : '';

            const elMedia = document.getElementById('stat-chart-media');
            const elMax = document.getElementById('stat-chart-max');
            const elMin = document.getElementById('stat-chart-min');
            const elVar = document.getElementById('stat-chart-var');

            if (elMedia) elMedia.textContent = `${avg.toFixed(2).replace('.', ',')} m`;
            if (elMax) elMax.textContent = `${max.toFixed(2).replace('.', ',')} m`;
            if (elMin) elMin.textContent = `${min.toFixed(2).replace('.', ',')} m`;
            if (elVar) elVar.textContent = `${sign}${diff.toFixed(2).replace('.', ',')} m`;
        }
    }

    if (dataValues.length === 0) return;

    const isDark = document.documentElement.classList.contains('dark');
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 280);
    if (isDark) {
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.25)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.00)');
    } else {
        gradient.addColorStop(0, 'rgba(79, 70, 229, 0.15)');
        gradient.addColorStop(1, 'rgba(79, 70, 229, 0.00)');
    }

    const minVal = Math.min(...dataValues);
    const maxVal = Math.max(...dataValues);
    const yMin = Math.max(0, Number((minVal - 0.20).toFixed(2)));
    const yMax = Number((maxVal + 0.20).toFixed(2));

    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    if (rioUnifiedChart) {
        rioUnifiedChart.destroy();
    }

    const isLongSeries = dataValues.length > 50;

    rioUnifiedChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Nível do Rio Acre (m)',
                data: dataValues,
                borderColor: isDark ? '#818cf8' : '#4f46e5',
                borderWidth: isLongSeries ? 1.5 : 2,
                backgroundColor: gradient,
                fill: true,
                tension: 0.25,
                pointRadius: isLongSeries ? 0 : (period === '24h' || period === '7' ? 3 : 1.5),
                pointHoverRadius: 5,
                pointBackgroundColor: isDark ? '#818cf8' : '#4f46e5',
                pointBorderColor: isDark ? '#0f172a' : '#ffffff',
                pointBorderWidth: 1.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#0f172a' : '#ffffff',
                    titleColor: isDark ? '#f8fafc' : '#0f172a',
                    bodyColor: isDark ? '#cbd5e1' : '#334155',
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 8,
                    boxPadding: 3,
                    displayColors: false,
                    callbacks: {
                        title: (items) => {
                            const idx = items[0].dataIndex;
                            const p = pontosRef[idx];
                            if (data.tipo === '24h') {
                                return p?.dataCompleta ? `Medição: ${p.dataCompleta}` : `Hora: ${items[0].label}`;
                            }
                            return p?.diaSemanaCompleto
                                ? `${p.diaSemanaCompleto.charAt(0).toUpperCase() + p.diaSemanaCompleto.slice(1)}, ${p.dataCompleta || p.data}`
                                : (p?.dataCompleta || p?.data || items[0].label);
                        },
                        label: (context) => {
                            const idx = context.dataIndex;
                            const p = pontosRef[idx];
                            const lines = [
                                `Nível: ${context.parsed.y.toFixed(2).replace('.', ',')} m`
                            ];
                            if (p && p.min !== undefined && p.max !== undefined && p.min !== p.max) {
                                lines.push(`Oscilação: ${p.min.toFixed(2).replace('.', ',')} m ~ ${p.max.toFixed(2).replace('.', ',')} m`);
                            }
                            return lines;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: textColor,
                        font: { size: 11, family: 'Inter, sans-serif' },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: period === '365' ? 12 : (period === '90' ? 10 : 8)
                    }
                },
                y: {
                    min: yMin,
                    max: yMax,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        font: { size: 11, family: 'JetBrains Mono, Inter, monospace' },
                        callback: (val) => `${val.toFixed(2).replace('.', ',')} m`
                    }
                }
            }
        }
    });
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. Previsão Hidrológica & Comparativo Multianual
   ───────────────────────────────────────────────────────────────────────────── */
async function fetchRioPrevisao() {
    try {
        const res = await fetch('/api/rio-acre/previsao');
        if (!res.ok) throw new Error('Falha ao obter previsão hidrológica');
        const data = await res.json();

        // 1. Badge Direção Geral & Status de Risco
        const badgeDir = document.getElementById('prev-direcao-badge');
        if (badgeDir) {
            const dir = data.direcaoPrevisao || 'Estabilidade';
            const icon = data.iconeDirecao || 'minus';
            const cor = data.corDirecao || 'emerald';
            
            let colorClasses = 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60';
            if (cor === 'blue' || dir.toLowerCase().includes('sub')) {
                colorClasses = 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800/60';
            } else if (cor === 'amber') {
                colorClasses = 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60';
            } else if (cor === 'rose' || cor === 'red') {
                colorClasses = 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800/60';
            }

            badgeDir.className = `px-2 py-0.5 rounded text-xs font-semibold border flex items-center gap-1 ${colorClasses}`;
            badgeDir.innerHTML = `<i data-lucide="${icon}" class="w-3 h-3"></i> <span>${dir}</span>`;
        }

        const elRiscoTexto = document.getElementById('prev-risco-texto');
        if (elRiscoTexto) {
            elRiscoTexto.textContent = `Risco Enchente: ${data.riscoInundacao || 'Nulo (< 0,1%)'}`;
        }

        // 2. Projeções 24h, 48h, 7d
        const p24 = data.projecoes?.['24h'];
        if (p24) {
            const elNivel = document.getElementById('prev-24h-nivel');
            const elDelta = document.getElementById('prev-24h-delta');
            const elMargem = document.getElementById('prev-24h-margem');
            const elTend = document.getElementById('prev-24h-tendencia');

            if (elNivel) elNivel.textContent = `${p24.nivel.toFixed(2).replace('.', ',')} m`;
            if (elDelta) elDelta.textContent = `Var: ${p24.delta}`;
            if (elMargem) elMargem.textContent = `Faixa: ${p24.min.toFixed(2).replace('.', ',')}m ~ ${p24.max.toFixed(2).replace('.', ',')}m`;
            if (elTend) elTend.textContent = p24.tendencia;
        }

        const p48 = data.projecoes?.['48h'];
        if (p48) {
            const elNivel = document.getElementById('prev-48h-nivel');
            const elDelta = document.getElementById('prev-48h-delta');
            const elMargem = document.getElementById('prev-48h-margem');
            const elTend = document.getElementById('prev-48h-tendencia');

            if (elNivel) elNivel.textContent = `${p48.nivel.toFixed(2).replace('.', ',')} m`;
            if (elDelta) elDelta.textContent = `Var: ${p48.delta}`;
            if (elMargem) elMargem.textContent = `Faixa: ${p48.min.toFixed(2).replace('.', ',')}m ~ ${p48.max.toFixed(2).replace('.', ',')}m`;
            if (elTend) elTend.textContent = p48.tendencia;
        }

        const p7d = data.projecoes?.['7d'];
        if (p7d) {
            const elNivel = document.getElementById('prev-7d-nivel');
            const elDelta = document.getElementById('prev-7d-delta');
            const elMargem = document.getElementById('prev-7d-margem');
            const elTend = document.getElementById('prev-7d-tendencia');

            if (elNivel) elNivel.textContent = `${p7d.nivel.toFixed(2).replace('.', ',')} m`;
            if (elDelta) elDelta.textContent = `Var: ${p7d.delta}`;
            if (elMargem) elMargem.textContent = `Faixa: ${p7d.min.toFixed(2).replace('.', ',')}m ~ ${p7d.max.toFixed(2).replace('.', ',')}m`;
            if (elTend) elTend.textContent = p7d.tendencia;
        }

        // 3. Diagnóstico Técnico
        const elDiag = document.getElementById('prev-diagnostico');
        if (elDiag && data.diagnostico) {
            elDiag.textContent = data.diagnostico;
        }

        // 4. Comparativo Histórico
        const comp = data.comparativoHistorico || {};
        const elCompHoje = document.getElementById('comp-hoje');
        if (elCompHoje && data.nivelAtual) {
            elCompHoje.textContent = `${data.nivelAtual.toFixed(2).replace('.', ',')} m`;
        }

        const elCompLabel = document.getElementById('comp-label-mes');
        if (elCompLabel && data.mesReferencia) {
            elCompLabel.textContent = `Média de ${data.mesReferencia}`;
        }

        const elCompMedia = document.getElementById('comp-media-mes');
        if (elCompMedia && comp.mediaMes) {
            elCompMedia.textContent = `${comp.mediaMes.toFixed(2).replace('.', ',')} m`;
        }

        const elCompDesvio = document.getElementById('comp-desvio-mes');
        if (elCompDesvio && comp.diferencaMedia) {
            const isAbaixo = comp.diferencaMedia.startsWith('-');
            elCompDesvio.textContent = `${comp.diferencaMedia} (${isAbaixo ? 'abaixo da média' : 'acima da média'})`;
            elCompDesvio.className = isAbaixo 
                ? 'text-[10px] font-mono-num font-medium text-emerald-600 dark:text-emerald-400 mt-0.5'
                : 'text-[10px] font-mono-num font-medium text-amber-600 dark:text-amber-400 mt-0.5';
        }

        // 5. Grid de Climatologia Anual (Jan - Dez)
        renderClimatologiaGrid(data.climatologiaAnual, data.mesReferencia);

        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.warn('Erro ao carregar previsão hidrológica:', err);
    }
}

function renderClimatologiaGrid(climaList, mesAtualNome) {
    const grid = document.getElementById('prev-climatologia-grid');
    if (!grid || !Array.isArray(climaList)) return;

    grid.innerHTML = climaList.map(item => {
        const isCurrent = mesAtualNome && item.nome && item.nome.toLowerCase() === mesAtualNome.toLowerCase();
        const baseClass = isCurrent
            ? 'p-2 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold shadow-xs'
            : 'p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300';
        
        const subClass = isCurrent
            ? 'text-slate-300 dark:text-slate-600 font-medium'
            : 'text-slate-400 dark:text-slate-500';

        return `
            <div class="${baseClass} text-center flex flex-col justify-between" title="${item.nome}: ${item.tipo} (Média ${item.media.toFixed(1).replace('.', ',')} m)">
                <div class="text-[10px] uppercase font-bold tracking-tight">${item.mes}</div>
                <div class="text-xs font-mono-num font-bold my-0.5">${item.media.toFixed(1).replace('.', ',')}m</div>
                <div class="text-[8px] truncate ${subClass}">${item.tipo.split(' ')[0]}</div>
            </div>
        `;
    }).join('');
}


async function fetchRioTelemetry() {
    try {
        const res = await fetch('/api/rio-acre');
        if (!res.ok) throw new Error('Falha ao carregar telemetria');
        const data = await res.json();

        const nivelGrande = document.getElementById('rio-nivel-grande');
        const statusBadge = document.getElementById('rio-status-badge');
        const ultimaLeitura = document.getElementById('rio-ultima-leitura');
        const barraProgresso = document.getElementById('rio-barra-progresso');
        const barraRotulo = document.getElementById('rio-barra-rotulo');
        const percentualCota = document.getElementById('rio-percentual-cota');

        const nivelM = data.nivel?.metros || 1.76;
        const formatado = data.nivel?.formatado || '1,76 m';
        const dataStr = data.nivel?.dataLeitura || 'Hoje';

        if (nivelGrande) nivelGrande.textContent = formatado;
        if (ultimaLeitura) ultimaLeitura.textContent = `Medição oficial: ${dataStr}`;

        const cam1426Nivel = document.getElementById('rio-cam-1426-nivel');
        const cam1334Nivel = document.getElementById('rio-cam-1334-nivel');
        if (cam1426Nivel) cam1426Nivel.textContent = formatado;
        if (cam1334Nivel) cam1334Nivel.textContent = formatado;

        const heroOverlay = document.getElementById('hero-camera-nivel-overlay');
        if (heroOverlay) heroOverlay.textContent = formatado;

        if (statusBadge) {
            statusBadge.className = `mt-2.5 inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-white shadow-sm self-center ${data.status?.statusBg || 'bg-emerald-500'}`;
            statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-white animate-pulse"></span> ${data.status?.tipo || 'Normal'}`;
        }

        // Mensagem tranquilizadora para a população
        const elMensagem = document.getElementById('rio-mensagem-cidadao');
        if (elMensagem) {
            const diffAlerta = 13.50 - nivelM;
            if (diffAlerta > 2) {
                elMensagem.textContent = `Situação tranquila em Rio Branco: o rio está a ${diffAlerta.toFixed(2).replace('.', ',')} m da cota de alerta (13,50 m). Sem risco de enchente no momento.`;
            } else if (diffAlerta > 0) {
                elMensagem.textContent = `Atenção: o rio está a apenas ${diffAlerta.toFixed(2).replace('.', ',')} m da cota de alerta. Acompanhe as orientações da Defesa Civil.`;
            } else {
                elMensagem.textContent = `ALERTA MÁXIMO: Cota de transbordamento atingida. Procure locais seguros e ligue 199.`;
            }
        }

        const elTendBadge = document.getElementById('rio-tendencia-badge');
        if (elTendBadge) {
            const tendIcon = data.tendencia?.icon || 'minus';
            const tendStatus = data.tendencia?.status || 'Estável';
            elTendBadge.innerHTML = `<i data-lucide="${tendIcon}" class="w-3.5 h-3.5"></i> ${tendStatus}`;
        }

        const elHeroVazao = document.getElementById('stat-hero-vazao');
        if (elHeroVazao) {
            elHeroVazao.textContent = data.vazao || '45,0 m³/s';
        }

        const elHeroChuva = document.getElementById('stat-hero-chuva');
        if (elHeroChuva) {
            elHeroChuva.textContent = data.chuva || '0,0 mm';
        }

        const elHeroDistancia = document.getElementById('stat-hero-distancia');
        if (elHeroDistancia) {
            const diffAlerta = 13.50 - nivelM;
            if (diffAlerta > 0) {
                elHeroDistancia.textContent = `Faltam ${diffAlerta.toFixed(2).replace('.', ',')} m`;
                elHeroDistancia.className = diffAlerta > 2
                    ? 'text-xs sm:text-sm font-bold text-emerald-400 mt-0.5'
                    : 'text-xs sm:text-sm font-bold text-amber-400 mt-0.5';
            } else {
                elHeroDistancia.textContent = 'Cota Ultrapassada!';
                elHeroDistancia.className = 'text-xs sm:text-sm font-bold text-rose-400 mt-0.5';
            }
        }

        const elHeroFonte = document.getElementById('stat-hero-fonte');
        if (elHeroFonte) {
            elHeroFonte.textContent = data.fonte ? data.fonte.replace(' (ANA)', '') : 'ANA / CPRM';
        }

        // Informações complementares
        let infoExtra = document.getElementById('rio-info-extra');
        if (infoExtra) {
            const vazaoStr = data.vazao ? `Vazão: ${data.vazao}` : '';
            const chuvaStr = data.chuva ? `Chuva 24h: ${data.chuva}` : '';
            infoExtra.textContent = [vazaoStr, chuvaStr].filter(Boolean).join(' • ');
        }

        // Cota de transbordamento é 14.00m. Escala de 0 a 16m
        const pct = Math.min(100, Math.max(5, (nivelM / 16.0) * 100));
        if (barraProgresso) {
            barraProgresso.style.width = `${pct.toFixed(1)}%`;
        }

        // Agulha da régua e valor
        const gaugeNeedle = document.getElementById('rio-gauge-needle');
        const gaugeNeedleVal = document.getElementById('rio-gauge-needle-val');
        if (gaugeNeedle) {
            gaugeNeedle.style.left = `${pct.toFixed(1)}%`;
        }
        if (gaugeNeedleVal) {
            gaugeNeedleVal.textContent = formatado;
        }

        if (percentualCota) {
            const diffAlerta = (13.50 - nivelM).toFixed(2).replace('.', ',');
            const transbordPct = ((nivelM / 14.0) * 100).toFixed(0);
            if (nivelM < 13.50) {
                percentualCota.textContent = `Margem de segurança: ${diffAlerta} m até alerta (${transbordPct}% de 14m)`;
            } else {
                percentualCota.textContent = `ALERTA: Nível em ${transbordPct}% da cota de transbordamento!`;
            }
        }

        if (window.lucide) window.lucide.createIcons();
    } catch (e) {
        console.warn('Erro ao atualizar telemetria do rio:', e);
    }
}

/**
 * Gerencia a abertura e as ações do Modal de Compartilhamento do Nível do Rio.
 */
function setupRioShareModal() {
    const shareBtn = document.getElementById('btn-share-rio');
    const shareModal = document.getElementById('share-modal');
    const shareModalBox = document.getElementById('share-modal-box');
    const closeShareBtn = document.getElementById('close-share-modal-btn');
    const shareLinkInput = document.getElementById('share-link-input');
    const copyShareLinkBtn = document.getElementById('copy-share-link-btn');
    const toggleQrBtn = document.getElementById('toggle-qr-btn');
    const shareQrSection = document.getElementById('share-qr-section');
    const shareQrImg = document.getElementById('share-qr-img');
    const shareNativeBtn = document.getElementById('share-native-btn');

    const getRioTitle = () => {
        const nivelEl = document.getElementById('rio-nivel-grande');
        const nivelText = nivelEl && nivelEl.textContent !== '--' ? ` (${nivelEl.textContent})` : '';
        return `Nível do Rio Acre ao Vivo${nivelText} — Ponte Metálica`;
    };

    const openShareModal = () => {
        const baseUrl = `${location.origin}/rio`;
        const trackedUrl = window.CamRBShare ? window.CamRBShare.buildUrl(baseUrl, { source: 'share_link', medium: 'clipboard', campaign: 'rio_live' }) : baseUrl;

        if (shareLinkInput) shareLinkInput.value = trackedUrl;

        if (shareQrImg && window.CamRBShare) {
            shareQrImg.src = window.CamRBShare.getQrCodeUrl(baseUrl, 320);
        }

        if (shareModal) {
            shareModal.classList.remove('hidden');
            setTimeout(() => {
                shareModal.classList.remove('opacity-0');
                shareModalBox?.classList.remove('scale-95');
                shareModalBox?.classList.add('scale-100');
            }, 10);
        }
    };

    const closeShareModal = () => {
        if (!shareModal) return;
        shareModal.classList.add('opacity-0');
        shareModalBox?.classList.remove('scale-100');
        shareModalBox?.classList.add('scale-95');
        setTimeout(() => {
            shareModal.classList.add('hidden');
            if (shareQrSection) shareQrSection.classList.add('hidden');
        }, 200);
    };

    const handleMainShareClick = async () => {
        const title = getRioTitle();
        const baseUrl = `${location.origin}/rio`;
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        if (isMobile && navigator.share && window.CamRBShare) {
            try {
                const shared = await window.CamRBShare.nativeShare({
                    title: `${title} - Câmeras Rio Branco`,
                    url: baseUrl,
                    campaign: 'rio_live'
                });
                if (shared) return;
            } catch (_) {}
        }

        openShareModal();
    };

    if (shareBtn) shareBtn.onclick = handleMainShareClick;
    if (closeShareBtn) closeShareBtn.onclick = closeShareModal;
    if (shareModal) {
        shareModal.onclick = (e) => {
            if (e.target === shareModal) closeShareModal();
        };
    }

    if (toggleQrBtn && shareQrSection) {
        toggleQrBtn.onclick = () => {
            const isHidden = shareQrSection.classList.contains('hidden');
            if (isHidden) {
                shareQrSection.classList.remove('hidden');
                toggleQrBtn.querySelector('span').textContent = 'Ocultar QR Code';
            } else {
                shareQrSection.classList.add('hidden');
                toggleQrBtn.querySelector('span').textContent = 'Ver QR Code';
            }
        };
    }

    if (shareNativeBtn) {
        shareNativeBtn.onclick = async () => {
            const title = getRioTitle();
            const baseUrl = `${location.origin}/rio`;
            if (window.CamRBShare) {
                const shared = await window.CamRBShare.nativeShare({
                    title: `${title} - Câmeras Rio Branco`,
                    url: baseUrl,
                    campaign: 'rio_live'
                });
                if (shared) closeShareModal();
            }
        };
    }

    if (copyShareLinkBtn) {
        copyShareLinkBtn.onclick = async () => {
            const title = getRioTitle();
            const baseUrl = `${location.origin}/rio`;
            if (window.CamRBShare) {
                await window.CamRBShare.copyLink(baseUrl, {
                    title,
                    campaign: 'rio_live',
                    buttonEl: copyShareLinkBtn,
                    toastMsg: 'Link da telemetria do Rio Acre copiado!'
                });
            } else {
                try {
                    await navigator.clipboard.writeText(baseUrl);
                    window.showToast?.('Link copiado!');
                } catch (_) {}
            }
        };
    }

    const shareWhatsApp = document.getElementById('share-whatsapp-btn');
    if (shareWhatsApp) {
        shareWhatsApp.onclick = () => {
            const title = getRioTitle();
            const baseUrl = `${location.origin}/rio`;
            if (window.CamRBShare) {
                window.CamRBShare.toWhatsApp({ title, url: baseUrl, campaign: 'rio_live' });
            } else {
                window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(baseUrl)}`, '_blank');
            }
        };
    }

    const shareTelegram = document.getElementById('share-telegram-btn');
    if (shareTelegram) {
        shareTelegram.onclick = () => {
            const title = getRioTitle();
            const baseUrl = `${location.origin}/rio`;
            if (window.CamRBShare) {
                window.CamRBShare.toTelegram({ title, url: baseUrl, campaign: 'rio_live' });
            } else {
                window.open(`https://t.me/share/url?url=${encodeURIComponent(baseUrl)}`, '_blank');
            }
        };
    }

    const shareTwitter = document.getElementById('share-twitter-btn');
    if (shareTwitter) {
        shareTwitter.onclick = () => {
            const title = getRioTitle();
            const baseUrl = `${location.origin}/rio`;
            if (window.CamRBShare) {
                window.CamRBShare.toTwitter({ title, url: baseUrl, campaign: 'rio_live' });
            } else {
                window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(baseUrl)}`, '_blank');
            }
        };
    }

    const shareFacebook = document.getElementById('share-facebook-btn');
    if (shareFacebook) {
        shareFacebook.onclick = () => {
            const title = getRioTitle();
            const baseUrl = `${location.origin}/rio`;
            if (window.CamRBShare) {
                window.CamRBShare.toFacebook({ title, url: baseUrl, campaign: 'rio_live' });
            } else {
                window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(baseUrl)}`, '_blank');
            }
        };
    }
}