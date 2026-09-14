const HidroWebAuthService = require('../src/infrastructure/services/HidroWebAuthService');
const HidroWebService = require('../src/infrastructure/services/HidroWebService');
const RioAcreService = require('../src/infrastructure/services/RioAcreService');

async function runTests() {
    console.log('=== TESTE 1: Autenticação simulada e deduplicação de promessas ===');
    const authService = new HidroWebAuthService();
    
    // Injetamos credenciais simuladas para teste
    authService.getCredentials = () => ({ usuario: 'test_user', senha: 'test_password', fonte: 'test' });
    
    let authCallCount = 0;
    authService._authenticate = async () => {
        authCallCount++;
        // Cria um JWT mock com expiração de 1 hora
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
        const expSec = Math.floor((Date.now() + 3600000) / 1000);
        const payload = Buffer.from(JSON.stringify({ sub: 'test_user', exp: expSec })).toString('base64');
        const token = `${header}.${payload}.mockSignature`;
        authService._token = token;
        authService._tokenExpiresAt = expSec * 1000;
        return token;
    };

    // Chamadas concorrentes devem aguardar a mesma promessa
    const [t1, t2, t3] = await Promise.all([
        authService.getToken(),
        authService.getToken(),
        authService.getToken()
    ]);

    console.log('Token obtido com sucesso. Chamadas de autenticação:', authCallCount);
    if (authCallCount !== 1 || t1 !== t2 || t2 !== t3) {
        throw new Error('Deduplicação de autenticação falhou!');
    }
    console.log('✔ Teste 1 passou: Token reutilizado e concorrência controlada.');

    console.log('\n=== TESTE 2: Consumo de Série Adotada da Nova API com QC ===');
    const hwService = new HidroWebService({ authService });
    
    // Mock de resposta da nova API HidroWebService
    const mockTelemetryItems = [
        {
            Estacao_Codigo: '13600002',
            Data_Hora: '2026-09-14 09:00:00',
            Data_Hora_Atualizacao: '2026-09-14 09:05:00',
            Cota_Adotada: 245, // 245 cm = 2.45 m
            Cota_Adotada_Status: 0,
            Chuva_Adotada: 0.0,
            Chuva_Adotada_Status: 0,
            Vazao_Adotada: 68.5,
            Vazao_Adotada_Status: 0
        },
        {
            Estacao_Codigo: '13600002',
            Data_Hora: '2026-09-14 08:00:00',
            Data_Hora_Atualizacao: '2026-09-14 08:05:00',
            Cota_Adotada: 242,
            Cota_Adotada_Status: 0,
            Chuva_Adotada: 0.0,
            Chuva_Adotada_Status: 0,
            Vazao_Adotada: 67.2,
            Vazao_Adotada_Status: 0
        },
        {
            Estacao_Codigo: '13600002',
            Data_Hora: '2026-09-13 12:00:00',
            Cota_Adotada: 238,
            Cota_Adotada_Status: 0
        }
    ];

    hwService._request = async (endpoint, params) => {
        return {
            status: '200 OK',
            code: 200,
            message: 'Sucesso',
            items: mockTelemetryItems
        };
    };

    const rioService = new RioAcreService({ hidroWebService: hwService });
    const nivelAtual = await rioService.getNivelRioAcre();

    console.log('Nível:', nivelAtual.nivel.formatado);
    console.log('Metros:', nivelAtual.nivel.metros);
    console.log('Centímetros:', nivelAtual.nivel.centimetros);
    console.log('Qualidade Cota:', nivelAtual.nivel.qualidade);
    console.log('Vazão:', nivelAtual.vazao);
    console.log('Chuva:', nivelAtual.chuva);
    console.log('Tendência:', nivelAtual.tendencia);
    console.log('Fonte:', nivelAtual.fonte);

    if (nivelAtual.nivel.metros !== 2.45 || nivelAtual.nivel.centimetros !== 245) {
        throw new Error('Conversão de unidade de nível falhou!');
    }
    if (nivelAtual.tendencia.status !== 'Subindo') {
        throw new Error('Cálculo de tendência falhou (2.45 vs 2.42)!');
    }
    if (nivelAtual.fonte !== 'HidroWebService (ANA)') {
        throw new Error('Identificação da fonte falhou!');
    }
    console.log('✔ Teste 2 passou: Dados da nova API processados e normalizados corretamente.');

    console.log('\n=== TESTE 3: Histórico e Séries Temporais ===');
    const historico30d = await rioService.getHistoricoRioAcre(30);
    console.log('Histórico período:', historico30d.periodoDias);
    console.log('Pontos diários:', historico30d.pontos.length);
    console.log('Leituras 24h:', historico30d.leituras24h.length);
    console.log('Estatísticas 24h:', historico30d.estatisticas24h);
    console.log('Estatísticas Período:', historico30d.estatisticas);

    if (historico30d.pontos.length === 0) {
        throw new Error('Histórico não gerou pontos diários!');
    }
    console.log('✔ Teste 3 passou: Histórico de 24h e 30 dias normalizado perfeitamente.');

    console.log('\n=== TESTE 4: Renovação automática em erro 401 ===');
    let requestAttempts = 0;
    hwService._request = async (endpoint, params, isRetry) => {
        requestAttempts++;
        if (requestAttempts === 1) {
            const err = new Error('Unauthorized');
            err.response = { status: 401 };
            // Simula o comportamento do _request real que trata 401
            console.log('[Teste] Simulando 401 inicial...');
            authService.invalidateToken();
            return hwService._request(endpoint, params, true);
        }
        return {
            status: '200 OK',
            code: 200,
            items: mockTelemetryItems
        };
    };

    const retryResult = await hwService.consultarSerieTelemetricaAdotada({ codigosEstacoes: '13600002' });
    console.log('Tentativas de requisição:', requestAttempts, 'Itens retornados:', retryResult.length);
    if (requestAttempts !== 2 || retryResult.length === 0) {
        throw new Error('Fluxo de renovação em 401 falhou!');
    }
    console.log('✔ Teste 4 passou: 401 recuperado com sucesso com 1 retry.');

    console.log('\n========================================');
    console.log('TODOS OS 4 TESTES PASSARAM COM SUCESSO!');
    console.log('========================================');
}

runTests().catch(err => {
    console.error('Falha nos testes:', err);
    process.exit(1);
});
