import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
    // Mapa agora é público
    const mapWrapper = document.getElementById('map-wrapper');
    if (mapWrapper) mapWrapper.style.display = 'flex'; // Usando flex para layout correto
    initializeMapLogic();
});

async function initializeMapLogic() {
    if (window.lucide) window.lucide.createIcons();
    const map = L.map('map').setView([-9.9745, -67.8100], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Theme Toggle Logic
    const themeToggleBtn = document.getElementById('map-theme-toggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            if (window.toggleTheme) {
                window.toggleTheme();
            }
        });
    }

    // Locate Me Logic
    const locateBtn = document.getElementById('locate-btn');
    if (locateBtn) {
        locateBtn.addEventListener('click', () => {
            map.locate({ setView: true, maxZoom: 16 });
        });
        
        map.on('locationfound', (e) => {
            // Remove existing location markers if any (optional, but good practice)
            // For simplicity, we just add new ones
            L.marker(e.latlng).addTo(map)
                .bindPopup("Você está aqui").openPopup();
            L.circle(e.latlng, e.accuracy).addTo(map);
        });

        map.on('locationerror', (e) => {
            alert("Não foi possível obter sua localização. Verifique as permissões.");
        });
    }

    const markers = L.markerClusterGroup();
    const categoryColors = {
        'Vias Urbanas': '#3b82f6', 'Praça': '#22c55e', 'Ponte': '#ef4444', 'Calçadão': '#f97316', 'Shopping Aquiri': '#8b5cf6', 'Mercado Velho': '#a16207', 'Gameleira': '#16a34a', 'Terminal': '#64748b', 'ExpoAcre': '#e11d48', 'Horto Florestal': '#15803d', 'Cemitério': '#78716c', 'default': '#71717a'
    };
    const createPinIcon = (color) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><path fill="${color}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle fill="white" cx="12" cy="9" r="2.5"/></svg>`;
        return L.divIcon({ html: svg, className: 'custom-leaflet-icon', iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] });
    };

    try {
        const response = await fetch('/status-cameras');
        const cameras = await response.json();
        const onlineCamerasWithCoords = cameras.filter(cam => cam.status === 'online' && Array.isArray(cam.coords) && cam.coords.length === 2);

        const params = new URLSearchParams(window.location.search);
        const targetCode = params.get('code');
        let targetMarker = null;

        onlineCamerasWithCoords.forEach(camera => {
            const color = categoryColors[camera.categoria] || categoryColors['default'];
            const icon = createPinIcon(color);
            const marker = L.marker(camera.coords, { icon: icon });
            const popupContent = `<img src="/proxy/camera?code=${camera.codigo}&t=${Date.now()}" alt="Câmera ${camera.nome}"><div class="popup-info"><h3>${camera.nome}</h3><a href="/camera/${camera.codigo}" target="_blank">Ver em Tela Cheia</a></div>`;
            marker.bindPopup(popupContent);
            markers.addLayer(marker);

            if (targetCode && camera.codigo === targetCode) {
                targetMarker = marker;
            }
        });
        map.addLayer(markers);

        if (targetMarker) {
            markers.zoomToShowLayer(targetMarker, function() {
                targetMarker.openPopup();
            });
        }
    } catch (error) {
        console.error("Falha ao carregar câmeras para o mapa:", error);
        document.body.insertAdjacentHTML('beforeend', '<div class="absolute bottom-5 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-md shadow-lg">Não foi possível carregar as câmeras.</div>');
    }
}
