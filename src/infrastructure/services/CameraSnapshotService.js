const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OFFLINE_PLACEHOLDER_BYTES = 20500; // tamanho da imagem "câmera fora do ar" da prefeitura (mesma regra do proxy)
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * CameraSnapshotService — tira uma foto das câmeras do rio e guarda o arquivo para usar nos e-mails de alerta.
 *
 * - Só entram câmeras ONLINE: se uma estiver fora do ar, fica de fora do e-mail (nunca vai imagem de erro).
 * - A foto é guardada com um endereço próprio, então todo mundo vê a imagem do momento do alerta
 *   (um link "ao vivo" aberto dias depois mostraria o rio de outro dia).
 * - Fotos antigas são apagadas pela rotina `cleanup`.
 */
class CameraSnapshotService {
    /**
     * @param {object} deps
     * @param {{ get: Function }} deps.http                axios (ou equivalente)
     * @param {{ getCached: Function }} [deps.cameraRepo]  para saber se a câmera está online e seu nome
     * @param {string[]} deps.codes                        câmeras do rio, em ordem de exibição
     * @param {string} deps.baseUrl                        endereço público do site
     * @param {string} deps.dir                            pasta onde as fotos ficam (servida em /uploads/alertas)
     */
    constructor({ http, cameraRepo, codes, baseUrl, dir, minKb = 25, timeoutMs = 6000, maxBytes = 1.5 * 1024 * 1024, now, fsp }) {
        this._http = http;
        this._repo = cameraRepo;
        this._codes = (codes || []).map(String);
        this._baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this._dir = dir;
        this._minBytes = minKb * 1024;
        this._timeoutMs = timeoutMs;
        this._maxBytes = maxBytes;
        this._now = now || (() => Date.now());
        this._fs = fsp || fs.promises;
    }

    _camera(code) {
        let cam = null;
        try {
            cam = this._repo && this._repo.getCached ? this._repo.getCached().find((c) => String(c.codigo) === code) : null;
        } catch (_) { /* sem cache: tenta mesmo assim */ }
        return cam ? { known: true, online: cam.status === 'online', name: cam.nome } : { known: false };
    }

    /**
     * @param {string} [tag]  só para identificar o arquivo (ex.: id do evento)
     * @returns {Promise<{ images: Array<{code,name,url,takenAt,file}>, skipped: Array<{code,name,reason}> }>}
     */
    async capture(tag = 'alerta') {
        const results = await Promise.all(this._codes.map((code) => this._one(code, tag)));
        return {
            images: results.filter((r) => r.image).map((r) => r.image),
            skipped: results.filter((r) => !r.image).map((r) => ({ code: r.code, name: r.name, reason: r.reason }))
        };
    }

    async _one(code, tag) {
        const cam = this._camera(code);
        const name = cam.name || `Câmera ${code}`;
        if (cam.known && !cam.online) return { code, name, reason: 'offline' };

        try {
            const response = await this._http.get(`https://cameras.riobranco.ac.gov.br/api/camera?code=${code}&timestamp=${this._now()}`, {
                responseType: 'arraybuffer',
                timeout: this._timeoutMs,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://deolhonotransito.riobranco.ac.gov.br',
                    'Origin': 'https://deolhonotransito.riobranco.ac.gov.br',
                    'Accept': 'image/jpeg,image/webp,image/*,*/*'
                }
            });

            const buffer = Buffer.from(response.data || []);
            const mime = String((response.headers && response.headers['content-type']) || 'image/jpeg').split(';')[0].trim().toLowerCase();
            const ext = EXT_BY_MIME[mime];
            if (!ext) return { code, name, reason: 'sem imagem' };
            if (buffer.length < this._minBytes || buffer.length === OFFLINE_PLACEHOLDER_BYTES) return { code, name, reason: 'sem imagem' };
            if (buffer.length > this._maxBytes) return { code, name, reason: 'imagem grande demais' };

            const stamp = new Date(this._now()).toISOString().replace(/[-:T]/g, '').slice(0, 12);
            const safeTag = String(tag).replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'alerta';
            const file = `rio-${safeTag}-${code}-${stamp}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
            await this._fs.mkdir(this._dir, { recursive: true });
            await this._fs.writeFile(path.join(this._dir, file), buffer);

            return { code, name, image: { code, name, url: `${this._baseUrl}/uploads/alertas/${file}`, takenAt: this._now(), file } };
        } catch (error) {
            return { code, name, reason: 'falha ao obter' };
        }
    }

    /** Apaga fotos de alertas com mais de `maxAgeDays` dias. @returns {Promise<number>} quantas apagou */
    async cleanup(maxAgeDays = 30) {
        let removed = 0;
        let files;
        try {
            files = await this._fs.readdir(this._dir);
        } catch (_) {
            return 0; // pasta ainda não existe
        }
        const limit = this._now() - maxAgeDays * 24 * 3600 * 1000;
        for (const file of files) {
            if (!/^rio-.+\.(jpg|png|webp)$/.test(file)) continue; // só mexe nos arquivos que este serviço criou
            try {
                const full = path.join(this._dir, file);
                const stat = await this._fs.stat(full);
                if (stat.mtimeMs < limit) {
                    await this._fs.unlink(full);
                    removed++;
                }
            } catch (_) { /* arquivo sumiu: ignora */ }
        }
        return removed;
    }
}

module.exports = CameraSnapshotService;
