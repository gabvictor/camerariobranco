const fs = require('fs');
const path = require('path');

const escapeHtml = (value) => String(value ?? '').replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;'
}[c]));

/** Texto simples com `[texto](/rota)` → HTML escapado, com links só para o próprio site. */
function inline(text) {
    return escapeHtml(text).replace(/\[([^\]]+)\]\((\/[a-z0-9/_-]*)\)/gi, '<a href="$2">$1</a>');
}

const slugOf = (text) => String(text).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const formatDate = (iso) => {
    const [y, m, d] = String(iso).split('-');
    return `${d}/${m}/${y}`;
};

/**
 * GuideRenderer — monta as páginas de guias (texto próprio do site) a partir de `src/content/guias.js`
 * e do modelo `src/views/guias/guia.html`. Tudo é escapado: o conteúdo é só texto e links internos.
 */
class GuideRenderer {
    constructor({ guias, templatePath, baseUrl, fsImpl }) {
        this._guias = guias;
        this._baseUrl = String(baseUrl || 'https://camerasriobranco.com.br').replace(/\/+$/, '');
        this._template = (fsImpl || fs).readFileSync(templatePath, 'utf8');
    }

    list() {
        return this._guias.map((g) => ({ slug: g.slug, atualizado: g.atualizado }));
    }

    find(slug) {
        return this._guias.find((g) => g.slug === slug) || null;
    }

    _fill(values) {
        return Object.entries(values).reduce((html, [key, value]) => html.split(`{{${key}}}`).join(value), this._template);
    }

    _crumbs(items) {
        return items.map((it, i) => (it.href && i < items.length - 1
            ? `<a href="${it.href}" class="hover:underline">${escapeHtml(it.nome)}</a>`
            : `<span aria-current="page">${escapeHtml(it.nome)}</span>`)).join(' <span aria-hidden="true">›</span> ');
    }

    _jsonLd(graph) {
        // </script> dentro de um texto fecharia o bloco: barra invertida antes da barra resolve.
        return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
    }

    _table(t) {
        const head = t.cabecalho.map((c) => `<th scope="col">${inline(c)}</th>`).join('');
        const rows = t.linhas.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    _section(s) {
        const out = [`<h2 id="${slugOf(s.h)}">${inline(s.h)}</h2>`];
        (s.p || []).forEach((p) => out.push(`<p>${inline(p)}</p>`));
        if (s.list) out.push(`<ul>${s.list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
        if (s.tabela) out.push(this._table(s.tabela));
        (s.p2 || []).forEach((p) => out.push(`<p>${inline(p)}</p>`));
        if (s.nota) out.push(`<p class="nota"><strong>Nota:</strong> ${inline(s.nota)}</p>`);
        return out.join('\n');
    }

    _related(g) {
        const rel = (g.relacionados || []).map((slug) => this.find(slug)).filter(Boolean);
        if (!rel.length) return '';
        return `<section class="rel" aria-labelledby="leia-tambem"><h2 id="leia-tambem" style="margin-top:0">Leia também</h2><div class="cards">${rel.map((r) => `<a class="card" href="/guias/${r.slug}"><strong>${inline(r.curto)}</strong><span>${inline(r.resumo)}</span></a>`).join('')}</div></section>`;
    }

    renderGuide(slug) {
        const g = this.find(slug);
        if (!g) return null;
        const url = `${this._baseUrl}/guias/${g.slug}`;
        const secoes = g.secoes || [];
        const sumario = secoes.length > 3
            ? `<nav class="sumario" aria-label="Neste guia"><strong>Neste guia</strong><ol>${secoes.map((s) => `<li><a href="#${slugOf(s.h)}">${inline(s.h)}</a></li>`).join('')}</ol></nav>`
            : '';
        const faq = (g.faq || []).map(([q, a]) => `<details><summary>${inline(q)}</summary><p>${inline(a)}</p></details>`).join('\n');

        const article = [
            `<h1>${inline(g.titulo)}</h1>`,
            `<p class="meta">Por CamRB · Atualizado em ${formatDate(g.atualizado)}</p>`,
            `<p class="lead">${inline(g.intro)}</p>`,
            sumario,
            secoes.map((s) => this._section(s)).join('\n'),
            faq,
            this._related(g)
        ].filter(Boolean).join('\n');

        const graph = [
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Início', item: `${this._baseUrl}/` },
                    { '@type': 'ListItem', position: 2, name: 'Guias', item: `${this._baseUrl}/guias` },
                    { '@type': 'ListItem', position: 3, name: g.curto, item: url }
                ]
            },
            {
                '@type': g.faq ? 'FAQPage' : 'Article',
                '@id': `${url}#${g.faq ? 'faq' : 'article'}`,
                url,
                headline: g.titulo,
                name: g.titulo,
                description: g.descricao,
                inLanguage: 'pt-BR',
                dateModified: g.atualizado,
                author: { '@type': 'Organization', name: 'CamRB', url: `${this._baseUrl}/` },
                publisher: { '@type': 'Organization', name: 'CamRB', url: `${this._baseUrl}/`, logo: { '@type': 'ImageObject', url: `${this._baseUrl}/assets/camrb.png` } },
                ...(g.faq ? { mainEntity: g.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) } : {})
            }
        ];

        return this._fill({
            TITLE: escapeHtml(g.titulo),
            DESCRIPTION: escapeHtml(g.descricao),
            URL: url,
            BASE: this._baseUrl,
            OGTYPE: 'article',
            JSONLD: this._jsonLd(graph),
            CRUMBS: this._crumbs([{ nome: 'Início', href: '/' }, { nome: 'Guias', href: '/guias' }, { nome: g.curto }]),
            ARTICLE: article
        });
    }

    renderIndex() {
        const url = `${this._baseUrl}/guias`;
        const titulo = 'Guias do CamRB: Rio Acre, cheias e câmeras de Rio Branco';
        const descricao = 'Guias com texto próprio sobre o nível e as cotas do Rio Acre, as cheias e secas, o que fazer em uma enchente e como o CamRB funciona.';
        const cards = this._guias.map((g) => `<a class="card" href="/guias/${g.slug}"><strong>${inline(g.curto)}</strong><span>${inline(g.resumo)}</span></a>`).join('');
        const article = [
            '<h1>Guias do CamRB</h1>',
            '<p class="lead">Textos próprios sobre o Rio Acre, as cheias e o funcionamento do site, escritos para quem mora ou trabalha em Rio Branco. Cada guia traz a data da última revisão e cita de onde vêm os números.</p>',
            `<div class="cards">${cards}</div>`,
            '<p style="margin-top:2rem">Quer acompanhar o rio agora? Veja o <a href="/rio">nível do Rio Acre em tempo real</a> e as <a href="/">câmeras ao vivo de Rio Branco</a>.</p>'
        ].join('\n');
        const graph = [{
            '@type': 'CollectionPage', '@id': `${url}#guias`, url, name: titulo, description: descricao, inLanguage: 'pt-BR',
            hasPart: this._guias.map((g) => ({ '@type': 'Article', headline: g.titulo, url: `${this._baseUrl}/guias/${g.slug}` }))
        }];
        return this._fill({
            TITLE: escapeHtml(titulo), DESCRIPTION: escapeHtml(descricao), URL: url, BASE: this._baseUrl, OGTYPE: 'website',
            JSONLD: this._jsonLd(graph),
            CRUMBS: this._crumbs([{ nome: 'Início', href: '/' }, { nome: 'Guias' }]),
            ARTICLE: article
        });
    }
}

GuideRenderer.defaultTemplate = path.join(__dirname, '..', '..', 'views', 'guias', 'guia.html');
module.exports = GuideRenderer;
