# Alertas do Rio Acre por e-mail (Resend)

Como colocar o envio de e-mail para funcionar, usando o domínio `camerasriobranco.com.br` (Registro.br).

Serve para dois usos, com a mesma configuração:
- código de 6 dígitos no cadastro/login com e-mail e senha;
- alertas do Rio Acre (card "Receber alertas do rio por e-mail" na página `/rio`).

## 1. Criar a conta e a chave no Resend

1. Crie a conta em https://resend.com (plano grátis: 3.000 e-mails/mês, 100/dia).
2. **API Keys → Create API Key** (permissão "Sending access"). Copie a chave (`re_...`): ela só aparece uma vez.

## 2. Verificar o domínio (obrigatório para enviar a qualquer pessoa)

Sem domínio verificado o Resend só entrega para o e-mail da sua própria conta.

1. No Resend: **Domains → Add Domain** → digite `camerasriobranco.com.br`.
   - Região: escolha a mais próxima (São Paulo / `sa-east-1`).
2. O Resend mostra uma lista de registros DNS. **Copie os valores exatos do painel dele** (eles mudam por conta/região). Em geral são:

   | Tipo | Nome (host) | Para que serve |
   |------|-------------|----------------|
   | MX   | `send`            | retorno/bounce dos e-mails |
   | TXT  | `send`            | SPF (quem pode enviar pelo seu domínio) |
   | TXT  | `resend._domainkey` | DKIM (assinatura que prova que o e-mail é seu) |
   | TXT  | `_dmarc` (opcional) | política DMARC, ex.: `v=DMARC1; p=none;` |

3. No **Registro.br** (https://registro.br → entre → seu domínio → **DNS**):
   - Se o domínio usa os servidores DNS do próprio Registro.br: **Editar zona** (ou "Modo avançado") → adicione cada registro acima.
   - Se o DNS fica em outro serviço (Cloudflare, etc.), adicione lá.
   - No campo "nome", o Registro.br costuma pedir só a parte antes do domínio (`send`, `resend._domainkey`), sem o `.camerasriobranco.com.br`.
4. Volte ao Resend e clique em **Verify DNS Records**. Pode levar de minutos a algumas horas.
   Quando todos ficarem **Verified**, o domínio está pronto.

> Cuidado ao adicionar registros: **não apague** os registros que já fazem o site funcionar (A, AAAA, CNAME do site, etc.). Só acrescente os novos.

## 3. Colocar a chave no projeto

No `serviceAccountKey.json` (raiz do projeto), preencha o bloco `resend`:

```json
"resend": {
  "apiKey": "re_COLE_AQUI_A_CHAVE",
  "from": "CamRB Conta <no-reply@camerasriobranco.com.br>",
  "fromAlertas": "CamRB Alertas <alertas@camerasriobranco.com.br>"
}
```

Dois remetentes, para você distinguir os e-mails na caixa de entrada:

| Campo | Aparece como | Usado em |
|-------|--------------|----------|
| `from` | CamRB Conta | código de 6 dígitos do cadastro/login |
| `fromAlertas` | CamRB Alertas | confirmação da inscrição nos alertas e os alertas do rio |

Os dois endereços precisam ser do domínio verificado (o que vem antes do `@` pode ser qualquer um). Não precisa criar caixa de e-mail nem DNS novo para cada um. Se `fromAlertas` ficar vazio, os alertas usam o mesmo remetente de `from`.

O `serviceAccountKey.json` é a fonte principal e **não precisa de `.env`**. (Se existir um `.env` com `RESEND_API_KEY=` e `MAIL_FROM=`, ele só é usado quando o arquivo não tiver esses valores.)

Os links de confirmar/cancelar nos e-mails usam o endereço do `SITE_BASE_URL`, que já vem como `https://camerasriobranco.com.br` no `docker-compose.yml`. Só mude se o site for para outro endereço.

Depois recrie o container:

```bash
docker compose up -d --build
```

No log (`docker compose logs`) deve aparecer: `✔ Envio de e-mail de verificação via resend`.

## 4. Publicar as regras do Firestore

O arquivo `firestore.rules` ganhou regras que bloqueiam o acesso de clientes à lista de inscritos (e-mails são dado pessoal). Publique no Firebase:

```bash
firebase deploy --only firestore:rules
```

(ou copie o conteúdo do arquivo no Console Firebase → Firestore → Regras). O servidor funciona sem isso, mas sem as regras explícitas a proteção depende do bloqueio padrão do Firestore.

## 5. Como os alertas funcionam

- Só recebe quem se inscreveu na página `/rio`, marcou o consentimento **e clicou no link de confirmação** enviado ao e-mail.
- Cada alerta tem o link **"Deixar de receber"** (e o botão de cancelar nativo do Gmail/Outlook). O cancelamento é imediato.
- O servidor confere o nível a cada 5 minutos e só avisa quando o rio **sobe** e passa de uma cota (Atenção 12,50 m · Alerta 13,50 m · Transbordamento 14,00 m), depois de **2 leituras seguidas** acima dela. Leitura velha ou sem qualidade confiável não dispara nada.
- Depois de avisar, só avisa de novo se o rio cair pelo menos 15 cm abaixo da cota e subir outra vez (evita e-mail repetido quando o nível oscila).
- Limite de **80 e-mails por dia** para sobrar parte dos 100/dia do plano grátis para os códigos de login. Se passar disso num dia de cheia, o restante é enviado no dia seguinte (ninguém recebe duas vezes).
- Dados guardados (coleção `alertSubscribers` no Firestore): e-mail, níveis escolhidos, datas de consentimento/confirmação e do último aviso. Cancelados ficam marcados como `unsubscribed` para não receberem mais nada; exclusão definitiva é feita a pedido pelo e-mail de suporte.
- Texto legal: seção 6 dos Termos de Uso (`public/termos.json`).

## 6. Acompanhar e testar

- Inscritos: Console Firebase → Firestore → `alertSubscribers` (`status`: `pending`, `active` ou `unsubscribed`).
- Estado do disparador: documento `system/rioAlertState` (nível atual e último evento).
- Log do servidor: linhas `[RIO_ALERT] ...`.
- Teste local sem enviar nada (aqui o `.env` é útil): `MAIL_DRIVER=console` e `SITE_BASE_URL=http://localhost:3001`, com o campo `resend.apiKey` do arquivo vazio; os e-mails aparecem no log.

## 7. Painel de teste (admin): /admin/alertas

Para mostrar a alguém (por exemplo, um professor) como o alerta funciona, sem esperar o rio subir. Só administradores acessam (aba **Alertas do Rio** no painel).

- **Resumo:** nível real do rio, inscritos (ativos, aguardando confirmação, cancelados), faixa registrada no sistema, e-mails enviados hoje e remetentes em uso.
- **Simulador do nível do rio:** arraste o nível (ou use os atalhos Normal, Atenção, Alerta, Transbordamento) e o painel explica o que o sistema decidiria: em que faixa cai, se dispararia alerta e para quantos inscritos. É uma simulação a seco: **não envia nada aos inscritos e não muda o nível mostrado no site**.
- **Prévia do e-mail:** mostra o e-mail exatamente como é montado, com um aviso amarelo de "e-mail de teste".
- **E-mail de teste:** envia **um** e-mail para o endereço que você digitar, pelo remetente de alertas, com `[TESTE]` no assunto. Nunca vai para os inscritos. Limite de 20 testes por dia (gasta a cota do provedor).

Por que o simulador não altera o nível real do site: mudar o nível público mostraria um valor falso para todos e dispararia alertas de verdade para pessoas reais, o que é perigoso num tema de enchente.

## 8. Fotos das câmeras do rio no e-mail

O alerta leva a foto das câmeras do rio **que estiverem online** (padrão: Passarela Joaquim Macedo `001334` e Ponte Metálica `001426`):
- as duas online: as duas fotos; só uma online: só ela; as duas fora do ar: o e-mail sai sem fotos;
- câmera fora do ar, ou com imagem inválida, nunca entra;
- a foto é tirada **uma vez por alerta**, quando ele sai, e salva em `public/uploads/alertas/`. Todos os inscritos veem a mesma foto daquele momento (uma imagem "ao vivo" aberta dias depois mostraria o rio de outro dia);
- fotos com mais de 30 dias são apagadas automaticamente;
- a prévia e o e-mail de teste do painel (`/admin/alertas`) também mostram as fotos e explicam quais câmeras entraram ou ficaram de fora.

Para trocar as câmeras, defina `RIO_ALERT_CAMERAS` (códigos separados por vírgula), por exemplo `001334,001426`.
