const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sanitizeString = (value, { maxLength = 255, fallback = '' } = {}) => {
    if (typeof value !== 'string') return fallback;
    return value.trim().slice(0, maxLength);
};

const sanitizeMultiline = (value, { maxLength = 1000, fallback = '' } = {}) => {
    if (typeof value !== 'string') return fallback;
    return value
        .replace(/\r\n/g, '\n')
        .trim()
        .slice(0, maxLength);
};

const sanitizeEmail = (value) => {
    const email = sanitizeString(value, { maxLength: 254 }).toLowerCase();
    return EMAIL_REGEX.test(email) ? email : '';
};

const sanitizeCameraCode = (value) => {
    const asString = String(value || '').trim();
    return /^\d{6}$/.test(asString) ? asString : '';
};

module.exports = {
    sanitizeString,
    sanitizeMultiline,
    sanitizeEmail,
    sanitizeCameraCode
};
