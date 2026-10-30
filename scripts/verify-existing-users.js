/**
 * Marca contas existentes como "e-mail verificado" no Firebase Auth.
 *
 * Use UMA vez ao ativar a verificação por código, para que contas antigas
 * (inclusive a do administrador) não precisem passar pelo código.
 *
 * Uso (na raiz do projeto, com serviceAccountKey.json presente):
 *   node scripts/verify-existing-users.js --list              # só lista as contas não verificadas
 *   node scripts/verify-existing-users.js email1@x.com ...    # verifica apenas estes e-mails
 *   node scripts/verify-existing-users.js --all               # verifica TODAS as contas existentes
 */
const { admin } = require('../src/config/firebaseAdmin');

const args = process.argv.slice(2);

async function* allUsers() {
    let pageToken;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        for (const user of page.users) yield user;
        pageToken = page.pageToken;
    } while (pageToken);
}

(async () => {
    const listOnly = args.includes('--list');
    const all = args.includes('--all');
    const emails = new Set(args.filter(a => !a.startsWith('--')).map(a => a.toLowerCase()));

    if (!listOnly && !all && emails.size === 0) {
        console.log('Informe --list, --all ou um ou mais e-mails. Veja o cabeçalho do arquivo.');
        process.exit(1);
    }

    let unverified = 0;
    let updated = 0;

    for await (const user of allUsers()) {
        if (user.emailVerified || !user.email) continue;
        unverified++;

        const selected = all || emails.has(user.email.toLowerCase());
        if (listOnly || !selected) {
            console.log(`não verificado: ${user.email}`);
            continue;
        }

        await admin.auth().updateUser(user.uid, { emailVerified: true });
        updated++;
        console.log(`verificado:     ${user.email}`);
    }

    console.log(`\nContas não verificadas encontradas: ${unverified} | marcadas agora: ${updated}`);
    process.exit(0);
})().catch((error) => {
    console.error('Erro:', error.message);
    process.exit(1);
});
