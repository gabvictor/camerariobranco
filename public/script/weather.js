
export const fetchWeather = async () => {
    const widget = document.getElementById('weather-widget');
    if (!widget) return;

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

        widget.innerHTML = `
            <i data-lucide="${iconName}" class="w-4 h-4"></i>
            <span>${temp}°C</span>
        `;
        widget.title = `Rio Branco: ${desc}`;
        
        // Remove inline display:none to let CSS classes control visibility
        widget.style.display = '';
        
        // Re-init icons for the new weather icon
        if (window.lucide) window.lucide.createIcons();

    } catch (error) {
        console.error("Error fetching weather:", error);
        widget.style.display = 'none';
    }
};
