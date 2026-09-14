const axios = require('axios');
const sharp = require('sharp');

/**
 * @service ContactSheetService
 * Monta um mosaico/contact-sheet JPEG contendo as imagens reais de todas as câmeras online.
 * 
 * Características:
 * - Concorrência restrita (máximo 4 downloads paralelos)
 * - Timeout por câmera (3500ms)
 * - Resiliência: falha em uma câmera não quebra o mosaico (renderiza tile de fallback)
 * - Redimensionamento em streaming/buffer para economia de memória
 * - Cache de 30 segundos para evitar sobrecarga no servidor
 * - Sem persistência permanente em disco (totalmente in-memory)
 */
class ContactSheetService {
    constructor() {
        this.CONCURRENCY_LIMIT = 4;
        this.TIMEOUT_MS = 3500;
        this.TILE_WIDTH = 400;
        this.IMAGE_HEIGHT = 225; // 16:9
        this.HEADER_HEIGHT = 55;
        this.TILE_HEIGHT = this.HEADER_HEIGHT + this.IMAGE_HEIGHT; // 280px
        this.COLS = 4;
        this.GAP = 12;
        this.PADDING = 24;
        this.MIN_IMAGE_SIZE_KB = 10;

        // Cache em memória
        this._cachedBuffer = null;
        this._cachedAt = 0;
        this._cacheTtlMs = 30 * 1000; // 30 segundos
        this._generatingPromise = null;
    }

    /**
     * Executa um pool concorrente controlado sobre um array de itens.
     * @param {number} limit Máximo de tarefas simultâneas
     * @param {Array} array Lista de itens
     * @param {Function} iteratorFn Função assíncrona executada para cada item
     */
    async _asyncPool(limit, array, iteratorFn) {
        const results = [];
        const executing = new Set();

        for (const item of array) {
            const promise = Promise.resolve().then(() => iteratorFn(item));
            results.push(promise);
            executing.add(promise);

            const clean = () => executing.delete(promise);
            promise.then(clean, clean);

            if (executing.size >= limit) {
                await Promise.race(executing);
            }
        }

        return Promise.all(results);
    }

    /**
     * Sanitiza texto para inserção segura em SVG.
     * @param {string} str 
     */
    _escapeXml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Baixa a imagem real da câmera diretamente da origem municipal com timeout e validação.
     * @param {object} camera 
     * @returns {Promise<Buffer>} Buffer JPEG redimensionado para 400x225
     */
    async _fetchCameraFrame(camera) {
        const url = `https://cameras.riobranco.ac.gov.br/api/camera?code=${camera.codigo}&timestamp=${Date.now()}`;
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: this.TIMEOUT_MS,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer':    'https://deolhonotransito.riobranco.ac.gov.br',
                    'Origin':     'https://deolhonotransito.riobranco.ac.gov.br',
                    'Accept':     'image/jpeg,*/*'
                }
            });

            if (Buffer.byteLength(response.data) / 1024 < this.MIN_IMAGE_SIZE_KB) {
                return this._generateOfflineFrame(camera, 'Imagem com tamanho insuficiente');
            }

            // Redimensiona imediatamente para economizar memória
            return await sharp(response.data)
                .resize(this.TILE_WIDTH, this.IMAGE_HEIGHT, { fit: 'cover', position: 'center' })
                .jpeg({ quality: 80 })
                .toBuffer();

        } catch (error) {
            const msg = error.code === 'ECONNABORTED' ? 'Tempo limite esgotado' : 'Sem sinal / Erro de conexão';
            return this._generateOfflineFrame(camera, msg);
        }
    }

    /**
     * Gera um quadro de aviso visual quando a câmera está temporariamente inacessível.
     * @param {object} camera 
     * @param {string} reason 
     * @returns {Promise<Buffer>}
     */
    async _generateOfflineFrame(camera, reason) {
        const svg = `
            <svg width="${this.TILE_WIDTH}" height="${this.IMAGE_HEIGHT}" viewBox="0 0 ${this.TILE_WIDTH} ${this.IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
                <style>
                    text { font-family: 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', Arial, sans-serif; }
                </style>
                <rect width="${this.TILE_WIDTH}" height="${this.IMAGE_HEIGHT}" fill="#1e293b"/>
                <circle cx="${this.TILE_WIDTH / 2}" cy="80" r="28" fill="#334155"/>
                <path d="M${this.TILE_WIDTH / 2 - 12} 70 L${this.TILE_WIDTH / 2 + 12} 90 M${this.TILE_WIDTH / 2 + 12} 70 L${this.TILE_WIDTH / 2 - 12} 90" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/>
                <text x="${this.TILE_WIDTH / 2}" y="130" fill="#f87171" font-size="14" font-weight="bold" text-anchor="middle">Sinal Indisponível</text>
                <text x="${this.TILE_WIDTH / 2}" y="152" fill="#94a3b8" font-size="12" text-anchor="middle">${this._escapeXml(reason)}</text>
            </svg>
        `;
        return sharp(Buffer.from(svg)).png().toBuffer();
    }

    /**
     * Cria a barra de cabeçalho informativa de cada card individual.
     * @param {object} camera 
     * @returns {Buffer} SVG buffer
     */
    _createTileHeaderSvg(camera) {
        const code = this._escapeXml(camera.codigo);
        let name = String(camera.nome || `Câmera ${camera.codigo}`).trim();
        if (name.length > 28) name = name.substring(0, 26) + '…';
        const escapedName = this._escapeXml(name);

        let coordsText = 'Sem coordenadas cadastradas';
        if (Array.isArray(camera.coords) && camera.coords.length === 2 && camera.coords[0] !== null) {
            coordsText = `Lat: ${Number(camera.coords[0]).toFixed(4)} | Lng: ${Number(camera.coords[1]).toFixed(4)}`;
        }
        const escapedCoords = this._escapeXml(coordsText);

        const svg = `
            <svg width="${this.TILE_WIDTH}" height="${this.HEADER_HEIGHT}" viewBox="0 0 ${this.TILE_WIDTH} ${this.HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
                <style>
                    .sans { font-family: 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', Arial, sans-serif; }
                    .mono { font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace; }
                </style>
                <!-- Fundo do cabeçalho -->
                <rect width="${this.TILE_WIDTH}" height="${this.HEADER_HEIGHT}" fill="#0f172a"/>
                <line x1="0" y1="${this.HEADER_HEIGHT - 1}" x2="${this.TILE_WIDTH}" y2="${this.HEADER_HEIGHT - 1}" stroke="#334155" stroke-width="1"/>

                <!-- Badge do Código -->
                <rect x="10" y="8" width="68" height="20" rx="4" fill="#1e293b" stroke="#38bdf8" stroke-width="1"/>
                <text x="44" y="22" fill="#38bdf8" font-size="11" class="mono" font-weight="bold" text-anchor="middle" dominant-baseline="central">${code}</text>

                <!-- Nome da Câmera -->
                <text x="86" y="22" fill="#f8fafc" font-size="12" class="sans" font-weight="bold" dominant-baseline="central">${escapedName}</text>

                <!-- Coordenadas Geográficas -->
                <circle cx="15" cy="41" r="3" fill="#10b981"/>
                <text x="24" y="44" fill="#94a3b8" font-size="10" class="mono">${escapedCoords}</text>
            </svg>
        `;
        return Buffer.from(svg);
    }

    /**
     * Cria a faixa de cabeçalho global do contact sheet.
     * @param {number} width 
     * @param {number} totalCameras 
     * @returns {Buffer} SVG buffer
     */
    _createGlobalHeaderSvg(width, totalCameras) {
        const height = 90;
        const now = new Date();
        const dateFormatted = now.toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' });

        const svg = `
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
                <style>
                    .sans { font-family: 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', Arial, sans-serif; }
                    .mono { font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace; }
                </style>
                <rect width="${width}" height="${height}" fill="#0f172a" rx="12"/>
                <rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#1e293b" stroke-width="2" rx="12"/>

                <!-- Logo / Título -->
                <text x="24" y="42" fill="#ffffff" font-size="20" class="sans" font-weight="900" letter-spacing="1">
                    CAMRB <tspan fill="#38bdf8">— PAINEL DE ANÁLISE VISUAL DAS CÂMERAS</tspan>
                </text>
                <text x="24" y="68" fill="#94a3b8" font-size="12" class="sans">
                    Enquadramento, referências comerciais e potenciais patrocinadores de Rio Branco - AC
                </text>

                <!-- Metadata à direita -->
                <rect x="${width - 320}" y="20" width="296" height="50" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/>
                <circle cx="${width - 302}" cy="45" r="4" fill="#10b981"/>
                <text x="${width - 290}" y="40" fill="#38bdf8" font-size="12" class="sans" font-weight="bold">
                    ${totalCameras} Câmeras Online
                </text>
                <text x="${width - 290}" y="58" fill="#94a3b8" font-size="10" class="mono">
                    Gerado: ${this._escapeXml(dateFormatted)} (Acre)
                </text>
            </svg>
        `;
        return Buffer.from(svg);
    }

    /**
     * Gera o Contact Sheet em formato JPEG contendo todas as câmeras online fornecidas.
     * @param {Array<object>} onlineCameras Lista de câmeras online
     * @param {boolean} forceRefresh Se true, ignora o cache de 30 segundos
     * @returns {Promise<Buffer>} Buffer JPEG composto
     */
    async generateContactSheet(onlineCameras, forceRefresh = false) {
        const now = Date.now();

        // Se há cache válido e recente, retorna direto
        if (!forceRefresh && this._cachedBuffer && (now - this._cachedAt < this._cacheTtlMs)) {
            return this._cachedBuffer;
        }

        // Se já está gerando no momento, aguarda a promessa existente (evita concorrência duplicada)
        if (this._generatingPromise) {
            return this._generatingPromise;
        }

        this._generatingPromise = (async () => {
            try {
                if (!onlineCameras || onlineCameras.length === 0) {
                    throw new Error('Nenhuma câmera online disponível para gerar o contact sheet.');
                }

                const total = onlineCameras.length;
                const cols = this.COLS;
                const rows = Math.ceil(total / cols);

                const globalHeaderHeight = 90;
                const sheetWidth = this.PADDING * 2 + cols * this.TILE_WIDTH + (cols - 1) * this.GAP;
                const sheetHeight = this.PADDING * 2 + globalHeaderHeight + this.GAP + rows * this.TILE_HEIGHT + (rows - 1) * this.GAP;

                // 1. Download concorrente controlado das imagens
                const downloadedFrames = await this._asyncPool(
                    this.CONCURRENCY_LIMIT,
                    onlineCameras,
                    camera => this._fetchCameraFrame(camera)
                );

                // 2. Preparar overlay de composição do Sharp
                const compositeInputs = [];

                // 2.1 Cabeçalho Global
                compositeInputs.push({
                    input: this._createGlobalHeaderSvg(sheetWidth - this.PADDING * 2, total),
                    top: this.PADDING,
                    left: this.PADDING
                });

                // 2.2 Montar cada card de câmera
                for (let i = 0; i < total; i++) {
                    const camera = onlineCameras[i];
                    const frameBuffer = downloadedFrames[i];
                    const col = i % cols;
                    const row = Math.floor(i / cols);

                    const tileX = this.PADDING + col * (this.TILE_WIDTH + this.GAP);
                    const tileY = this.PADDING + globalHeaderHeight + this.GAP + row * (this.TILE_HEIGHT + this.GAP);

                    // Cabeçalho do Card
                    const headerSvg = this._createTileHeaderSvg(camera);
                    compositeInputs.push({
                        input: headerSvg,
                        top: tileY,
                        left: tileX
                    });

                    // Imagem JPEG da Câmera
                    compositeInputs.push({
                        input: frameBuffer,
                        top: tileY + this.HEADER_HEIGHT,
                        left: tileX
                    });
                }

                // 3. Renderizar o canvas mestre com Sharp
                const finalBuffer = await sharp({
                    create: {
                        width: sheetWidth,
                        height: sheetHeight,
                        channels: 3,
                        background: { r: 11, g: 15, b: 25 } // Fundo escuro elegante (#0b0f19)
                    }
                })
                .composite(compositeInputs)
                .jpeg({ quality: 85, mozjpeg: true })
                .toBuffer();

                // Atualizar cache
                this._cachedBuffer = finalBuffer;
                this._cachedAt = Date.now();

                return finalBuffer;

            } finally {
                this._generatingPromise = null;
            }
        })();

        return this._generatingPromise;
    }
}

module.exports = ContactSheetService;
