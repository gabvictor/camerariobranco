import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initAuthModal, initGlobalAuthUI, toggleLoginModal } from "./auth-modal.js";

// Initialize Auth
initAuthModal();
initGlobalAuthUI();

// Format Uptime Helper
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
}

// Fetch Metrics Logic
async function fetchMetrics() {
    try {
        const response = await fetch('/health');
        if (!response.ok) throw new Error('Failed to fetch metrics');
        
        const data = await response.json();
        
        // Update DOM elements with animation
        animateValue("stat-total-cameras", 0, data.cachedCount || 0, 1000);
        animateValue("stat-online-cameras", 0, data.onlineCount || 0, 1000);
        animateValue("stat-requests", 0, data.metrics.requestCount || 0, 1500);
        
        const uptimeEl = document.getElementById("stat-uptime");
        if (uptimeEl) uptimeEl.textContent = formatUptime(data.uptimeMs);

    } catch (error) {
        console.error("Error loading metrics:", error);
    }
}

// Fetch Random Cameras Logic
async function fetchRandomCameras() {
    const grid = document.getElementById('random-cameras-grid');
    if (!grid) return;

    try {
        const response = await fetch('/status-cameras');
        if (!response.ok) throw new Error('Failed to fetch cameras');

        const cameras = await response.json();
        const onlineCameras = cameras.filter(c => c.status === 'online');

        // Shuffle and pick 3
        const shuffled = onlineCameras.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, 3);

        if (selected.length === 0) {
            grid.innerHTML = '<p class="text-gray-500 col-span-full text-center">Nenhuma câmera online no momento.</p>';
            return;
        }

        grid.innerHTML = selected.map(camera => `
            <a href="/camera/${camera.codigo}" class="group block relative overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800 aspect-video shadow-sm hover:shadow-md transition-all border border-gray-200 dark:border-gray-700">
                <img 
                    src="/proxy/camera/${camera.codigo}?t=${Date.now()}" 
                    alt="${camera.nome}" 
                    loading="lazy"
                    class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    onerror="this.src='/assets/offline.png'"
                >
                <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60"></div>
                
                <div class="absolute bottom-0 left-0 p-4 w-full">
                    <div class="flex items-center justify-between">
                        <h3 class="text-white font-medium text-sm truncate pr-2">${camera.nome}</h3>
                        <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 backdrop-blur-sm border border-emerald-500/30">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span class="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Ao Vivo</span>
                        </div>
                    </div>
                </div>
                
                <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/20 backdrop-blur-[2px]">
                    <div class="bg-white/90 dark:bg-gray-900/90 p-3 rounded-full shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform">
                        <i data-lucide="play" class="w-6 h-6 text-indigo-600 dark:text-indigo-400 fill-current"></i>
                    </div>
                </div>
            </a>
        `).join('');

        // Re-initialize icons for the new elements
        if (window.lucide) window.lucide.createIcons();

    } catch (error) {
        console.error("Error loading random cameras:", error);
        grid.innerHTML = '<p class="text-red-500 col-span-full text-center">Erro ao carregar câmeras.</p>';
    }
}

// Number Animation Helper
function animateValue(id, start, end, duration) {
    const obj = document.getElementById(id);
    if (!obj) return;
    
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerHTML = end; // Ensure final value is accurate
        }
    };
    window.requestAnimationFrame(step);
}

// Initialize Metrics
fetchMetrics();
fetchRandomCameras();

// Initialize Icons
if (window.lucide) window.lucide.createIcons();

// Theme Toggle Logic
const themeToggleBtn = document.getElementById('toggle-theme');
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.toggleTheme) {
            window.toggleTheme();
        }
    });
}
