# Perfis de visitantes (admin)

Painel em **`/admin/visitantes`** (aba **Visitantes**) e resumo no **Dashboard**. Mostra, para cada visita, quanto tempo a pessoa ficou, quais páginas viu e quais câmeras assistiu.

## Como é medido

- **Só contas logadas.** Visitantes anônimos não entram: podem ser robôs ou a mesma pessoa abrindo o site várias vezes, o que enchia o painel de ruído. Quem está logado conta uma vez só, mesmo com várias abas abertas (o tempo é o do relógio, sem somar abas).
- **Sem cookies novos.** Não se guarda e-mail, e o IP aparece mascarado.
- **Tempo na página:** cada página aberta mantém uma conexão com o servidor; o tempo dela é o tempo na página.
- **Câmeras assistidas:** cada vídeo ao vivo é uma conexão por câmera; o tempo dela é o tempo assistindo aquela câmera.
- **Segundo plano não conta.** O navegador avisa quando a aba fica escondida; o tempo só é descontado quando todas as abas da pessoa estão escondidas.
- **Contadores gerais continuam.** As "visualizações do dia" do dashboard vêm de outro contador e seguem contando todo mundo; só os perfis são limitados a logados.
- **Visita encerrada** quando fica sem nenhuma conexão por 3 minutos.
- **Robôs e buscadores não entram** na contagem.

## O que fica gravado

| Dado | Onde | Por quanto tempo |
|------|------|------------------|
| Resumo do dia (totais: visitas, tempo, câmeras, horários, aparelhos) | `stats/visitors/daily/{data}` | indefinido (só números) |
| Perfil detalhado da visita (páginas, câmeras, aparelho, cidade) | `visitor_sessions` | **30 dias**, depois é apagado |

Só viram perfil detalhado visitas com **pelo menos 20 s**, **10 s de câmera** ou **login**, com teto de **500 por dia** (protege a cota do Firestore). Todas as visitas entram no resumo do dia.

Quem estiver logado aparece com o **apelido** (nunca o e-mail).

Texto legal: Termos de Uso, seção 5 ("Estatísticas de Uso").

## Limites

- Os perfis começam a existir a partir da publicação desta versão; não há histórico anterior.
- Se o servidor reiniciar, as visitas em andamento são gravadas ao desligar; uma queda brusca perde só as que estavam abertas.
- O acesso ao banco é só pelo servidor (as regras do Firestore bloqueiam navegadores).
