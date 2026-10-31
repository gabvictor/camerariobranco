/**
 * Desloga as contas que ainda NÃO confirmaram o e-mail (revoga os tokens de sessão).
 *
 * Depois disso, quem tentar entrar com e-mail e senha cai no fluxo normal do site:
 * o login pede o código de 6 dígitos, enviado por e-mail, antes de liberar a conta.
 * Contas já confirmadas (inclusive a do administrador) não são tocadas.
 *
 * Uso (na raiz do projeto, com serviceAccountKey.json presente):
 *   node scripts/revoke-unverified-sessions.js            # só conta quantas seriam deslogadas (não altera nada)
 *   node scripts/revoke-unverified-sessions.js --run      # revoga as sessões dessas contas
 *   Opcional: --show-emails  mostra os e-mails (dado pessoal; evite em logs compartilhados)
 *
 * Observação: o token de acesso já emitido pode valer por até 1 hora, mas o servidor e as regras
 * do Firestore já exigem e-mail confirmado, e o site desloga contas não confirmadas ao carregar.
 */
const { admin } = require('../src/config/firebaseAdmin');

const args = process.argv.slice(2);
const run = args.includes('--run');
const showEmails = args.includes('--show-emails');

async function* allUsers() {
    let pageToken;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        for (const user of page.users) yield user;
        pageToken = page.pageToken;
    } while (pageToken);
}

(async () => {
    let total = 0;
    let unverified = 0;
    let revoked = 0;
    let failed = 0;

    for await (const user of allUsers()) {
        total++;
        if (user.emailVerified || !user.email) continue;
        unverified++;

        if (!run) {
            if (showEmails) console.log(`seria deslogada: ${user.email}`);
            continue;
        }

        try {
            await admin.auth().revokeRefreshTokens(user.uid);
            revoked++;
            if (showEmails) console.log(`deslogada: ${user.email}`);
        } catch (error) {
            failed++;
            console.error(`Falha ao revogar uma sessão (uid ${user.uid}): ${error.message}`);
        }
    }

    console.log(`Contas no total: ${total}`);
    console.log(`Contas sem e-mail confirmado: ${unverified}`);
    if (run) {
        console.log(`Sessões revogadas agora: ${revoked}${failed ? ` | falhas: ${failed}` : ''}`);
    } else {
        console.log('Nada foi alterado. Rode com --run para deslogar essas contas.');
    }
    process.exit(failed ? 1 : 0);
})().catch((error) => {
    console.error('Erro:', error.message);
    process.exit(1);
});
