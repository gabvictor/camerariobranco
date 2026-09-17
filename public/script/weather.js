
export let cachedWeather = null;

export const fetchWeather = async () => {
    const widget = document.getElementById('weather-widget');
    const fsWeather = document.getElementById('fs-camera-weather');

    try {
        // Rio Branco Coordinates: -9.97499, -67.8243
        const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=-9.975&longitude=-67.824&current=temperature_2m,weather_code&timezone=America%2FSao_Paulo');
        if (!response.ok) throw new Error('Weather API error');
        
        const data = await response.json();
        const temp = Math.round(data.current.temperature_2m);
        const code = data.current.weather_code;
        
        // Map WMO codes to icons/text
        let iconName = 'sun';
        let desc = 'Ensolarado';
        
        if (code >= 1 && code <= 3) { iconName = 'cloud-sun'; desc = 'Parcialmente nublado'; }
        else if (code >= 45 && code <= 48) { iconName = 'cloud-fog'; desc = 'Neblina'; }
        else if (code >= 51 && code <= 67) { iconName = 'cloud-drizzle'; desc = 'Chuva fraca'; }
        else if (code >= 80 && code <= 82) { iconName = 'cloud-rain'; desc = 'Chuva'; }
        else if (code >= 95) { iconName = 'cloud-lightning'; desc = 'Tempestade'; }
        
        // Adjust for night time (simple check 6pm-6am)
        const hour = new Date().getHours();
        const isNight = hour >= 18 || hour < 6;
        if (isNight && iconName === 'sun') { iconName = 'moon'; desc = 'Limpo'; }
        if (isNight && iconName === 'cloud-sun') { iconName = 'cloud-moon'; }

        cachedWeather = { temp, tempText: `${temp}°C`, iconName, desc };

        if (widget) {
            widget.innerHTML = `
                <i data-lucide="${iconName}" class="w-3.5 h-3.5 text-amber-500"></i>
                <span id="weather-temp" class="font-bold">${temp}°C</span>
            `;
            widget.title = `Rio Branco: ${desc}`;
            widget.style.display = 'flex';
        }

        if (fsWeather) {
            fsWeather.innerHTML = `
                <i data-lucide="${iconName}" class="w-3 h-3 text-amber-300"></i>
                <span class="font-bold text-amber-300">${temp}°C</span>
            `;
            fsWeather.title = `Rio Branco: ${desc}`;
            fsWeather.classList.remove('hidden');
            fsWeather.classList.add('inline-flex', 'items-center', 'gap-1');
        }
        
        // Re-init icons for the new weather icon
        if (window.lucide) {
            try { window.lucide.createIcons(); } catch (_) {}
        }

        return cachedWeather;
    } catch (error) {
        console.error("Error fetching weather:", error);
        if (widget) widget.style.display = 'none';
        if (fsWeather) fsWeather.classList.add('hidden');
        return null;
    }
};
