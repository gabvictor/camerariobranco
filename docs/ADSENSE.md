# AdSense: o que foi feito e o que falta

Motivo da reprovação: **"conteúdo de baixo valor"**. Na prática, o Google viu páginas que são só menu, miniaturas de
câmera e dados, sem texto próprio que justifique anúncio. Nada aqui garante aprovação: a decisão é do Google, e a
revisão pode levar de dias a semanas.

## O que mudou no site

| Antes | Agora |
|---|---|
| Home = menu + grade de miniaturas | Home com texto próprio (o que é o CamRB, o rio, links para guias) |
| Quase nenhum texto original | 6 guias de 520 a 715 palavras em `/guias`, com data de revisão e fontes citadas |
| Anúncio na grade de câmeras e na página de cada câmera | Sem anúncio nessas páginas (só imagem, sem texto) |
| Página de teste de anúncios no ar (`ads-test.html`) | Removida |
| Sem FAQ nem página de metodologia | `/guias/perguntas-frequentes` (com marcação FAQPage) e `/guias/como-o-camrb-funciona` |
| Guias não existiam no sitemap | Entram no `sitemap.xml` com a data de revisão |

Os guias ficam em `src/content/guias.js` e são montados por `GuideRenderer` a partir de `src/views/guias/guia.html`.
Para publicar um guia novo, basta acrescentar um item na lista e reiniciar o servidor.

Regra para os textos: só entra número de fonte conferida (SGB/CPRM, telemetria da ANA) ou medido pelo próprio CamRB.
Nada de texto gerado em massa: o Google reprova justamente isso.

## O que ainda depende de você

1. **Publicar** estas mudanças no servidor (git pull + `docker compose up -d --build`).
2. Conferir no ar: `/guias`, um guia, a home e `/sitemap.xml`.
3. No Search Console, enviar o sitemap de novo e pedir indexação dos guias.
4. Esperar alguns dias para o Google rastrear e **só então** pedir nova revisão no AdSense.
5. Revisar os guias com os seus olhos. Os números foram conferidos, mas o texto é do projeto: ajuste o que não soar
   como você e atualize `atualizado` quando mudar algo.

## Para aumentar as chances

- Publicar um guia novo por semana ou duas (cheia do mês, balanço mensal do rio, curiosidades da bacia). Site que
  cresce com conteúdo útil pesa a favor; site parado, contra.
- Cada guia deve ter **a sua** informação (dado, foto sua, explicação), não um resumo do que já existe na internet.
- Não clique nos próprios anúncios nem peça que outras pessoas cliquem: é motivo de banimento.
- Depois de aprovado, só coloque anúncios em páginas com texto próprio. A grade de câmeras e a página de câmera
  ficam sem anúncio de propósito.
- Os termos de uso já falam de cookies e do Google AdSense. Se o site tiver muitos acessos da Europa, será preciso uma
  plataforma de consentimento certificada pelo Google (não é o caso hoje, com público do Acre).

## Pendências conhecidas

- O CSS é recompilado no `docker build`; a tipografia dos guias é própria (bloco `<style>` no modelo) e não depende disso.
- A página `/rio` agora tem um texto fixo "Como ler o nível do Rio Acre" abaixo dos painéis dinâmicos.
