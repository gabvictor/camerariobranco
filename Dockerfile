# ─── Stage 1: Build (CSS & Dependências) ──────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Instala dependências de compilação
COPY package*.json ./
RUN npm ci

# Copia código fonte para build de assets
COPY . .

# Compila o Tailwind CSS minificado
RUN npm run build:css

# ─── Stage 2: Produção (Imagem Enxuta e Segura) ──────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Instala tzdata e fontes do sistema para renderização gráfica perfeita com Sharp/librsvg
RUN apk add --no-cache tzdata fontconfig ttf-dejavu font-noto font-liberation && fc-cache -f
ENV TZ=America/Rio_Branco \
    NODE_ENV=production \
    PORT=3001

# Instala apenas dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Cria diretório de persistência e prepara permissões
RUN mkdir -p /app/public/timelapse /app/public/uploads/sponsors && chown -R node:node /app

# Copia código da aplicação e CSS compilado do builder
COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/server.js ./server.js

# Executa com usuário não-root por segurança
USER node

EXPOSE 3001

# Healthcheck para monitorar integridade do container
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/health || exit 1

CMD ["node", "server.js"]
