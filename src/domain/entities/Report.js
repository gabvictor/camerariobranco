/**
 * @entity Report
 * Representa um reporte de problema enviado por um usuário sobre uma câmera.
 */
class Report {
    static STATUSES = ['pending', 'reviewed', 'resolved', 'dismissed'];

    constructor({ cameraId, issueType, description, userEmail, userAgent, status }) {
        if (!cameraId)  throw new Error('Report.cameraId é obrigatório');
        if (!issueType) throw new Error('Report.issueType é obrigatório');

        this.cameraId   = cameraId;
        this.issueType  = issueType;
        this.description = description || '';
        this.userEmail  = userEmail   || 'anônimo';
        this.userAgent  = userAgent   || '';
        this.status     = Report.STATUSES.includes(status) ? status : 'pending';
    }

    isPending()  { return this.status === 'pending'; }
    isResolved() { return this.status === 'resolved'; }

    static isValidStatus(status) {
        return Report.STATUSES.includes(status);
    }
}

module.exports = Report;
