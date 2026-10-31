/**
 * Guias do CamRB: textos próprios sobre o Rio Acre, as cheias e o funcionamento do site.
 *
 * Regras para editar:
 *  - Só entra número que veio de fonte conferida (cotas do SGB/CPRM, telemetria da ANA) ou que o próprio CamRB mediu.
 *  - Texto simples: `[texto](/rota)` vira link; o resto é escapado pelo GuideRenderer.
 *  - `atualizado` (AAAA-MM-DD) aparece na página e no sitemap; mude quando revisar o conteúdo.
 */

const MEDIDAS = 'Medições do CamRB sobre a telemetria da ANA';

const GUIAS = [
    {
        slug: 'cotas-do-rio-acre',
        titulo: 'Cotas do Rio Acre em Rio Branco: o que significam atenção, alerta e transbordamento',
        curto: 'Cotas do Rio Acre',
        descricao: 'Entenda o que é a cota do rio, quais são as cotas de atenção (12,50 m), alerta (13,50 m) e transbordamento (14,00 m) em Rio Branco e como ler o nível da estação da ANA.',
        resumo: 'O que é a cota, quais são os três níveis de referência e como interpretar o número que aparece no site.',
        atualizado: '2026-10-31',
        intro: 'Quando o noticiário diz que o Rio Acre "chegou a 13 metros", o número é uma cota. Ele não mede a altura da água em relação à rua nem à sua casa: mede o nível da água em relação a um ponto de referência fixo da estação de medição. Este guia explica o que a cota significa, quais são os níveis de referência usados em Rio Branco e como interpretar o que você vê na página [Nível do Rio Acre](/rio).',
        secoes: [
            {
                h: 'O que é a cota do rio',
                p: [
                    'Cota é o nível da superfície da água lido numa régua (ou num sensor) instalada no rio, contado a partir de um zero próprio daquela estação. O zero da régua de Rio Branco foi escolhido pelos técnicos que instalaram a estação e não corresponde ao leito do rio nem ao nível do mar. Por isso, a mesma cota de 13 metros representa situações diferentes em cidades diferentes, e só faz sentido comparar valores da mesma estação.',
                    'A estação usada pelo CamRB é a 13600002, em Rio Branco, que faz parte da Rede Hidrometeorológica Nacional. Ela é mantida pelo Serviço Geológico do Brasil (SGB, antigo CPRM) em parceria com a Agência Nacional de Águas e Saneamento Básico (ANA), que publica as leituras. Todo valor de nível exibido no CamRB vem dessa estação.'
                ]
            },
            {
                h: 'As três cotas de referência',
                p: ['Para a estação de Rio Branco, o SGB/CPRM trabalha com três níveis de referência, usados nos boletins de acompanhamento da bacia do Rio Acre:'],
                tabela: {
                    cabecalho: ['Cota', 'Nível', 'Significado'],
                    linhas: [
                        ['Atenção', '12,50 m', 'Primeiro nível de acompanhamento. O rio está alto e merece monitoramento mais frequente.'],
                        ['Alerta', '13,50 m', 'Segundo nível. As áreas mais baixas das margens passam a correr risco de alagamento.'],
                        ['Transbordamento', '14,00 m', 'O rio extravasa a calha e a água avança sobre áreas habitadas das margens.']
                    ]
                },
                p2: [
                    'Esses valores são referências técnicas, não previsões. Entre 13,50 m e 14,00 m, por exemplo, só 50 centímetros separam o alerta do transbordamento, e o rio pode percorrer essa distância em poucos dias numa cheia forte. Quem mora perto do rio deve acompanhar a evolução do nível e não apenas o valor do momento.'
                ]
            },
            {
                h: 'Como o CamRB mostra a cota',
                list: [
                    'O número grande da página [Nível do Rio Acre](/rio) é a última leitura da estação, com a hora em que foi registrada.',
                    'Se a leitura estiver velha (mais de duas horas) ou a ANA não responder, o site avisa que o dado está desatualizado em vez de mostrar um valor como se fosse atual.',
                    'A seta de tendência compara a leitura com a de cerca de uma hora antes: subindo, descendo ou estável.',
                    'O gráfico histórico mostra a média diária, a mínima e a máxima de cada dia.'
                ]
            },
            {
                h: 'Para ter uma ideia de escala',
                p: [
                    'A maior cheia de Rio Branco de que temos registro chegou a 18,40 m, em março de 2015. Nas leituras da telemetria da ANA entre 2021 e 2025 que o CamRB examinou, o nível passou de 17 m em abril de 2023 (17,77 m) e em março de 2024 (17,91 m). No extremo oposto, a menor leitura que encontramos nesse período foi de 1,21 m, em 28 de setembro de 2022, no auge da estiagem.',
                    'Ou seja, entre a seca e a cheia o rio pode variar mais de 15 metros, e as três cotas de referência ficam na faixa alta dessa variação: são níveis de uma cheia, não do dia a dia.'
                ],
                nota: 'Os valores acima vêm da telemetria da ANA (dados preliminares, sem consolidação) e do registro histórico divulgado pela imprensa. O período anterior a 2021 não foi consultado, então a menor leitura citada não deve ser entendida como um recorde absoluto.'
            },
            {
                h: 'O que o CamRB não faz',
                p: [
                    'O CamRB é um projeto independente. Ele reproduz leituras oficiais e as apresenta de forma mais fácil de acompanhar, mas não emite alertas oficiais nem decreta situação de emergência. Em caso de risco, siga as orientações da Defesa Civil (telefone 199) e consulte os boletins do SGB/CPRM. Veja também o guia [O que fazer em uma cheia](/guias/o-que-fazer-em-uma-cheia).'
                ]
            }
        ],
        relacionados: ['cheias-e-secas-do-rio-acre', 'como-funciona-a-estacao-do-rio-acre', 'o-que-fazer-em-uma-cheia']
    },

    {
        slug: 'cheias-e-secas-do-rio-acre',
        titulo: 'Cheias e secas do Rio Acre: como o nível muda ao longo do ano',
        curto: 'Cheias e secas',
        descricao: 'Veja a média mensal do nível do Rio Acre em Rio Branco (2021-2025), quando ocorrem as cheias e a estiagem e quanto tempo a água de montante leva para chegar à capital.',
        resumo: 'Média mensal do nível, as estações do ano no Acre e o tempo que a onda de cheia leva rio abaixo.',
        atualizado: '2026-10-31',
        intro: 'O Rio Acre é um rio de planície amazônica com um ciclo anual muito marcado: transborda de um lado do calendário e quase seca do outro. Este guia mostra esse ciclo com números reais da telemetria da ANA em Rio Branco e explica por que a água que você vê hoje na Ponte Metálica pode ter caído como chuva muito mais acima, no curso do rio, dias antes.',
        secoes: [
            {
                h: 'O ciclo de um ano',
                p: [
                    'No Acre, o período chuvoso vai, em linhas gerais, de novembro a abril, e o período de seca, de maio a outubro. O rio acompanha essa alternância com algum atraso: ele começa a subir quando as chuvas se firmam nas cabeceiras, atinge o ponto mais alto entre fevereiro e abril e desce de forma contínua até o fim da estiagem, em setembro ou outubro.',
                    'A tabela abaixo traz a média do nível em cada mês, calculada pelo CamRB a partir das leituras da estação 13600002 entre 2021 e 2025. Foram usados só os meses com leituras suficientes (pelo menos 1.200 por mês, o equivalente a mais de duas semanas de dados), de três a cinco anos para cada mês.'
                ],
                tabela: {
                    cabecalho: ['Mês', 'Nível médio', 'Fase do ciclo'],
                    linhas: [
                        ['Janeiro', '7,83 m', 'Início da cheia'],
                        ['Fevereiro', '10,95 m', 'Cheia'],
                        ['Março', '11,40 m', 'Pico da cheia'],
                        ['Abril', '8,67 m', 'Início da descida'],
                        ['Maio', '4,72 m', 'Transição para a seca'],
                        ['Junho', '2,98 m', 'Estiagem'],
                        ['Julho', '2,16 m', 'Seca'],
                        ['Agosto', '1,72 m', 'Seca severa'],
                        ['Setembro', '1,54 m', 'Mínima do ano'],
                        ['Outubro', '2,31 m', 'Transição para as chuvas'],
                        ['Novembro', '2,78 m', 'Elevação das águas'],
                        ['Dezembro', '6,59 m', 'Subida rápida']
                    ]
                },
                nota: 'São médias de apenas cinco anos, então servem como referência recente e não como climatologia de longo prazo. Cada ano foge bastante da média: em março de 2025, por exemplo, a média mensal foi de 13,10 m, bem acima da média da tabela.'
            },
            {
                h: 'De outubro a dezembro: a subida',
                p: [
                    'Entre outubro e dezembro o nível costuma passar de pouco mais de 2 metros para quase 7 metros em média. É a época em que as primeiras chuvas fortes chegam e o rio responde depressa. Para quem mora nas margens, é o momento de começar a acompanhar o rio, porque a subida pode ser rápida: o nível de dezembro de 2025 chegou a 15,42 m na telemetria, um valor que já está acima da cota de alerta.'
                ]
            },
            {
                h: 'A água de cima demora para chegar',
                p: [
                    'O Rio Acre nasce no Peru e passa por Assis Brasil, Brasiléia e Xapuri antes de chegar a Rio Branco. Uma chuva forte nas cabeceiras só aparece em Rio Branco depois de dias, e isso permite acompanhar a cheia chegando.',
                    'O CamRB mediu esse atraso numa pequena onda de cheia em outubro de 2026: o pico passou por Xapuri em 20 de outubro, por Capixaba em 21 de outubro à tarde e por Rio Branco em 22 de outubro à tarde. Em média, a variação de nível em Capixaba aparece em Rio Branco cerca de 28 horas depois, e a de Xapuri, cerca de 63 horas depois, com correlação de 0,97 entre as medições. É exatamente esse comportamento que a estimativa da página [Nível do Rio Acre](/rio) usa para olhar rio acima.'
                ],
                nota: `${MEDIDAS}, de 3 a 31 de outubro de 2026, em um período de seca com uma única onda pequena. Em cheias grandes, o atraso pode ser diferente.`
            },
            {
                h: 'A seca também importa',
                p: [
                    'O rio baixo afeta a navegação, o abastecimento de água e a vida de comunidades ribeirinhas. Em setembro o nível médio fica perto de 1,5 m, e a menor leitura que encontramos entre 2021 e 2025 foi de 1,21 m, em 28 de setembro de 2022. Nesse período do ano a estação também serve para acompanhar o início das primeiras chuvas, que se revela por pequenas subidas no fim de setembro e em outubro.'
                ]
            },
            {
                h: 'Como usar essas informações',
                list: [
                    'Compare o nível de hoje com a média do mês na página [Nível do Rio Acre](/rio): ela mostra se o rio está acima ou abaixo do normal recente.',
                    'Observe a tendência (subindo, descendo, estável) e não só o valor do momento.',
                    'Se você mora em área de risco, inscreva-se nos [alertas por e-mail](/rio) para receber um aviso quando o rio passar das cotas de referência.',
                    'Confirme sempre com a Defesa Civil (199) antes de tomar decisões de segurança.'
                ]
            }
        ],
        relacionados: ['cotas-do-rio-acre', 'como-funciona-a-estacao-do-rio-acre', 'o-que-fazer-em-uma-cheia']
    },

    {
        slug: 'como-funciona-a-estacao-do-rio-acre',
        titulo: 'Como funciona a estação que mede o nível do Rio Acre',
        curto: 'A estação de medição',
        descricao: 'Do sensor à tela: como a estação telemétrica 13600002 mede o Rio Acre em Rio Branco, como os dados chegam à ANA e por que as leituras podem atrasar ou ser corrigidas.',
        resumo: 'O caminho do dado, da medição no rio até a página do CamRB, e os limites da telemetria.',
        atualizado: '2026-10-31',
        intro: 'O número que aparece em /rio não é uma estimativa do CamRB: é uma leitura de uma estação telemétrica pública. Este guia conta o caminho que esse dado percorre, o que significa dizer que ele é "telemétrico" e por que, de vez em quando, o site avisa que a leitura está desatualizada.',
        secoes: [
            {
                h: 'O que é uma estação telemétrica',
                p: [
                    'Uma estação telemétrica mede uma grandeza (aqui, o nível da água) e envia o resultado a distância, sem que alguém precise ir até lá ler uma régua. Ela costuma reunir um sensor de nível, uma unidade que registra os dados, uma fonte de energia (em geral painel solar e bateria) e um meio de transmissão, que pode ser satélite ou rede de dados móveis, conforme o local.',
                    'Algumas estações medem também a chuva e a vazão. Na rede da ANA, cada estação tem um código de oito dígitos; a de Rio Branco é a 13600002. Existem outras estações no mesmo rio, a montante, como as de Xapuri (13550000) e Capixaba (13568000), e o CamRB usa essas leituras para acompanhar a cheia chegando.'
                ]
            },
            {
                h: 'Do rio até a página do CamRB',
                list: [
                    'O sensor mede o nível e a estação registra uma leitura em intervalos curtos; na série que o CamRB consulta, são cerca de 4 leituras por hora.',
                    'Os dados seguem para a base da ANA, que os publica no serviço HidroWeb, por meio de uma API com login.',
                    'O servidor do CamRB consulta essa API, guarda o resultado por alguns minutos para não sobrecarregá-la e entrega a informação para a página.',
                    'Cada resposta traz o horário da última leitura. Se ela tiver mais de duas horas, o site marca o dado como desatualizado.',
                    'Se a API principal falhar, o servidor tenta um serviço antigo da ANA como reserva. Se nenhum responder, o site mostra uma mensagem de indisponibilidade em vez de um número inventado.'
                ]
            },
            {
                h: 'Por que os dados podem atrasar ou mudar',
                p: [
                    'Dados telemétricos são preliminares: passam por verificações automáticas, mas não por uma consistência hidrológica completa. A ANA marca cada leitura com um código de qualidade e o CamRB descarta as leituras classificadas como ruins. Mesmo assim, um valor pode ser corrigido depois, e é por isso que o histórico exibido às vezes muda um pouco de um dia para o outro.',
                    'Também há falhas reais: sensor sujo, bateria fraca, queda de transmissão. Quando isso acontece, a leitura simplesmente não chega e a "última leitura" fica velha. O alerta de dado desatualizado existe para que ninguém trate um valor de horas atrás como se fosse o nível atual.'
                ]
            },
            {
                h: 'O que a régua e a câmera mostram',
                p: [
                    'Além do sensor, existe uma régua graduada na margem, que serve de conferência visual. A página [Nível do Rio Acre](/rio) exibe a câmera da região da Ponte Metálica, e é possível olhar a régua na imagem e comparar com o número da telemetria. Se os dois destoarem muito, vale desconfiar do dado e consultar uma fonte oficial.'
                ],
                nota: 'A identificação detalhada dos equipamentos da estação (marca e modelo dos sensores) ainda precisa ser confirmada com o SGB, por isso este guia não os cita.'
            },
            {
                h: 'Fontes oficiais',
                list: [
                    'ANA (Agência Nacional de Águas e Saneamento Básico): publica as leituras no portal HidroWeb.',
                    'SGB/CPRM (Serviço Geológico do Brasil): opera as estações e emite boletins de acompanhamento da bacia do Rio Acre.',
                    'Defesa Civil (telefone 199): orienta a população em situações de risco.'
                ]
            }
        ],
        relacionados: ['cotas-do-rio-acre', 'cheias-e-secas-do-rio-acre', 'como-o-camrb-funciona']
    },

    {
        slug: 'o-que-fazer-em-uma-cheia',
        titulo: 'O que fazer antes, durante e depois de uma cheia do Rio Acre',
        curto: 'O que fazer em uma cheia',
        descricao: 'Orientações gerais de segurança para moradores das margens do Rio Acre em Rio Branco: como se preparar, o que fazer durante a cheia e cuidados depois da água baixar.',
        resumo: 'Preparação, cuidados durante a enchente e o que fazer depois, com os telefones úteis.',
        atualizado: '2026-10-31',
        intro: 'Este guia reúne orientações gerais de segurança para quem mora ou trabalha perto do Rio Acre. Ele não substitui as instruções da Defesa Civil, que conhece a situação de cada bairro e indica abrigos e rotas de saída. Em qualquer dúvida, ligue 199.',
        secoes: [
            {
                h: 'Telefones úteis',
                list: [
                    'Defesa Civil: 199',
                    'Corpo de Bombeiros: 193',
                    'SAMU: 192',
                    'Polícia Militar: 190'
                ]
            },
            {
                h: 'Antes da cheia: prepare-se com antecedência',
                list: [
                    'Acompanhe o nível do rio na página [Nível do Rio Acre](/rio) e os boletins oficiais. A subida costuma dar sinais com dias de antecedência.',
                    'Descubra com a Defesa Civil qual é o abrigo mais próximo e qual caminho usar para chegar até lá sem atravessar áreas alagadas.',
                    'Guarde documentos, receitas e cartões em saco plástico bem fechado e deixe-os num lugar alto e de fácil acesso.',
                    'Separe uma bolsa com medicamentos de uso contínuo, água potável, lanterna, pilhas, carregador portátil e roupas.',
                    'Combine com a família um ponto de encontro e anote os telefones importantes em papel, caso o celular fique sem bateria.',
                    'Suba móveis e eletrodomésticos, ou ao menos as tomadas e os aparelhos mais caros, e confira se há animais de estimação que precisam de transporte.'
                ]
            },
            {
                h: 'Durante a cheia: priorize a segurança',
                list: [
                    'Saia de casa antes que a água chegue se a Defesa Civil recomendar. Bens materiais se recuperam, pessoas não.',
                    'Não atravesse ruas alagadas a pé, de moto ou de carro: a correnteza pode ser mais forte do que parece e há buracos e bueiros abertos sob a água.',
                    'Desligue a energia pelo quadro geral antes que a água alcance as tomadas, sem tocar em equipamentos molhados nem pisar em água que possa estar em contato com a rede elétrica.',
                    'Evite contato com a água da enchente. Ela pode estar contaminada por esgoto e carregar doenças, como a leptospirose, e objetos cortantes.',
                    'Cuidado com animais que se abrigam em locais secos, como cobras e escorpiões, ao mexer em entulho e móveis.',
                    'Mantenha o celular carregado e acompanhe as orientações oficiais. Evite repassar boatos: só compartilhe informações de fontes confiáveis.'
                ]
            },
            {
                h: 'Depois da cheia: volte com cuidado',
                list: [
                    'Só retorne para casa quando a Defesa Civil liberar e verifique se a estrutura está segura, sem rachaduras novas ou paredes encharcadas.',
                    'Use luvas e botas para limpar a casa. Lave e desinfete paredes, pisos e utensílios que tiveram contato com a água.',
                    'Descarte alimentos que tiveram contato com a água da enchente e trate ou ferva a água para beber, seguindo a orientação da vigilância sanitária local.',
                    'Procure atendimento médico se tiver febre, dores no corpo, diarreia ou ferimentos nos dias seguintes, e informe que esteve em contato com água de enchente.',
                    'Fotografe os danos antes de limpar e procure a Defesa Civil para saber como solicitar apoio.'
                ]
            },
            {
                h: 'O papel do CamRB',
                p: [
                    'O CamRB ajuda a acompanhar o rio: mostra a última leitura oficial, a tendência, as câmeras da região do rio e, para quem quiser, envia um e-mail quando o nível passa das cotas de atenção, alerta ou transbordamento, com fotos recentes das câmeras e um gráfico dos últimos 7 dias. Esse aviso é informativo e automático. Ele não substitui a Defesa Civil nem o SGB/CPRM.'
                ]
            }
        ],
        relacionados: ['cotas-do-rio-acre', 'cheias-e-secas-do-rio-acre', 'perguntas-frequentes']
    },

    {
        slug: 'como-o-camrb-funciona',
        titulo: 'Como o CamRB funciona: fontes, atualização e compromisso editorial',
        curto: 'Fontes e metodologia',
        descricao: 'De onde vêm as imagens e os dados do CamRB, com que frequência são atualizados, como funcionam os alertas por e-mail e como pedir correções.',
        resumo: 'Fontes dos dados e das imagens, frequência de atualização, limites do site e como pedir correções.',
        atualizado: '2026-10-31',
        intro: 'O CamRB é um projeto independente de utilidade pública, mantido de forma independente em Rio Branco. Esta página descreve de onde vêm as informações, o que o site garante e o que não garante, e como entrar em contato para corrigir um erro.',
        secoes: [
            {
                h: 'De onde vêm as informações',
                list: [
                    'Câmeras: as imagens vêm do portal público de monitoramento de trânsito da Prefeitura de Rio Branco. O CamRB reúne essas imagens num só lugar, com mapa, busca e filtros, mas não é o proprietário das câmeras.',
                    'Nível do Rio Acre: leituras da estação 13600002, publicadas pela ANA e operadas pelo SGB/CPRM.',
                    'Níveis de referência (atenção, alerta e transbordamento): definidos pelo SGB/CPRM para a estação de Rio Branco.',
                    'Médias mensais e menor nível: calculados pelo CamRB a partir da telemetria da ANA de 2021 a 2025.',
                    'Estimativa de tendência: cálculo do CamRB que combina o nível já medido nas estações a montante (Capixaba e Xapuri) com a tendência das últimas 24 horas.'
                ]
            },
            {
                h: 'Com que frequência atualiza',
                list: [
                    'O nível do rio é consultado a cada poucos minutos e guardado por até 10 minutos antes de uma nova consulta.',
                    'O histórico de dias anteriores é atualizado a cada 30 minutos.',
                    'As câmeras são verificadas continuamente; as que estão fora do ar saem da listagem de "online" automaticamente.',
                    'Cada leitura mostra o horário em que foi feita, e o site avisa quando um dado está velho.'
                ]
            },
            {
                h: 'O que o site não é',
                list: [
                    'Não é um órgão oficial nem tem vínculo com a Prefeitura, a ANA, o SGB/CPRM ou a Defesa Civil.',
                    'Não emite alertas oficiais. Os avisos por e-mail são automáticos e informativos.',
                    'Não faz previsão oficial. A estimativa de tendência é uma conta simples e pode errar, principalmente em cheias grandes e quando chove forte perto de Rio Branco, algo que ela não enxerga.',
                    'Não vende as imagens das câmeras, que pertencem à Prefeitura de Rio Branco.'
                ]
            },
            {
                h: 'A estimativa de tendência',
                p: [
                    'Para as projeções de 24 e 48 horas, o CamRB observa quanto o nível subiu ou desceu nas estações rio acima e aplica essa variação a Rio Branco, respeitando o tempo que a água leva para chegar. Num teste feito com os últimos 30 dias de dados, o erro médio foi de 0,08 m para 24 horas e de 0,17 m para 48 horas, contra 0,21 m e 0,41 m de simplesmente repetir o nível de hoje.',
                    'Esse teste cobre só um mês de seca e uma cheia pequena, e usa os mesmos dados em que o método foi ajustado, por isso o resultado é otimista. Quando as estações de montante não respondem, o site volta a uma estimativa mais simples, baseada só nas últimas 24 horas. A projeção de 7 dias é sempre marcada como de baixa confiança.'
                ]
            },
            {
                h: 'Alertas por e-mail e privacidade',
                p: [
                    'Os alertas do rio são opcionais: só chegam para quem se inscreve, confirma o e-mail por um link e escolhe os níveis que deseja receber. Todo e-mail traz um botão para cancelar. O texto completo está na seção 6 dos [Termos de Uso](/termos), que também descreve os cookies e a publicidade do Google AdSense.'
                ]
            },
            {
                h: 'Como o site se mantém',
                p: [
                    'O CamRB é gratuito. Os custos de servidor e e-mail são cobertos por anúncios exibidos em algumas páginas e por patrocínios (veja [Patrocine](/patrocine)). Os anúncios não influenciam o conteúdo, e informações de segurança, como o nível do rio, nunca ficam atrás de cadastro.'
                ]
            },
            {
                h: 'Erros e correções',
                p: [
                    'Se você encontrou um dado errado, uma câmera mal identificada ou um texto que precisa de correção, escreva pela página de [Contato](/contato) ou pelo e-mail suportecamrb@gmail.com. Correções de fato são feitas assim que confirmadas, e a data de revisão de cada guia aparece no topo da página.'
                ]
            }
        ],
        relacionados: ['como-funciona-a-estacao-do-rio-acre', 'cotas-do-rio-acre', 'perguntas-frequentes']
    },

    {
        slug: 'perguntas-frequentes',
        titulo: 'Perguntas frequentes sobre o CamRB e o Rio Acre',
        curto: 'Perguntas frequentes',
        descricao: 'Respostas sobre as câmeras de Rio Branco, o nível do Rio Acre, as cotas de alerta, os avisos por e-mail, privacidade e como o CamRB funciona.',
        resumo: 'Respostas rápidas às dúvidas mais comuns sobre as câmeras, o rio e os alertas.',
        atualizado: '2026-10-31',
        intro: 'Reunimos aqui as dúvidas mais comuns de quem usa o CamRB. Se a sua não estiver na lista, escreva pela página de [Contato](/contato).',
        faq: [
            ['O CamRB é um site oficial da Prefeitura?', 'Não. É um projeto independente. As imagens vêm do portal público de monitoramento da Prefeitura de Rio Branco, e os dados do rio vêm da ANA e do SGB/CPRM, mas o site não tem vínculo com esses órgãos.'],
            ['As câmeras mostram imagens ao vivo?', 'Sim, na medida do possível. As imagens são atualizadas em intervalos curtos, mas dependem da câmera estar funcionando e da conexão da Prefeitura. Quando uma câmera cai, ela sai da lista de câmeras online.'],
            ['Por que algumas câmeras aparecem fora do ar?', 'Câmeras de rua dependem de energia, internet e manutenção. O CamRB verifica o estado delas continuamente e mostra o resultado; não é possível consertá-las pelo site.'],
            ['De onde vem o nível do Rio Acre?', 'De uma estação telemétrica da ANA em Rio Branco (código 13600002), operada pelo SGB/CPRM. O site mostra a leitura mais recente com o horário em que foi feita. Veja o guia [Como funciona a estação](/guias/como-funciona-a-estacao-do-rio-acre).'],
            ['O que significa cota?', 'É o nível da água lido na régua da estação, contado a partir de um zero próprio dela. Não é a altura da água na rua nem na sua casa. Explicamos no guia [Cotas do Rio Acre](/guias/cotas-do-rio-acre).'],
            ['Quais são as cotas de atenção, alerta e transbordamento?', 'Em Rio Branco, 12,50 m, 13,50 m e 14,00 m, respectivamente, segundo as referências do SGB/CPRM.'],
            ['O nível que o site mostra está atualizado?', 'Cada leitura traz o horário. Se tiver mais de duas horas, ou se a ANA estiver fora do ar, o site marca o dado como desatualizado. Nunca mostramos um valor inventado.'],
            ['A previsão do site é confiável?', 'Ela é uma estimativa e não uma previsão oficial. Para 24 e 48 horas usa o nível já medido nas estações rio acima, e o teste com dados recentes mostrou erro médio de 0,08 m e 0,17 m, mas só em época de seca. Para 7 dias, a confiança é baixa. Decisões de segurança devem seguir a Defesa Civil (199).'],
            ['Como recebo alertas do rio por e-mail?', 'Na página [Nível do Rio Acre](/rio), informe seu e-mail, escolha os níveis (atenção, alerta, transbordamento) e confirme pelo link que enviamos. É opcional e gratuito, e todo e-mail traz um botão para cancelar.'],
            ['O que vem no e-mail de alerta?', 'O nível no momento do aviso, fotos recentes das câmeras do rio que estão online e um gráfico com a evolução dos últimos 7 dias.'],
            ['Vocês guardam meus dados?', 'Só o necessário: e-mail e preferências de quem se inscreve ou cria conta, e métricas de uso sem identificação pessoal para melhorar o site. Os detalhes estão nos [Termos de Uso](/termos).'],
            ['Por que o site tem anúncios?', 'Para pagar servidor, e-mail e manutenção sem cobrar dos usuários. Os anúncios não mudam as informações do rio nem das câmeras.'],
            ['Posso usar as imagens ou o gráfico em outro site?', 'As câmeras pertencem à Prefeitura de Rio Branco. Para o uso de imagens e dados em matérias, fale com o CamRB pela página de [Contato](/contato) e cite sempre a fonte original.'],
            ['Encontrei um erro. Como aviso?', 'Escreva pela página de [Contato](/contato) ou para suportecamrb@gmail.com. Corrigimos o que for confirmado.']
        ],
        relacionados: ['cotas-do-rio-acre', 'o-que-fazer-em-uma-cheia', 'como-o-camrb-funciona']
    }
];

module.exports = { GUIAS };
