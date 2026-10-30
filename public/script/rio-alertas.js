// Inscrição opcional nos alertas do Rio Acre por e-mail (/rio).
// O servidor só ativa a inscrição depois que a pessoa clica no link enviado ao e-mail.
(function () {
    const form = document.getElementById('alertas-form');
    if (!form) return;

    const card = document.getElementById('alertas-card');
    const feedback = document.getElementById('alertas-feedback');
    const submit = document.getElementById('alertas-submit');
    const emailInput = document.getElementById('alertas-email');
    const consent = document.getElementById('alertas-consent');

    const STYLES = {
        ok: ['bg-emerald-50', 'dark:bg-emerald-950/40', 'border-emerald-200', 'dark:border-emerald-800/60', 'text-emerald-800', 'dark:text-emerald-300'],
        erro: ['bg-rose-50', 'dark:bg-rose-950/40', 'border-rose-200', 'dark:border-rose-800/60', 'text-rose-800', 'dark:text-rose-300']
    };

    function show(kind, message) {
        feedback.classList.remove('hidden', ...STYLES.ok, ...STYLES.erro);
        feedback.classList.add(...STYLES[kind]);
        feedback.textContent = message;
    }

    // Retorno do link do e-mail: /rio?alertas=confirmado | invalido
    const status = new URLSearchParams(window.location.search).get('alertas');
    if (status === 'confirmado') {
        show('ok', 'Pronto! Seus alertas do Rio Acre estão ativos. Cada e-mail terá um link para cancelar quando quiser.');
        card.scrollIntoView({ block: 'center' });
    } else if (status === 'invalido') {
        show('erro', 'Este link de confirmação não é válido ou foi cancelado. Faça a inscrição novamente abaixo.');
        card.scrollIntoView({ block: 'center' });
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const email = emailInput.value.trim();
        if (!email || !emailInput.checkValidity()) {
            show('erro', 'Digite um e-mail válido.');
            emailInput.focus();
            return;
        }
        const niveis = [...form.querySelectorAll('input[name="niveis"]:checked')].map((i) => i.value);
        if (!niveis.length) {
            show('erro', 'Escolha pelo menos uma cota para ser avisado.');
            return;
        }
        if (!consent.checked) {
            show('erro', 'Marque a caixa de consentimento para receber os alertas.');
            consent.focus();
            return;
        }

        submit.disabled = true;
        const label = submit.textContent;
        submit.textContent = 'Enviando...';
        try {
            const res = await fetch('/api/alertas/inscrever', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, niveis, consentimento: true })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                show('ok', data.mensagem || 'Enviamos um link de confirmação para o seu e-mail.');
                form.reset();
                form.querySelectorAll('input[name="niveis"]').forEach((i) => { i.checked = i.value !== 'atencao'; });
            } else {
                show('erro', data.error || 'Não foi possível concluir agora. Tente novamente.');
            }
        } catch (e) {
            show('erro', 'Sem conexão. Verifique sua internet e tente de novo.');
        } finally {
            submit.disabled = false;
            submit.textContent = label;
        }
    });
})();
