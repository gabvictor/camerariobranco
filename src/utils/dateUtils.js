/**
 * @util dateUtils
 * Funções utilitárias para garantir o fuso horário oficial de Rio Branco - Acre (America/Rio_Branco - UTC-5)
 */

const TIMEZONE = 'America/Rio_Branco';

/**
 * Retorna a data no formato YYYY-MM-DD no fuso horário do Acre
 * @param {Date|number} [date=new Date()]
 * @returns {string} ex: '2026-08-24'
 */
function getRioBrancoDateStr(date = new Date()) {
    const d = typeof date === 'number' ? new Date(date) : date;
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d);
}

/**
 * Formata data e hora no padrão brasileiro com fuso do Acre
 * @param {Date|number} [date=new Date()]
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string} ex: '24/08/2026, 12:45'
 */
function formatRioBrancoDateTime(date = new Date(), options = {}) {
    const d = typeof date === 'number' ? new Date(date) : date;
    const defaultOpts = {
        timeZone: TIMEZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    return new Intl.DateTimeFormat('pt-BR', { ...defaultOpts, ...options }).format(d);
}

/**
 * Formata apenas a hora (HH:mm) no fuso do Acre
 * @param {Date|number} [date=new Date()]
 * @returns {string} ex: '12:45'
 */
function formatRioBrancoTime(date = new Date()) {
    const d = typeof date === 'number' ? new Date(date) : date;
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit'
    }).format(d);
}

/**
 * Formata apenas o dia e mês (DD/MM) no fuso do Acre
 * @param {Date|number} [date=new Date()]
 * @returns {string} ex: '24/08'
 */
function formatRioBrancoDate(date = new Date()) {
    const d = typeof date === 'number' ? new Date(date) : date;
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIMEZONE,
        day: '2-digit',
        month: '2-digit'
    }).format(d);
}

module.exports = {
    TIMEZONE,
    getRioBrancoDateStr,
    formatRioBrancoDateTime,
    formatRioBrancoTime,
    formatRioBrancoDate
};
