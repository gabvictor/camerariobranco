/**
 * @file share-utils.js
 * Utilitário universal e modular de compartilhamento com rastreamento UTM,
 * geração de QR Code dinâmico e integração com redes sociais.
 */
(function(window) {
    'use strict';

    const CamRBShare = {
        /**
         * Envia evento de compartilhamento ao backend para telemetria analítica detalhada.
         */
        trackShare: function({ platform = 'unknown', title = '', url = '', campaign = 'camera_live', path = window.location.pathname } = {}) {
            try {
                const payload = {
                    platform: String(platform || 'unknown').toLowerCase(),
                    title: String(title || document.title || ''),
                    url: String(url || window.location.href),
                    campaign: String(campaign || 'camera_live'),
                    path: String(path || window.location.pathname)
                };
                const bodyStr = JSON.stringify(payload);
                if (typeof fetch === 'function') {
                    fetch('/api/track-share', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: bodyStr,
                        keepalive: true
                    }).catch(() => {});
                } else if (navigator.sendBeacon) {
                    navigator.sendBeacon('/api/track-share', new Blob([bodyStr], { type: 'application/json' }));
                }
            } catch (_) {}
        },

        /**
         * Constrói a URL completa com parâmetros UTM para rastreamento de origem.
         */
        buildUrl: function(baseUrl, { source = 'share_link', medium = 'social_share', campaign = 'camera_live', content = '' } = {}) {
            try {
                const url = new URL(baseUrl, window.location.origin);
                if (source) url.searchParams.set('utm_source', source);
                if (medium) url.searchParams.set('utm_medium', medium);
                if (campaign) url.searchParams.set('utm_campaign', campaign);
                if (content) url.searchParams.set('utm_content', content);
                return url.toString();
            } catch (_) {
                return baseUrl;
            }
        },

        /**
         * Gera URL do QR Code de alta resolução com parâmetros UTM específicos.
         */
        getQrCodeUrl: function(url, size = 300, { title = 'Câmeras Rio Branco', campaign = 'camera_qr' } = {}) {
            const qrTargetUrl = CamRBShare.buildUrl(url, {
                source: 'qr_code',
                medium: 'offline_scan',
                campaign
            });
            CamRBShare.trackShare({ platform: 'qr_code', title, url: qrTargetUrl, campaign });
            return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrTargetUrl)}&size=${size}x${size}&format=png&margin=8`;
        },

        /**
         * Compartilha no WhatsApp com link rastreado.
         * No celular, abre diretamente o aplicativo oficial do WhatsApp (whatsapp://).
         * No desktop, abre o WhatsApp Web / wa.me.
         * Envia a URL para que o WhatsApp gere o card rico oficial da página.
         */
        toWhatsApp: function({ title = 'Câmeras Rio Branco Ao Vivo', url = window.location.href, campaign = 'camera_live', content = '' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'whatsapp', medium: 'social_share', campaign, content });
            CamRBShare.trackShare({ platform: 'whatsapp', title, url: shareUrl, campaign });
            const encodedUrl = encodeURIComponent(shareUrl);
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

            if (isMobile) {
                // Tenta abrir o app do WhatsApp diretamente via esquema de URI
                window.location.href = `whatsapp://send?text=${encodedUrl}`;
                setTimeout(() => {
                    if (document.hasFocus()) {
                        window.open(`https://wa.me/?text=${encodedUrl}`, '_blank');
                    }
                }, 1200);
            } else {
                const win = window.open(`https://web.whatsapp.com/send?text=${encodedUrl}`, '_blank');
                if (!win || win.closed || typeof win.closed === 'undefined') {
                    window.open(`https://wa.me/?text=${encodedUrl}`, '_blank');
                }
            }
        },

        /**
         * Compartilha no Telegram com link rastreado.
         * No celular, tenta abrir diretamente o app do Telegram (tg://).
         */
        toTelegram: function({ title = 'Câmeras Rio Branco Ao Vivo', url = window.location.href, campaign = 'camera_live', content = '' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'telegram', medium: 'social_share', campaign, content });
            CamRBShare.trackShare({ platform: 'telegram', title, url: shareUrl, campaign });
            const encodedUrl = encodeURIComponent(shareUrl);
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

            if (isMobile) {
                window.location.href = `tg://msg_url?url=${encodedUrl}`;
                setTimeout(() => {
                    if (document.hasFocus()) {
                        window.open(`https://t.me/share/url?url=${encodedUrl}`, '_blank');
                    }
                }, 1200);
            } else {
                window.open(`https://t.me/share/url?url=${encodedUrl}`, '_blank');
            }
        },

        /**
         * Compartilha no X (Twitter).
         */
        toTwitter: function({ title = 'Câmeras Rio Branco Ao Vivo', url = window.location.href, campaign = 'camera_live', content = '' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'twitter', medium: 'social_share', campaign, content });
            CamRBShare.trackShare({ platform: 'twitter', title, url: shareUrl, campaign });
            window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}`, '_blank');
        },

        /**
         * Compartilha no Facebook.
         */
        toFacebook: function({ title = 'Câmeras Rio Branco Ao Vivo', url = window.location.href, campaign = 'camera_live', content = '' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'facebook', medium: 'social_share', campaign, content });
            CamRBShare.trackShare({ platform: 'facebook', title, url: shareUrl, campaign });
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
        },

        /**
         * Aciona o menu nativo de compartilhamento do dispositivo (Mobile/Web Share API).
         * Garante que 'text' receba a URL para compatibilidade total com apps Android (ex: WhatsApp, Telegram),
         * que leem exclusivamente Intent.EXTRA_TEXT, permitindo gerar o card rico sem texto duplicado.
         */
        nativeShare: async function({ title = 'Câmeras Rio Branco', text = '', url = window.location.href, campaign = 'camera_live', content = '' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'native_share', medium: 'mobile_share', campaign, content });
            CamRBShare.trackShare({ platform: 'native_share', title, url: shareUrl, campaign });
            if (navigator.share) {
                try {
                    // No Android, o WhatsApp e Telegram dependem de Intent.EXTRA_TEXT (shareData.text)
                    // para saber qual link enviar. Se 'text' for vazio, o WhatsApp abre sem mensagem ou fecha.
                    const shareText = text && text.trim() ? `${text.trim()} ${shareUrl}` : shareUrl;
                    const shareData = {
                        title: title,
                        text: shareText,
                        url: shareUrl
                    };
                    await navigator.share(shareData);
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
         * Copia o link para a área de transferência com feedback visual e tracking.
         */
        copyLink: async function(url = window.location.href, { title = 'Câmeras Rio Branco Ao Vivo', campaign = 'camera_live', content = '', buttonEl = null, toastMsg = 'Link copiado para a área de transferência!' } = {}) {
            const shareUrl = CamRBShare.buildUrl(url, { source: 'share_link', medium: 'clipboard', campaign, content });
            CamRBShare.trackShare({ platform: 'copy_link', title, url: shareUrl, campaign });
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
