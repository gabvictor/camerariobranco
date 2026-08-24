# Deploy e Configuração — CamRB

## Requisitos
- Node.js 18+
- Projeto Firebase configurado
- `serviceAccountKey.json` válido na raiz **ou** variável `FIREBASE_SERVICE_ACCOUNT_PATH`

## Variáveis de ambiente recomendadas
```env
PORT=3001
SITE_DOMAIN=camerasriobranco.com.br
SITE_BASE_URL=https://camerasriobranco.com.br
ADMIN_EMAIL=seu-admin@dominio.com
SCANNER_SOURCE=prefeitura
FIREBASE_STORAGE_BUCKET=camerasriobranco.firebasestorage.app
```

## Deploy (passo a passo)
1. Instale dependências: `npm install`
2. Compile CSS: `npm run build:css`
3. Valide Firebase: `npm run test:firebase`
4. Suba em produção: `npm start`

## Healthcheck
- Endpoint: `GET /health`
- Endpoint de varredura: `GET /api/sync-info`

## Segurança operacional
- **Nunca** versionar `serviceAccountKey.json`
- Restrinja CORS para o domínio oficial
- Use segredos do provedor de hospedagem (`/etc/secrets/...`) em produção
