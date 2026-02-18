export function initTour() {
    if (!window.driver || !window.driver.js) return;

    const startTourBtn = document.getElementById('start-tour-btn');

    const buildSteps = () => {
        const steps = [
            {
                element: '#nav-map-btn',
                popover: {
                    title: 'Mapa da Cidade',
                    description: 'Veja todas as câmeras distribuídas no mapa interativo.',
                    side: 'bottom',
                    align: 'end'
                }
            },
            {
                element: '#nav-changelog-btn',
                popover: {
                    title: 'Novidades',
                    description: 'Acompanhe as atualizações e melhorias recentes do CamRB.',
                    side: 'bottom',
                    align: 'end'
                }
            },
            {
                element: '#toggle-theme',
                popover: {
                    title: 'Tema Claro / Escuro',
                    description: 'Alterne entre tema claro e escuro para ver melhor as câmeras.',
                    side: 'bottom',
                    align: 'end'
                }
            },
            {
                element: '#search-input',
                popover: {
                    title: 'Busca Rápida',
                    description: 'Pesquise por ruas ou bairros.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: '#status-filters',
                popover: {
                    title: 'Filtros',
                    description: 'Veja câmeras Online, Favoritas ou Perto de Mim.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: '#category-toggle-btn',
                popover: {
                    title: 'Categorias',
                    description: 'Filtre por zonas ou tipos.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: '#camera-grid',
                popover: {
                    title: 'Câmeras ao Vivo',
                    description: 'Clique em uma câmera <strong>Online</strong> para abrir a página detalhada. Ao acessar a página da câmera, o tour continua explicando a imagem e os controles.',
                    side: 'bottom',
                    align: 'start'
                }
            }
        ];

        const loginBtn = document.getElementById('login-btn');
        if (loginBtn && getComputedStyle(loginBtn).display !== 'none') {
            steps.push({
                element: '#login-btn',
                popover: {
                    title: 'Login',
                    description: 'Entre para salvar favoritos.',
                    side: 'bottom',
                    align: 'end'
                }
            });
        }

        return steps;
    };

    const startTour = () => {
        const allSteps = buildSteps();
        const steps = allSteps.filter(step => document.querySelector(step.element));
        if (!steps.length) return;

        localStorage.setItem('camrb_camera_tour_trigger', 'pending');

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

    if (startTourBtn) {
        startTourBtn.addEventListener('click', () => {
            startTour();
        });
    }

    if (!localStorage.getItem('camrb_tour_seen')) {
        setTimeout(() => {
            startTour();
            localStorage.setItem('camrb_tour_seen', 'true');
        }, 2000);
    }

    // Tour da página de câmera é controlado em camera-script.js usando camrb_camera_tour_trigger
}
