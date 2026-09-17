import { auth } from "./firebase-config.js";
import { initAuthModal, toggleLoginModal, initGlobalAuthUI } from "./auth-modal.js";
import { initFooter } from "./footer-component.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    initAuthModal();
    initGlobalAuthUI();
    initFooter();

    if (window.lucide) window.lucide.createIcons();

    // Theme Toggle
    const themeBtn = document.getElementById('toggle-theme');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            if (window.toggleTheme) window.toggleTheme();
        });
    }

    // Copy Email to Clipboard
    const copyEmailBtn = document.getElementById('copy-email-btn');
    if (copyEmailBtn) {
        copyEmailBtn.addEventListener('click', () => {
            navigator.clipboard.writeText('suportecamrb@gmail.com').then(() => {
                showToast('E-mail copiado para a área de transferência! 📋');
            }).catch(() => {
                showToast('suportecamrb@gmail.com');
            });
        });
    }

    // Prefill user data if logged in
    onAuthStateChanged(auth, (user) => {
        if (user) {
            const nomeInput = document.getElementById('contact-nome');
            const emailInput = document.getElementById('contact-email');
            if (nomeInput && !nomeInput.value) {
                nomeInput.value = user.displayName || user.email.split('@')[0];
            }
            if (emailInput && !emailInput.value) {
                emailInput.value = user.email;
            }
        }
    });

    setupContactForm();
});

function setupContactForm() {
    const form = document.getElementById('contact-form');
    const submitBtn = document.getElementById('contact-submit-btn');
    const feedback = document.getElementById('contact-feedback');
    const msgInput = document.getElementById('contact-mensagem');
    const charCounter = document.getElementById('char-counter');
    const labelLocal = document.getElementById('label-local');
    const hintLocal = document.getElementById('hint-local');
    const inputLocal = document.getElementById('contact-local');

    if (!form || !submitBtn) return;

    // Dynamic hints based on radio selection
    form.querySelectorAll('input[name="tipo"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'sugestao_camera') {
                if (labelLocal) labelLocal.textContent = 'Local Sugerido ou Bairro (Opcional)';
                if (inputLocal) inputLocal.placeholder = 'Ex: Av. Ceará, rotatória da 4ª Ponte, Bairro Bosque';
                if (hintLocal) hintLocal.textContent = 'Indique o bairro, avenida ou pontos de referência na capital.';
            } else if (val === 'reportar_problema') {
                if (labelLocal) labelLocal.textContent = 'Câmera com Problema (Nome ou Código)';
                if (inputLocal) inputLocal.placeholder = 'Ex: 001426 - Régua Rio Acre ou Ponte Metálica';
                if (hintLocal) hintLocal.textContent = 'Informe o código da câmera ou o endereço do ponto com falha.';
            } else if (val === 'parceria') {
                if (labelLocal) labelLocal.textContent = 'Nome do Estabelecimento / Bairro';
                if (inputLocal) inputLocal.placeholder = 'Ex: Posto ou Condomínio no Bairro Estação Experimental';
                if (hintLocal) hintLocal.textContent = 'Indique se possui link RTSP ou câmera voltada para a rua.';
            } else {
                if (labelLocal) labelLocal.textContent = 'Referência ou Assunto Específico (Opcional)';
                if (inputLocal) inputLocal.placeholder = 'Ex: Dúvida sobre aplicativo ou API';
                if (hintLocal) hintLocal.textContent = 'Adicione qualquer detalhe que ajude a identificar sua solicitação.';
            }
        });
    });

    // Character Counter
    if (msgInput && charCounter) {
        msgInput.addEventListener('input', () => {
            const len = msgInput.value.length;
            charCounter.textContent = `${len} / 1000`;
            if (len >= 950) {
                charCounter.className = 'text-[11px] font-bold text-red-500';
            } else {
                charCounter.className = 'text-[11px] font-semibold text-gray-400';
            }
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const tipoEl = form.querySelector('input[name="tipo"]:checked');
        const nomeEl = document.getElementById('contact-nome');
        const emailEl = document.getElementById('contact-email');
        const localEl = document.getElementById('contact-local');
        const msgEl = document.getElementById('contact-mensagem');

        const payload = {
            tipo: tipoEl ? tipoEl.value : 'sugestao_camera',
            nome: nomeEl ? nomeEl.value.trim() : '',
            email: emailEl ? emailEl.value.trim() : '',
            cameraOuLocal: localEl ? localEl.value.trim() : '',
            mensagem: msgEl ? msgEl.value.trim() : ''
        };

        if (!payload.mensagem || payload.mensagem.length < 5) {
            showFeedback('Por favor, escreva uma mensagem com pelo menos 5 caracteres.', 'error');
            return;
        }

        // Loading state
        submitBtn.disabled = true;
        const originalBtnHtml = submitBtn.innerHTML;
        submitBtn.innerHTML = `
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Enviando mensagem...</span>
        `;

        try {
            const res = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Falha ao enviar mensagem.');
            }

            showFeedback(data.message || 'Mensagem enviada com sucesso! Obrigado pela sua contribuição.', 'success');
            form.reset();
            if (charCounter) charCounter.textContent = '0 / 1000';

        } catch (err) {
            showFeedback(err.message || 'Ocorreu um erro ao enviar. Tente novamente mais tarde.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
            if (window.lucide) window.lucide.createIcons();
        }
    });

    function showFeedback(text, type) {
        if (!feedback) return;
        feedback.classList.remove('hidden', 'bg-emerald-50', 'text-emerald-700', 'dark:bg-emerald-900/30', 'dark:text-emerald-300', 'border-emerald-200', 'dark:border-emerald-800', 'bg-red-50', 'text-red-700', 'dark:bg-red-900/30', 'dark:text-red-300', 'border-red-200', 'dark:border-red-800');

        if (type === 'success') {
            feedback.className = 'p-4 rounded-2xl mb-6 text-sm font-semibold flex items-center gap-3 border bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
            feedback.innerHTML = `<i data-lucide="check-circle" class="w-5 h-5 text-emerald-600 flex-shrink-0"></i><span>${text}</span>`;
        } else {
            feedback.className = 'p-4 rounded-2xl mb-6 text-sm font-semibold flex items-center gap-3 border bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800';
            feedback.innerHTML = `<i data-lucide="alert-circle" class="w-5 h-5 text-red-600 flex-shrink-0"></i><span>${text}</span>`;
        }

        if (window.lucide) window.lucide.createIcons();
        feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Toast Notification Helper
const showToast = (message, type = 'success', duration = 3200) => {
    if (window.showToast) {
        window.showToast(message, type, duration);
    }
};
