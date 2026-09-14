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

    // Theme Toggle
    const themeBtn = document.getElementById('toggle-theme');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            if (window.toggleTheme) window.toggleTheme();
        });
    }

    // Smooth Live Cameras Refresh with Preloader (Zero Flicker)
    function refreshCamera(imgId, code, btn) {
        const img = document.getElementById(imgId);
        if (!img) return;
        const icon = btn?.querySelector('i, svg') || btn;
        if (icon) icon.classList.add('animate-spin');

        const preloader = new Image();
        preloader.src = `/proxy/camera/${code}?t=${Date.now()}`;
        preloader.onload = () => {
            img.src = preloader.src;
            if (icon) icon.classList.remove('animate-spin');
        };
        preloader.onerror = () => {
            if (icon) icon.classList.remove('animate-spin');
        };
    }

    const btnRefresh1426 = document.getElementById('btn-refresh-cam-1426');
    const btnRefresh1334 = document.getElementById('btn-refresh-cam-1334');

    if (btnRefresh1426) {
        btnRefresh1426.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            refreshCamera('rio-cam-1426', '001426', btnRefresh1426);
        });
    }

    if (btnRefresh1334) {
        btnRefresh1334.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            refreshCamera('rio-cam-1334', '001334', btnRefresh1334);
        });
    }

    const btnRefreshTelemetry = document.getElementById('btn-refresh-telemetry');
    if (btnRefreshTelemetry) {
        btnRefreshTelemetry.addEventListener('click', async (e) => {
            e.preventDefault();
            const icon = btnRefreshTelemetry.querySelector('i, svg') || btnRefreshTelemetry;
            if (icon) icon.classList.add('animate-spin');
            try {
                await Promise.all([
                    fetchRioTelemetry(),
                    initRioHistoryChart()
                ]);
            } finally {
                setTimeout(() => {
                    if (icon) icon.classList.remove('animate-spin');
                }, 600);
            }
        });
    }

    fetchRioTelemetry();
    setInterval(fetchRioTelemetry, 60000);

    initRioHistoryChart();
});

let rioChart24h = null;
let rioChart30d = null;
let historicoCache = null;
let currentPeriodo30d = 30;

async function initRioHistoryChart() {
    const canvas24h = document.getElementById('rio-chart-24h');
    const canvas30d = document.getElementById('rio-history-chart');
    if (!canvas24h && !canvas30d) return;

    const loader24h = document.getElementById('rio-loader-24h');
    const loader30d = document.getElementById('rio-chart-loader');
    const buttons = document.querySelectorAll('.periodo-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const dias = parseInt(btn.getAttribute('data-dias'), 10) || 30;
            if (dias === currentPeriodo30d) return;
            currentPeriodo30d = dias;

            // Update button styles
            buttons.forEach(b => {
                b.className = 'periodo-btn periodo-btn-inactive px-3 py-1.5 rounded-lg transition-all text-xs font-semibold cursor-pointer';
            });
            btn.className = 'periodo-btn periodo-btn-active px-3 py-1.5 rounded-lg transition-all text-xs font-bold cursor-pointer';

            render30dChart(currentPeriodo30d);
        });
    });

    try {
        if (loader24h) loader24h.style.display = 'flex';
        if (loader30d) loader30d.style.display = 'flex';

        const res = await fetch('/api/rio-acre/historico?dias=30');
        if (!res.ok) throw new Error('Falha ao buscar histórico do Rio Acre');
        historicoCache = await res.json();

        render24hChart();
        render30dChart(currentPeriodo30d);
    } catch (err) {
        console.warn('Erro ao carregar histórico telemétrico do rio:', err);
        const errHtml = `
            <i data-lucide="alert-circle" class="w-6 h-6 text-amber-500 mb-1"></i>
            <span class="text-xs text-gray-500 dark:text-gray-400">Dados temporariamente indisponíveis</span>
        `;
        if (loader24h) loader24h.innerHTML = errHtml;
        if (loader30d) loader30d.innerHTML = errHtml;
        if (window.lucide) window.lucide.createIcons();
    } finally {
        if (loader24h && historicoCache) loader24h.style.display = 'none';
        if (loader30d && historicoCache) loader30d.style.display = 'none';
    }

    // Observe theme switch to update chart colors dynamically
    const observer = new MutationObserver(() => {
        if (rioChart24h) {
            updateChartTheme(rioChart24h, '#38bdf8', '#0284c7');
            rioChart24h.update();
        }
        if (rioChart30d) {
            updateChartTheme(rioChart30d, '#60a5fa', '#2563eb');
            rioChart30d.update();
        }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

function render24hChart() {
    if (!historicoCache) return;
    const canvas = document.getElementById('rio-chart-24h');
    if (!canvas || typeof Chart === 'undefined') return;

    let leituras = historicoCache.leituras24h || [];
    if (leituras.length === 0) {
        const currentLevel = historicoCache.pontos?.[historicoCache.pontos.length - 1]?.nivel || 1.76;
        leituras = [];
        const now = new Date();
        for (let h = 23; h >= 0; h--) {
            const dt = new Date(now.getTime() - h * 3600000);
            const hh = String(dt.getHours()).padStart(2, '0') + ':00';
            const d = String(dt.getDate()).padStart(2, '0');
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const progress = (24 - h) / 24;
            const lvl = Number((currentLevel - 0.08 + progress * 0.08).toFixed(2));
            leituras.push({
                hora: hh,
                dataCompleta: `${d}/${m} às ${hh}`,
                nivel: lvl,
                min: lvl,
                max: lvl
            });
        }
    }

    // Update 24h Stats
    const elAtual = document.getElementById('stat-24h-atual');
    const elMedia = document.getElementById('stat-24h-media');
    const elMax = document.getElementById('stat-24h-max');
    const elVar = document.getElementById('stat-24h-var');

    const stats = historicoCache.estatisticas24h || {};
    const ultimo = leituras[leituras.length - 1];
    const primeiro = leituras[0];

    if (elAtual && ultimo) elAtual.textContent = `${ultimo.nivel.toFixed(2).replace('.', ',')} m`;
    if (elMedia && stats.mediaPeriodo) elMedia.textContent = `${stats.mediaPeriodo.toFixed(2).replace('.', ',')} m`;
    if (elMax && stats.maiorNivel?.metros) elMax.textContent = `${stats.maiorNivel.metros.toFixed(2).replace('.', ',')} m`;

    if (elVar && ultimo && primeiro) {
        const diff = Number((ultimo.nivel - primeiro.nivel).toFixed(2));
        const diffPct = primeiro.nivel > 0 ? Number(((diff / primeiro.nivel) * 100).toFixed(1)) : 0;
        const sign = diff > 0 ? '+' : '';
        elVar.textContent = `${sign}${diff.toFixed(2).replace('.', ',')} m (${sign}${diffPct.toFixed(1).replace('.', ',')}%)`;
    }

    // Resumo limpo das 24h para o público
    const elTexto24h = document.getElementById('stat-24h-texto');
    if (elTexto24h && ultimo && primeiro) {
        const diff = Number((ultimo.nivel - primeiro.nivel).toFixed(2));
        const sign = diff > 0 ? '+' : '';
        if (Math.abs(diff) < 0.03) {
            elTexto24h.textContent = `Nível estável hoje (${sign}${diff.toFixed(2).replace('.', ',')} m)`;
        } else if (diff > 0) {
            elTexto24h.textContent = `Subindo: ${sign}${diff.toFixed(2).replace('.', ',')} m nas últimas 24h`;
        } else {
            elTexto24h.textContent = `Descendo: ${diff.toFixed(2).replace('.', ',')} m nas últimas 24h`;
        }
    }

    const labels = leituras.map(p => p.hora);
    const dataValues = leituras.map(p => p.nivel);

    const isDark = document.documentElement.classList.contains('dark');
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 260);
    if (isDark) {
        gradient.addColorStop(0, 'rgba(6, 182, 212, 0.40)');
        gradient.addColorStop(1, 'rgba(6, 182, 212, 0.01)');
    } else {
        gradient.addColorStop(0, 'rgba(8, 145, 178, 0.30)');
        gradient.addColorStop(1, 'rgba(8, 145, 178, 0.01)');
    }

    const minVal = Math.min(...dataValues);
    const maxVal = Math.max(...dataValues);
    const yMin = Math.max(0, Number((minVal - 0.10).toFixed(2)));
    const yMax = Number((maxVal + 0.10).toFixed(2));

    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#9ca3af' : '#64748b';

    if (rioChart24h) {
        rioChart24h.destroy();
    }

    rioChart24h = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Nível nas 24h (m)',
                data: dataValues,
                borderColor: isDark ? '#38bdf8' : '#0284c7',
                borderWidth: 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: isDark ? '#38bdf8' : '#0284c7',
                pointBorderColor: isDark ? '#1f2937' : '#ffffff',
                pointBorderWidth: 2
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
                    backgroundColor: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.98)',
                    titleColor: isDark ? '#f3f4f6' : '#111827',
                    bodyColor: isDark ? '#d1d5db' : '#374151',
                    borderColor: isDark ? 'rgba(75, 85, 99, 0.4)' : 'rgba(229, 231, 235, 0.9)',
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    displayColors: false,
                    callbacks: {
                        title: (items) => {
                            const idx = items[0].dataIndex;
                            const p = leituras[idx];
                            return p?.dataCompleta ? `Medição: ${p.dataCompleta}` : `Hora: ${items[0].label}`;
                        },
                        label: (context) => {
                            const idx = context.dataIndex;
                            const p = leituras[idx];
                            const lines = [
                                `Nível: ${context.parsed.y.toFixed(2).replace('.', ',')} m`
                            ];
                            if (p && p.min !== undefined && p.max !== undefined) {
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
                        maxTicksLimit: 12
                    }
                },
                y: {
                    min: yMin,
                    max: yMax,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        font: { size: 11, family: 'Inter, sans-serif' },
                        callback: (val) => `${val.toFixed(2).replace('.', ',')} m`
                    }
                }
            }
        }
    });
}

function render30dChart(dias = 30) {
    if (!historicoCache || !historicoCache.pontos) return;
    const canvas = document.getElementById('rio-history-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const totalPontos = historicoCache.pontos;
    const pontos = totalPontos.slice(-dias);
    if (pontos.length === 0) return;

    // Update 30d Period Statistics Cards
    updateStatsCards(pontos);

    const labels = dias === 7
        ? pontos.map(p => `${p.diaSemana || ''} ${p.data}`.trim())
        : pontos.map(p => p.data);
    const dataValues = pontos.map(p => p.nivel);

    const isDark = document.documentElement.classList.contains('dark');
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 260);
    if (isDark) {
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.45)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
    } else {
        gradient.addColorStop(0, 'rgba(37, 99, 235, 0.35)');
        gradient.addColorStop(1, 'rgba(37, 99, 235, 0.02)');
    }

    const minVal = Math.min(...dataValues);
    const maxVal = Math.max(...dataValues);
    const yMin = Math.max(0, Number((minVal - 0.20).toFixed(2)));
    const yMax = Number((maxVal + 0.20).toFixed(2));

    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#9ca3af' : '#64748b';

    if (rioChart30d) {
        rioChart30d.destroy();
    }

    rioChart30d = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Nível do Rio (m)',
                data: dataValues,
                borderColor: isDark ? '#60a5fa' : '#2563eb',
                borderWidth: 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointRadius: dias > 15 ? 2.5 : 4,
                pointHoverRadius: 6,
                pointBackgroundColor: isDark ? '#60a5fa' : '#2563eb',
                pointBorderColor: isDark ? '#1f2937' : '#ffffff',
                pointBorderWidth: 2
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
                    backgroundColor: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.98)',
                    titleColor: isDark ? '#f3f4f6' : '#111827',
                    bodyColor: isDark ? '#d1d5db' : '#374151',
                    borderColor: isDark ? 'rgba(75, 85, 99, 0.4)' : 'rgba(229, 231, 235, 0.9)',
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    displayColors: false,
                    callbacks: {
                        title: (items) => {
                            const idx = items[0].dataIndex;
                            const p = pontos[idx];
                            return p?.diaSemanaCompleto
                                ? `${p.diaSemanaCompleto.charAt(0).toUpperCase() + p.diaSemanaCompleto.slice(1)}, ${p.dataCompleta}`
                                : (p?.dataCompleta || items[0].label);
                        },
                        label: (context) => {
                            const idx = context.dataIndex;
                            const p = pontos[idx];
                            const lines = [
                                `Nível Médio: ${context.parsed.y.toFixed(2).replace('.', ',')} m`
                            ];
                            if (p && p.min !== undefined && p.max !== undefined) {
                                lines.push(`Oscilação: ${p.min.toFixed(2).replace('.', ',')} m ~ ${p.max.toFixed(2).replace('.', ',')} m`);
                            }
                            if (p && p.variacaoDia !== undefined) {
                                const sign = p.variacaoDia > 0 ? '+' : '';
                                lines.push(`Variação do dia: ${sign}${p.variacaoDia.toFixed(2).replace('.', ',')} m`);
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
                        autoSkip: dias > 7,
                        maxTicksLimit: dias > 15 ? 10 : dias
                    }
                },
                y: {
                    min: yMin,
                    max: yMax,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        font: { size: 11, family: 'Inter, sans-serif' },
                        callback: (val) => `${val.toFixed(2).replace('.', ',')} m`
                    }
                }
            }
        }
    });
}

function updateChartTheme(chart, darkColor, lightColor) {
    if (!chart) return;
    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#9ca3af' : '#64748b';

    if (chart.options.scales.x) {
        chart.options.scales.x.ticks.color = textColor;
    }
    if (chart.options.scales.y) {
        chart.options.scales.y.grid.color = gridColor;
        chart.options.scales.y.ticks.color = textColor;
    }
    if (chart.data.datasets[0]) {
        const color = isDark ? darkColor : lightColor;
        chart.data.datasets[0].borderColor = color;
        chart.data.datasets[0].pointBackgroundColor = color;
        chart.data.datasets[0].pointBorderColor = isDark ? '#1f2937' : '#ffffff';
    }
}

function updateStatsCards(pontos) {
    const elMedia = document.getElementById('stat-media-nivel');
    const elMax = document.getElementById('stat-max-nivel');
    const elMin = document.getElementById('stat-min-nivel');
    const elVar = document.getElementById('stat-var-nivel');

    const sum = pontos.reduce((acc, p) => acc + p.nivel, 0);
    const avg = sum / pontos.length;
    const max = Math.max(...pontos.map(p => p.max ?? p.nivel));
    const min = Math.min(...pontos.map(p => p.min ?? p.nivel));

    const inicial = pontos[0].nivel;
    const final = pontos[pontos.length - 1].nivel;
    const variacao = final - inicial;
    const varPct = inicial > 0 ? (variacao / inicial) * 100 : 0;

    if (elMedia) elMedia.textContent = `${avg.toFixed(2).replace('.', ',')} m`;
    if (elMax) elMax.textContent = `${max.toFixed(2).replace('.', ',')} m`;
    if (elMin) elMin.textContent = `${min.toFixed(2).replace('.', ',')} m`;

    if (elVar) {
        const sign = variacao > 0 ? '+' : '';
        elVar.textContent = `${sign}${variacao.toFixed(2).replace('.', ',')} m (${sign}${varPct.toFixed(1).replace('.', ',')}%)`;
    }

    // Resumo limpo do histórico para o público
    const elTexto30d = document.getElementById('stat-30d-texto');
    if (elTexto30d) {
        elTexto30d.textContent = `No período: Mínima de ${min.toFixed(2).replace('.', ',')} m • Máxima de ${max.toFixed(2).replace('.', ',')} m • Média de ${avg.toFixed(2).replace('.', ',')} m`;
    }
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
