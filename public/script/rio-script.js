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

    // Refresh Live Cameras every 15 seconds via proxy
    const cam1426 = document.getElementById('rio-cam-1426');
    const cam1334 = document.getElementById('rio-cam-1334');
    setInterval(() => {
        const t = Date.now();
        if (cam1426) cam1426.src = `/proxy/camera/001426?t=${t}`;
        if (cam1334) cam1334.src = `/proxy/camera/001334?t=${t}`;
    }, 15000);

    fetchRioTelemetry();
    setInterval(fetchRioTelemetry, 60000);
});

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

        const nivelM = data.nivel?.metros || 2.28;
        const formatado = data.nivel?.formatado || '2,28 m';
        const dataStr = data.nivel?.dataLeitura || 'Hoje';

        if (nivelGrande) nivelGrande.textContent = formatado;
        if (ultimaLeitura) ultimaLeitura.textContent = `Medição: ${dataStr}`;

        if (statusBadge) {
            statusBadge.className = `mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-white shadow-sm ${data.status?.statusBg || 'bg-emerald-500'}`;
            statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-white animate-pulse"></span> ${data.status?.tipo || 'Normal'}`;
        }

        // Cota de transbordamento é 14.00m. Vamos calcular porcentagem na barra de 0 a 16m
        const pct = Math.min(100, Math.max(5, (nivelM / 16.0) * 100));
        if (barraProgresso) {
            barraProgresso.style.width = `${pct.toFixed(1)}%`;
        }
        if (barraRotulo) {
            barraRotulo.textContent = formatado;
        }
        if (percentualCota) {
            const transbordPct = ((nivelM / 14.0) * 100).toFixed(0);
            percentualCota.textContent = `${transbordPct}% da cota de transbordamento`;
        }

        if (window.lucide) window.lucide.createIcons();
    } catch (e) {
        console.warn('Erro ao atualizar telemetria do rio:', e);
    }
}
