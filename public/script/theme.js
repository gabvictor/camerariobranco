(function() {
    function getTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            return savedTheme;
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }

    const theme = getTheme();
    applyTheme(theme);

    // Expose toggle function globally
    window.toggleTheme = function() {
        const currentTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
        
        // Dispatch a custom event in case other scripts need to react
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: newTheme } }));
        
        return newTheme;
    };
    // ─── Domain Migration Banner Logic ───────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function() {
        const hostname = window.location.hostname;
        const isLocal = ['localhost', '127.0.0.1', '10.', '192.168.', '172.', '::1'].some(h => hostname.includes(h));
        const isSiteDomain = hostname.includes('.site') || hostname.includes('camerasriobranco.site');
        
        // Exibir se for o domínio antigo .site (ou se não for o oficial e não for localhost)
        const isNewDomain = hostname === 'camerasriobranco.com.br' || hostname.endsWith('.camerasriobranco.com.br');
        
        // Habilitado exibir no localhost para testes do desenvolvedor
        const shouldShow = isSiteDomain || (!isLocal && !isNewDomain) || isLocal;
        
        if (shouldShow && !sessionStorage.getItem('domain-banner-dismissed')) {
            showMigrationBanner(isLocal);
        }
    });

    function showMigrationBanner(isLocal) {
        const style = document.createElement('style');
        style.textContent = `
            #domain-migration-banner {
                background: linear-gradient(135deg, #f59e0b, #d97706);
                color: #ffffff;
                font-family: 'Inter', sans-serif;
                font-size: 14px;
                padding: 12px 16px;
                position: relative;
                z-index: 10000;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                text-align: center;
                transition: all 0.3s ease-in-out;
            }
            @media (min-width: 768px) {
                #domain-migration-banner {
                    flex-direction: row;
                    justify-content: space-between;
                    text-align: left;
                    gap: 20px;
                    padding: 8px 24px;
                }
            }
            #domain-migration-banner .banner-message {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 500;
                line-height: 1.4;
            }
            #domain-migration-banner .banner-message strong {
                font-weight: 700;
            }
            #domain-migration-banner .banner-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                justify-content: center;
            }
            #domain-migration-banner button, #domain-migration-banner a {
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                padding: 6px 12px;
                cursor: pointer;
                transition: all 0.2s ease;
                border: none;
                text-decoration: none;
                display: inline-flex;
                align-items: center;
            }
            #domain-migration-banner .btn-primary {
                background-color: #ffffff;
                color: #d97706;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            #domain-migration-banner .btn-primary:hover {
                background-color: #f3f4f6;
                transform: translateY(-1px);
            }
            #domain-migration-banner .btn-secondary {
                background-color: rgba(255, 255, 255, 0.2);
                color: #ffffff;
            }
            #domain-migration-banner .btn-secondary:hover {
                background-color: rgba(255, 255, 255, 0.3);
            }
            #domain-migration-banner .btn-close {
                background: transparent;
                color: rgba(255, 255, 255, 0.8);
                font-size: 20px;
                padding: 4px 8px;
                font-weight: 300;
            }
            #domain-migration-banner .btn-close:hover {
                color: #ffffff;
            }
            #domain-migration-banner .pulse-icon {
                animation: pulse 2s infinite;
                flex-shrink: 0;
            }
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.15); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);

        const banner = document.createElement('div');
        banner.id = 'domain-migration-banner';
        
        const targetUrl = 'https://camerasriobranco.com.br' + window.location.pathname + window.location.search + window.location.hash;
        
        let secondsLeft = 15;
        let countdownInterval;

        banner.innerHTML = `
            <div class="banner-message">
                <svg class="pulse-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>
                    O domínio antigo <strong>camerasriobranco.site</strong> expira dia <strong>27/06</strong>. 
                    Redirecionando para o novo oficial em <strong id="migration-timer">${secondsLeft}s</strong>...
                </span>
            </div>
            <div class="banner-actions">
                <a href="${targetUrl}" class="btn-primary">Acessar Novo Site</a>
                <button id="btn-pause-migration" class="btn-secondary">Pausar</button>
                <button id="btn-close-migration" class="btn-close" title="Dispensar aviso">&times;</button>
            </div>
        `;

        document.body.prepend(banner);

        const timerEl = document.getElementById('migration-timer');
        const pauseBtn = document.getElementById('btn-pause-migration');
        const closeBtn = document.getElementById('btn-close-migration');

        const startCountdown = () => {
            countdownInterval = setInterval(() => {
                secondsLeft--;
                if (secondsLeft <= 0) {
                    clearInterval(countdownInterval);
                    if (isLocal) {
                        timerEl.innerHTML = `<span style="background: rgba(0,0,0,0.25); padding: 3px 6px; border-radius: 4px; font-size: 11px;">Simulado (localhost)</span>`;
                        console.log("[MIGRATION REDIRECT] Redirecionaria para:", targetUrl);
                    } else {
                        window.location.href = targetUrl;
                    }
                } else {
                    timerEl.textContent = `${secondsLeft}s`;
                }
            }, 1000);
        };

        const stopCountdown = () => {
            clearInterval(countdownInterval);
            timerEl.parentElement.innerHTML = `O domínio antigo <strong>camerasriobranco.site</strong> expira dia <strong>27/06</strong>. Por favor, salve o novo endereço oficial: <strong>camerasriobranco.com.br</strong>.`;
            pauseBtn.style.display = 'none';
        };

        pauseBtn.addEventListener('click', stopCountdown);

        closeBtn.addEventListener('click', () => {
            clearInterval(countdownInterval);
            sessionStorage.setItem('domain-banner-dismissed', 'true');
            banner.style.opacity = '0';
            banner.style.height = '0';
            banner.style.padding = '0';
            setTimeout(() => {
                banner.remove();
            }, 300);
        });

        startCountdown();
    }
})();
