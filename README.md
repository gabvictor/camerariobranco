<div align="center">

# 📷 CamRB — Câmeras Rio Branco

**Monitoramento em tempo real das câmeras públicas de Rio Branco, Acre.**

[![Node.js](https://img.shields.io/badge/Node.js-Express-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore-FFCA28?style=flat-square&logo=firebase&logoColor=black)](https://firebase.google.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License](https://img.shields.io/badge/Licen%C3%A7a-MIT-blue?style=flat-square)](#)

[🌐 Acessar o Site](https://camerasriobranco.com.br) · [📱 Download Android](https://github.com/gabvictor/CamRB/releases) · [🐛 Reportar Problema](https://camerasriobranco.com.br)

</div>

---

Plataforma de monitoramento de câmeras públicas de Rio Branco (AC), com frontend web, backend em Node.js/Express e integração completa com Firebase.

## 🌐 Domínio Oficial
`https://camerasriobranco.com.br`

## ✅ Melhorias implementadas nesta atualização
- Refatoração de configuração central (`appConfig`) com variáveis de ambiente e valores tipados.
- Hardenização da inicialização Firebase Admin (`FIREBASE_SERVICE_ACCOUNT_PATH`, fallback seguro, bucket configurável).
- Sanitização de entradas em endpoints críticos (`report`, `changelog`, `update-camera-info`).
- Otimização de performance no cache de câmeras (de O(n²) para O(n) por atualização).
- CORS restritivo com allowlist de domínio oficial + localhost.
- Limite de payload JSON configurável (`JSON_BODY_LIMIT`).
- Mitigação de XSS no frontend (escape em dados dinâmicos de câmera/comentários).
- Scripts cross-platform para Tailwind (`npx @tailwindcss/cli`).
- Script automatizado de teste Firebase (`npm run test:firebase`) para Auth, Firestore e Storage.
- Migração de todas as referências do domínio antigo para `camerasriobranco.com.br`.

---

## 📋 Sobre o Projeto

O **CamRB** é uma plataforma web que agrega e exibe em tempo real as câmeras de monitoramento público de Rio Branco — AC, disponibilizadas pela Prefeitura Municipal. O objetivo é democratizar o acesso à informação de trânsito e segurança urbana.

**Funcionalidades principais:**
- 🔴 **Visualização ao vivo** — Feed de imagem atualizado automaticamente
- 🗺️ **Mapa interativo** — Localiza câmeras online em um mapa de Rio Branco
- ⭐ **Favoritos** — Salve câmeras preferidas (requer login)
- 🔔 **Novidades** — Pop-up de changelog com atualizações do sistema
- 📱 **App Android** — APK disponível para instalação direta
- 👤 **Perfil de usuário** — Login via Firebase Authentication
- 🔒 **Painel Admin** — Gerenciamento de câmeras, reportes, comentários e métricas
- 🌙 **Tema claro/escuro** — Preferência salva localmente

---

## 🏗️ Arquitetura

O backend segue os princípios da **Clean Architecture** com aplicação de **Design Patterns** consagrados (Repository, Strategy, Factory, Observer, Use Case).

```text
src/
├── domain/                        ← Núcleo puro (sem dependências externas)
│   ├── entities/
│   │   ├── Camera.js              ← Entidade com regras de negócio
│   │   └── Report.js              ← Entidade de reporte com validação de status
│   └── contracts/
│       ├── ICameraRepository.js   ← Contrato Repository (Dependency Inversion)
│       ├── IReportRepository.js
│       └── IScannerService.js     ← Contrato Strategy para scanners
│
├── application/                   ← Casos de uso e serviços da aplicação
│   ├── services/
│   │   ├── MetricsService.js      ← Estado de métricas em memória (SRP)
│   │   └── CameraCache.js         ← Cache de status de câmeras
│   └── use-cases/
│       ├── ScanCamerasUseCase.js  ← Orquestra varredura via Strategy
│       ├── GetDashboardDataUseCase.js
│       ├── CreateReportUseCase.js
│       └── TrackVisitUseCase.js
│
├── infrastructure/                ← Implementações concretas de I/O
│   ├── database/
│   │   ├── FirebaseCameraRepository.js  ← Implementa ICameraRepository
│   │   └── FirebaseReportRepository.js
│   ├── scanner/
│   │   ├── PrefeituraScanner.js   ← Strategy: API da Prefeitura de RB
│   │   └── ScannerFactory.js      ← Factory Pattern
│   └── scheduler/
│       └── ScanScheduler.js       ← Observer (EventEmitter): emite scan:complete
│
├── presentation/                  ← Camada HTTP (Express)
│   └── http/
│       ├── controllers/
│       │   ├── CameraController.js
│       │   ├── ReportController.js
│       │   └── DashboardController.js
│       └── routes/
│           ├── cameraRoutes.js
│           └── adminRoutes.js
│
├── config/
│   ├── firebaseAdmin.js           ← Singleton do Firebase Admin SDK
│   └── appConfig.js               ← Constantes globais
├── middlewares/
│   └── security.js                ← Tarpit, verifyAdmin, requestLogger
└── utils/                         ← Sanitização/validação
```

### Design Patterns Aplicados

| Padrão | Onde | Benefício |
|--------|------|-----------|
| **Repository** | `FirebaseCameraRepository` | Desacoplamento do Firestore — trocar banco sem afetar regras |
| **Strategy** | `PrefeituraScanner` / `IScannerService` | Adicionar nova fonte sem modificar código existente |
| **Factory** | `ScannerFactory` | Seleciona implementação via `SCANNER_SOURCE` env var |
| **Observer** | `ScanScheduler` → `CameraCache` | Cache e métricas reagem a eventos sem acoplamento |
| **Use Case** | `GetDashboardDataUseCase` | Lógica de negócio testável sem servidor HTTP |
| **Singleton** | `FirebaseAdmin` | Inicialização única do SDK garantida pelo Node.js |
| **Facade** | `server.js` | Bootstrap declarativo que conecta todas as camadas |

---

## 🛠️ Stack Tecnológica

### Backend
| Tecnologia | Versão | Uso |
|-----------|--------|-----|
| **Node.js** + **Express** | v5 | Servidor HTTP |
| **Firebase Admin SDK** | v13 | Acesso ao Firestore no servidor |
| **Axios** | v1 | Proxy para a API de câmeras |
| **Helmet** | v8 | Headers de segurança HTTP |
| **CORS** | v2 | Controle de origens |
| **Nodemon** | v3 | Hot-reload em desenvolvimento |

### Frontend
| Tecnologia | Uso |
|-----------|-----|
| **HTML + Vanilla JS** | Páginas estáticas |
| **Tailwind CSS v4** (build local) | Estilização — sem CDN |
| **Firebase JS SDK** | Autenticação e Firestore client-side |
| **Leaflet.js** | Mapa interativo |
| **Lucide Icons** | Ícones vetoriais |
| **Chart.js** | Gráficos no dashboard |

### Infraestrutura
| Serviço | Uso |
|---------|-----|
| **Firebase Firestore** | Banco de dados (câmeras, usuários, reportes, changelog) |
| **Firebase Authentication** | Login de usuários |
| **Google Analytics (GA4)** | Métricas de audiência |

---

## 🚀 Execução Local

### Pré-requisitos
- Node.js 18+
- Conta no Firebase com projeto configurado
- Chave de serviço do Firebase Admin (`serviceAccountKey.json`)

### Instalação

```bash
# Instale as dependências
npm install

# Coloque sua chave do Firebase na raiz do projeto
# (obtenha em: Firebase Console > Configurações do projeto > Contas de serviço)
# renomeie para: serviceAccountKey.json
```

### CSS (Tailwind Build)

O projeto usa Tailwind CSS com **build local** (sem CDN). Sempre que adicionar novas classes, recompile:

```bash
# Gerar output.css minificado (produção)
npm run build:css

# Monitorar mudanças durante o desenvolvimento
npm run watch:css
```

### Iniciar o Servidor

```bash
# Desenvolvimento (hot-reload via nodemon)
npm run dev

# Produção
npm start
```

O servidor estará disponível em `http://localhost:3001`.

---

## 🐳 Execução com Docker

O projeto inclui suporte completo a contêineres com **Multi-Stage Build** (Node.js 20 Alpine, compilação automática do Tailwind CSS, fuso horário `America/Rio_Branco`, usuário não-root e healthcheck integrado).

### 1. Pré-requisitos
- Docker & Docker Compose instalados
- Chave `serviceAccountKey.json` na raiz do projeto

### 2. Subir a aplicação com Docker Compose

```bash
# Subir os containers em segundo plano (com build automático)
docker compose up -d --build

# Acompanhar logs da aplicação em tempo real
docker compose logs -f

# Verificar status e healthcheck
docker compose ps

# Parar a aplicação
docker compose down
```

### 3. Build & Execução manual da Imagem Docker

```bash
# Build da imagem de produção
docker build -t camrb:latest .

# Executar container montando as credenciais e volume do timelapse
docker run -d \
  --name camrb-server \
  -p 3001:3001 \
  -v "$(pwd)/serviceAccountKey.json:/app/serviceAccountKey.json:ro" \
  -v "$(pwd)/public/timelapse:/app/public/timelapse" \
  camrb:latest
```

---

## 🧪 Testes Firebase
```bash
npm run test:firebase
```
Gera `firebase-test-report.json` com resultado detalhado de:
- Firebase Authentication
- Cloud Firestore
- Firebase Storage

---

## ⚙️ Variáveis de Ambiente

Crie um arquivo `.env` na raiz:

```env
PORT=3001
SITE_DOMAIN=camerasriobranco.com.br
SITE_BASE_URL=https://camerasriobranco.com.br
ADMIN_EMAIL=seu-admin@dominio.com
FIREBASE_STORAGE_BUCKET=camerasriobranco.firebasestorage.app
SCANNER_SOURCE=prefeitura
```

---

## 📡 Endpoints da API

### Públicos
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/status-cameras` | Lista câmeras com status (filtra level 3 para não-admins) |
| `GET` | `/camera/:code` | Página SSR de uma câmera (com meta tags dinâmicas) |
| `GET` | `/proxy/camera/:code` | Proxy de imagem da câmera |
| `GET` | `/health` | Status do servidor e métricas de runtime |
| `GET` | `/api/sync-info` | Informações sobre próxima varredura |
| `GET` | `/api/site-config` | Configurações públicas do site |
| `GET` | `/api/traffic` | Contadores de visitas |
| `POST`| `/api/track-visit` | Registra uma visita |
| `POST`| `/api/report` | Envia reporte de problema em câmera |
| `GET` | `/sitemap.xml` | Sitemap dinâmico |

### Administrativos (requer token Bearer)
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/reports` | Lista todos os reportes |
| `PUT` | `/api/report/:id/status` | Atualiza status de um reporte |
| `DELETE` | `/api/report/:id` | Remove um reporte |
| `GET` | `/api/comments` | Lista todos os comentários |
| `DELETE` | `/api/comment/:cameraId/:id` | Remove um comentário |
| `POST` | `/api/changelog` | Publica uma novidade |
| `POST` | `/api/site-config` | Atualiza configurações do site |
| `POST` | `/api/update-camera-info` | Atualiza dados de uma câmera |
| `GET` | `/api/dashboard-data` | Dados agregados do painel |
| `GET` | `/api/simple-metrics` | Métricas de runtime em memória |

---

## 🔒 Segurança

- **Tarpit anti-bot** — Rotas de ataque comuns (`/.env`, `/wp-admin`, `.php`) travam a conexão por 30 segundos (ou configurável via `TARPIT_DELAY_MS`) e retornam HTTP 418 com imagem de gatinho.
- **Firestore Rules** — Regras granulares em `firestore.rules` controlam leitura/escrita por usuário autenticado.
- **Helmet** — Headers de segurança em todas as respostas.
- **Câmeras Level 3** — Câmeras restritas só são acessadas com token de admin válido no proxy.
- **Sanitização de Inputs** — Proteção robusta contra XSS e injeções no backend e escape de dados dinâmicos no frontend.

---

## 🤝 Contribuindo

1. Fork o repositório
2. Crie sua branch: `git checkout -b feature/minha-feature`
3. Commit suas mudanças: `git commit -m 'feat: adiciona funcionalidade X'`
4. Push para a branch: `git push origin feature/minha-feature`
5. Abra um Pull Request

---

## 📄 Licença

Este projeto está licenciado sob os termos da licença MIT.
