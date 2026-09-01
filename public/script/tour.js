export function initTour() {
    if (!window.driver || !window.driver.js) return;

    const pathname = window.location.pathname;

    const buildSteps = () => {
        // ─── 1. Página do Rio Acre (/rio) ──────────────────────────
        if (pathname.includes('/rio')) {
            return [
                {
                    element: '#rio-nivel-grande',
                    popover: {
                        title: '🌊 Nível em Tempo Real',
                        description: 'Cota atualizada do Rio Acre medida diretamente pelos sensores telemétricos da CPRM / SGB na Ponte Metálica.',
                        side: 'bottom',
                        align: 'center'
                    }
                },
                {
                    element: '#rio-barra-progresso',
                    popover: {
                        title: '📏 Escala e Alertas de Enchente',
                        description: 'Acompanhe visualmente a distância até a Cota de Alerta (13,50m) e Transbordamento (14,00m).',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: '#rio-cam-1426',
                    popover: {
                        title: '📹 Câmera da Régua CPRM',
                        description: 'Transmissão ao vivo focada na régua física da Ponte Metálica para você verificar visualmente a altura da água.',
                        side: 'top',
                        align: 'start'
                    }
                },
                {
                    element: '#rio-cam-1334',
                    popover: {
                        title: '🌉 Passarela Joaquim Macedo',
                        description: 'Visão panorâmica do leito central do Rio Acre e do centro histórico de Rio Branco.',
                        side: 'top',
                        align: 'start'
                    }
                }
            ];
        }

        // ─── 2. Página de Timelapses (/timelapses) ──────────────────
        if (pathname.includes('/timelapses')) {
            return [
                {
                    element: '#timelapse-frame-img',
                    popover: {
                        title: '⏱️ Resumo em Vídeo 24h',
                        description: 'O CamRB grava fotos automáticas a cada minuto para gerar esse timelapse acelerado das últimas 24 horas.',
                        side: 'bottom',
                        align: 'center'
                    }
                },
                {
                    element: '#timelapse-slider',
                    popover: {
                        title: '⏪ Linha do Tempo Interativa',
                        description: 'Arraste o cursor para avançar ou retroceder a gravação até qualquer hora do dia ou da noite.',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: '#btn-play-pause',
                    popover: {
                        title: '▶️ Controles de Reprodução',
                        description: 'Dê Play/Pause, ajuste a velocidade (1x, 2x, 4x) e assista ao trânsito do dia inteiro em poucos segundos.',
                        side: 'top',
                        align: 'start'
                    }
                }
            ];
        }

        // ─── 3. Página do Mapa (/mapa) ──────────────────────────────
        if (pathname.includes('/mapa')) {
            return [
                {
                    element: '#map',
                    popover: {
                        title: '🗺️ Mapa Interativo',
                        description: 'Navegue pelo mapa de Rio Branco e veja onde cada câmera de monitoramento está posicionada.',
                        side: 'top',
                        align: 'center'
                    }
                },
                {
                    element: '#toggle-theme',
                    popover: {
                        title: '🌗 Tema Claro e Escuro',
                        description: 'Alterne o visual para uma navegação mais confortável dia e noite.',
                        side: 'bottom',
                        align: 'end'
                    }
                }
            ];
        }

        // ─── 4. Página de Perfil (/perfil) ──────────────────────────
        if (pathname.includes('/perfil')) {
            return [
                {
                    element: '#user-avatar-container',
                    popover: {
                        title: '👤 Seu Perfil',
                        description: 'Aqui você vê sua conta conectada, seu nome e status de membro.',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: '#favorites-list',
                    popover: {
                        title: '⭐ Câmeras Favoritas',
                        description: 'Lista com acesso rápido a todas as câmeras que você marcou com a estrelinha na página inicial.',
                        side: 'top',
                        align: 'start'
                    }
                },
                {
                    element: '#theme-toggle-card',
                    popover: {
                        title: '⚙️ Preferências',
                        description: 'Ajuste o tema do site e gerencie suas preferências de privacidade.',
                        side: 'top',
                        align: 'start'
                    }
                }
            ];
        }

        // ─── 5. Página Inicial (/) ──────────────────────────────────
        return [
            {
                element: 'header nav',
                popover: {
                    title: '🧭 Menu Principal',
                    description: 'Acesse rapidamente o <strong>Rio Acre</strong> (nível ao vivo), <strong>Timelapses</strong> (resumo 24h), <strong>Mapa</strong> e <strong>Sobre</strong>.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: '#search-input',
                popover: {
                    title: '🔍 Busca Rápida',
                    description: 'Digite o nome de uma rua, avenida ou bairro (ex: Centro, Ceará, Floresta) para achar a câmera.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: '#status-filters',
                popover: {
                    title: '⚡ Filtros de Status',
                    description: 'Filtre apenas câmeras <strong>Online</strong>, suas <strong>Favoritas</strong> ou ordene pelas <strong>Mais Acessadas</strong>.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: '#category-toggle-btn',
                popover: {
                    title: '📍 Regiões e Bairros',
                    description: 'Clique para expandir e filtrar câmeras por regiões específicas da capital.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: '#camera-grid',
                popover: {
                    title: '📹 Câmeras da Cidade',
                    description: 'Clique em qualquer câmera para assistir a transmissão ao vivo em tela grande e ver estatísticas de tráfego.',
                    side: 'top',
                    align: 'center'
                }
            },
            {
                element: '#toggle-theme',
                popover: {
                    title: '🌙 Modo Escuro',
                    description: 'Alterne entre o tema claro e escuro para uma visualização confortável a qualquer hora.',
                    side: 'bottom',
                    align: 'end'
                }
            }
        ];
    };

    const startTour = () => {
        const allSteps = buildSteps();
        const steps = allSteps.filter(step => document.querySelector(step.element));
        if (!steps.length) return;

        const driverInstance = window.driver.js.driver({
            showProgress: true,
            animate: true,
            showButtons: ['previous', 'next', 'close'],
            nextBtnText: 'Próximo',
            prevBtnText: 'Voltar',
            doneBtnText: 'Concluir',
            steps
        });

        driverInstance.drive();
    };

    const startTourBtn = document.getElementById('start-tour-btn');
    if (startTourBtn) {
        startTourBtn.addEventListener('click', (e) => {
            e.preventDefault();
            startTour();
        });
    }

    // Auto-inicia o tour no primeiro acesso do usuário a ESTA tela específica
    let pageSlug = pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '_') || 'home';
    const pageTourKey = `camrb_tour_seen_${pageSlug}`;
    if (!localStorage.getItem(pageTourKey)) {
        setTimeout(() => {
            startTour();
            localStorage.setItem(pageTourKey, 'true');
        }, 1200);
    }
}
