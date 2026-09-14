const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const { admin } = require('../../config/firebaseAdmin');

/**
 * @service SponsorLogoUploadService
 * Processamento e armazenamento seguro de logotipos comerciais.
 */
class SponsorLogoUploadService {
    constructor(uploadsDir) {
        this.uploadsDir = uploadsDir || path.join(process.cwd(), 'public', 'uploads', 'sponsors');
        this.MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3MB
        this._ensureUploadsDir();
    }

    _ensureUploadsDir() {
        if (!fs.existsSync(this.uploadsDir)) {
            fs.mkdirSync(this.uploadsDir, { recursive: true });
        }
    }

    /**
     * Processa e armazena imagem a partir de Base64 ou Buffer.
     * @param {string|Buffer} input - Base64 Data URL ou Buffer binário
     * @param {string} [sponsorId]
     * @returns {Promise<{ url: string, fileName: string }>}
     */
    async processAndSaveLogo(input, sponsorId = 'sponsor') {
        this._ensureUploadsDir();

        let imageBuffer;
        if (typeof input === 'string') {
            const matches = input.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                imageBuffer = Buffer.from(matches[2], 'base64');
            } else {
                imageBuffer = Buffer.from(input, 'base64');
            }
        } else if (Buffer.isBuffer(input)) {
            imageBuffer = input;
        } else {
            throw new Error('Formato de entrada inválido para logotipo.');
        }

        if (imageBuffer.length > this.MAX_FILE_SIZE_BYTES) {
            throw new Error('O arquivo excede o limite máximo permitido de 3MB.');
        }

        const safeSponsorSlug = String(sponsorId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30) || 'sponsor';
        const randomHash = crypto.randomBytes(4).toString('hex');
        const fileName = `logo-${safeSponsorSlug}-${Date.now()}-${randomHash}.webp`;
        const localFilePath = path.join(this.uploadsDir, fileName);

        // Otimização de imagem com Sharp:
        // - Converte para WebP
        // - Preserva transparência
        // - Redimensiona para limites máximos sem esticar
        // - Limpa metadados EXIF
        const optimizedBuffer = await sharp(imageBuffer)
            .resize(600, 300, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({ quality: 85, alphaQuality: 90 })
            .toBuffer();

        // 1. Salva localmente em disco (para entrega estática rápida)
        fs.writeFileSync(localFilePath, optimizedBuffer);
        const publicLocalUrl = `/uploads/sponsors/${fileName}`;

        // 2. Tenta fazer upload opcional no Firebase Storage se bucket estiver configurado
        try {
            const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
            if (bucketName && admin.storage) {
                const bucket = admin.storage().bucket(bucketName);
                const destination = `sponsors/logos/${fileName}`;
                await bucket.file(destination).save(optimizedBuffer, {
                    contentType: 'image/webp',
                    metadata: {
                        cacheControl: 'public, max-age=86400, s-maxage=86400'
                    }
                });
            }
        } catch (storageErr) {
            console.warn('[STORAGE_OPTIONAL_WARN] Logotipo salvo localmente, falha no upload para bucket:', storageErr.message);
        }

        return {
            url: publicLocalUrl,
            fileName
        };
    }
}

module.exports = SponsorLogoUploadService;
