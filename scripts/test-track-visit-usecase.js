/**
 * End-to-end test for TrackVisitUseCase logic with a mock/real Firestore db.
 */
const TrackVisitUseCase = require('../src/application/use-cases/TrackVisitUseCase');

// Mock db for testing usecase flow in isolation without hitting live DB in tests
const storage = {
    stats: {},
    daily: {},
    recent: []
};

const mockDb = {
    collection(colName) {
        if (colName === 'stats') {
            return {
                doc(docName) {
                    return {
                        collection(subColName) {
                            if (subColName === 'daily') {
                                return {
                                    doc(dayStr) {
                                        return {
                                            async set(data, opts) {
                                                storage.daily[dayStr] = { ...(storage.daily[dayStr] || {}), ...data };
                                            },
                                            async get() {
                                                return {
                                                    exists: !!storage.daily[dayStr],
                                                    data: () => storage.daily[dayStr] || {}
                                                };
                                            }
                                        };
                                    }
                                };
                            } else if (subColName === 'recent_visits') {
                                return {
                                    async add(data) {
                                        storage.recent.unshift(data);
                                    },
                                    orderBy() {
                                        return {
                                            limit(n) {
                                                return {
                                                    async get() {
                                                        return {
                                                            docs: storage.recent.slice(0, n).map((item, idx) => ({
                                                                id: `rec_${idx}`,
                                                                data: () => item
                                                            }))
                                                        };
                                                    }
                                                };
                                            },
                                            offset() {
                                                return {
                                                    limit() {
                                                        return {
                                                            async get() {
                                                                return { empty: true, docs: [] };
                                                            }
                                                        };
                                                    }
                                                };
                                            }
                                        };
                                    }
                                };
                            }
                        },
                        async set(data, opts) {
                            storage.stats[docName] = { ...(storage.stats[docName] || {}), ...data };
                        },
                        async get() {
                            return {
                                exists: !!storage.stats[docName],
                                data: () => storage.stats[docName] || {}
                            };
                        }
                    };
                }
            };
        }
    },
    batch() {
        return {
            delete() {},
            async commit() {}
        };
    }
};

async function run() {
    console.log('🧪 Testando TrackVisitUseCase com diferentes perfis de tráfego...\n');

    const trackUseCase = new TrackVisitUseCase(mockDb);

    // 1. Visita vinda do Instagram
    const visit1 = await trackUseCase.execute({
        referrer: 'https://l.instagram.com/',
        path: '/camera?id=01',
        ip: '177.136.24.55',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1',
        screenWidth: 390
    });
    console.log('  ✅ Visita 1 (Instagram Mobile):', visit1.source, '→', visit1.city, '→', visit1.device);

    // 2. Visita vinda do Google
    const visit2 = await trackUseCase.execute({
        referrer: 'https://www.google.com.br/',
        path: '/rio.html',
        ip: '189.45.12.34',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        screenWidth: 1920
    });
    console.log('  ✅ Visita 2 (Google Desktop):', visit2.source, '→', visit2.city, '→', visit2.device);

    // 3. Visita direta
    const visit3 = await trackUseCase.execute({
        referrer: '',
        path: '/',
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
        screenWidth: 412
    });
    console.log('  ✅ Visita 3 (Acesso Direto Local):', visit3.source, '→', visit3.city, '→', visit3.device);

    // 4. Teste de getStats()
    const stats = await trackUseCase.getStats();
    console.log('\n📊 getStats() executado com sucesso:');
    console.log('  - Total de registros recentes:', stats.recentVisits.length);
    console.log('  - Primeiro registro recente:', stats.recentVisits[0]?.source, stats.recentVisits[0]?.device);

    if (stats.recentVisits.length === 3) {
        console.log('\n🎉 Todos os testes de integração do TrackVisitUseCase passaram com sucesso!');
    } else {
        throw new Error('Falha no número de registros');
    }
}

run().catch(err => {
    console.error('❌ Erro no teste:', err);
    process.exit(1);
});
