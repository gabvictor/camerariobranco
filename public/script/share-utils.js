/**
 * @file share-utils.js
 * Utilitário universal e modular de compartilhamento com rastreamento UTM,
 * geração de QR Code dinâmico e integração com redes sociais.
 */
(function(window) {
    'use strict';

    const CamRBShare = {
        /**
         * Constrói a URL completa com parâmetros UTM para rastreamento de origem.
         */
        buildUrl: function(baseUrl, { source = 'share_link', medium = 'social_share', campaign = 'camera_live' } = {}) {
            try {
                const url = new URL(baseUrl, window.location.origin);
                if (source) url.searchParams.set('utm_source', source);
                if (medium) url.searchParams.set('utm_medium', medium);
                if (campaign) url.searchParams.set('utm_campaign', campaign);
                return url.toString();
            } catch (_) {
                return baseUrl;
            }
        },

        /**
         * Gera URL do QR Code de alta resolução com parâmetros UTM específicos.
         */
        getQrCodeUrl: function(url, size = 300) {
            const qrTargetUrl = CamRBShare.buildUrl(url, {
                source: 'qr_code',
                medium: 'offline_scan',
                campaign: 'camera_qr'
            });
            return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrTargetUrl)}&size=${size}x${size}&format=png&margin=8`;
        },

        /**
         * Compartilha no WhatsApp com texto formatado e link rastreado.
         */
        toWhatsApp: function({ title = 'Câmeras Rio Branco Ao Vivo', url = window.location.href, campaign = 'camera_live' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'whatsapp', medium: 'social_share', campaign });
            const message = `📹 *${title}*\n\nAssista à transmissão ao vivo em tempo real:\n👉 ${shareUrl}`;
            window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`, '_blank');
        },

        /**
         * Compartilha no Telegram com link rastreado.
         */
        toTelegram: function({ title = 'Câmeras Rio Branco Ao Vivo', url = window.location.href, campaign = 'camera_live' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'telegram', medium: 'social_share', campaign });
            const message = `📹 ${title}`;
            window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(message)}`, '_blank');
        },

        /**
         * Compartilha no X (Twitter).
         */
        toTwitter: function({ title = 'Câmeras Rio Branco Ao Vivo', url = window.location.href, campaign = 'camera_live' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'twitter', medium: 'social_share', campaign });
            const text = `📹 ${title} — Transmissão ao vivo em Rio Branco - AC:`;
            window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`, '_blank');
        },

        /**
         * Compartilha no Facebook.
         */
        toFacebook: function({ url = window.location.href, campaign = 'camera_live' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'facebook', medium: 'social_share', campaign });
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
        },

        /**
         * Aciona o menu nativo de compartilhamento do dispositivo (Mobile/Web Share API).
         */
        nativeShare: async function({ title = 'Câmeras Rio Branco', text = 'Assista à transmissão ao vivo:', url = window.location.href, campaign = 'camera_live' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'native_share', medium: 'mobile_share', campaign });
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: title,
                        text: text,
                        url: shareUrl
                    });
                    return true;
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.warn('Falha no compartilhamento nativo:', err);
                    }
                    return false;
                }
            }
            return false;
        },

        /**
         * Copia o link para a área de transferência com feedback visual.
         */
        copyLink: async function(url = window.location.href, { campaign = 'camera_live', buttonEl = null, toastMsg = 'Link copiado para a área de transferência!' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'share_link', medium: 'clipboard', campaign });
            try {
                await navigator.clipboard.writeText(shareUrl);
                if (buttonEl) {
                    const originalHtml = buttonEl.innerHTML;
                    buttonEl.innerHTML = `<svg class="w-3.5 h-3.5 inline-block text-emerald-300 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> Copiado!`;
                    buttonEl.classList.add('bg-emerald-600');
                    setTimeout(() => {
                        buttonEl.innerHTML = originalHtml;
                        buttonEl.classList.remove('bg-emerald-600');
                        if (window.lucide) window.lucide.createIcons();
                    }, 2000);
                }
                if (typeof window.showToast === 'function') {
                    window.showToast(toastMsg);
                }
                return true;
            } catch (_) {
                return false;
            }
        }
    };

    window.CamRBShare = CamRBShare;
})(window);
