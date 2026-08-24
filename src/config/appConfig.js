const parseInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'camerasriobranco.com.br';

module.exports = {
    PORT: parseInteger(process.env.PORT, 3001),
    SITE_DOMAIN,
    SITE_BASE_URL: process.env.SITE_BASE_URL || `https://${SITE_DOMAIN}`,
    UPDATE_INTERVAL_MS: parseInteger(process.env.UPDATE_INTERVAL_MS, 1 * 60 * 1000),
    CONCURRENCY_LIMIT: parseInteger(process.env.CONCURRENCY_LIMIT, 20),
    CAMERA_CODE_START: parseInteger(process.env.CAMERA_CODE_START, 1000),
    CAMERA_CODE_END: parseInteger(process.env.CAMERA_CODE_END, 1700),
    REQUEST_TIMEOUT: parseInteger(process.env.REQUEST_TIMEOUT, 8000),
    MIN_IMAGE_SIZE_KB: parseInteger(process.env.MIN_IMAGE_SIZE_KB, 22),
    SCAN_TIMEOUT_MS: parseInteger(process.env.SCAN_TIMEOUT_MS, 420 * 1000),
    SCAN_RETRY_DELAY_MS: parseInteger(process.env.SCAN_RETRY_DELAY_MS, 120 * 1000),
    JSON_BODY_LIMIT: process.env.JSON_BODY_LIMIT || '250kb',
    TARPIT_DELAY_MS: parseInteger(process.env.TARPIT_DELAY_MS, 30 * 1000)
};
