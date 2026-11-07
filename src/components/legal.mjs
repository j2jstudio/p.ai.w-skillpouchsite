import { escapeHtml, renderBreadcrumb } from './shell.mjs';

const LEGAL_SLUGS = ['privacy', 'terms', 'contact'];

export function renderLegalMain({ lang, dict, pageSlug }) {
  const pageCopy = dict.legal?.pages?.[pageSlug];
  if (!pageCopy) {
    throw new Error(`[legal] Missing i18n legal page definition for "${pageSlug}" (${lang})`);
  }

  const breadcrumb = renderBreadcrumb({
    dict,
    items: [
      { label: dict.breadcrumb.home, href: `/${lang}/index.html` },
      { label: pageCopy.title },
    ],
  });

  const sectionsHtml = (pageCopy.sections || [])
    .map((sec) => {
      const paragraphsHtml = (sec.paragraphs || [])
        .map((p) => `<p class="vbg-body">${escapeHtml(p)}</p>`)
        .join('\n');

      const contactMetaHtml =
        Array.isArray(sec.contactMeta) && sec.contactMeta.length > 0
          ? `<dl class="vbg-custom-meta-grid" data-contact-channels>
              ${sec.contactMeta
                .map((item) => {
                  const valueHtml = item.href
                    ? `<a class="vbg-custom-inline-link vbg-custom-break" href="${escapeHtml(item.href)}">${escapeHtml(item.value)}</a>`
                    : `<span class="vbg-custom-break">${escapeHtml(item.value)}</span>`;
                  return `<div class="vbg-custom-meta-item">
                    <dt class="vbg-custom-meta-term">${escapeHtml(item.label)}</dt>
                    <dd class="vbg-custom-meta-desc">${valueHtml}</dd>
                  </div>`;
                })
                .join('\n')}
            </dl>`
          : '';

      const bulletsHtml =
        Array.isArray(sec.bullets) && sec.bullets.length > 0
          ? `<ul class="vbg-custom-bullet-list">
              ${sec.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('\n')}
            </ul>`
          : '';

      return `<section class="vbg-custom-section-block" aria-labelledby="section-${escapeHtml(sec.id)}" data-legal-section="${escapeHtml(sec.id)}">
        <h2 id="section-${escapeHtml(sec.id)}" class="vbg-heading-24">${escapeHtml(sec.heading)}</h2>
        ${paragraphsHtml}
        ${contactMetaHtml}
        ${bulletsHtml}
      </section>`;
    })
    .join('\n\n    ');

  const relatedLinksHtml = LEGAL_SLUGS.map((slug) => {
    const label = dict.legal.pages[slug]?.title || slug;
    const isCurrent = slug === pageSlug;
    const currentAttrs = isCurrent
      ? ' aria-current="page" data-highlighted="true"'
      : '';
    return `<li><a class="vbg-custom-chip" href="/${lang}/${escapeHtml(slug)}.html"${currentAttrs}>${escapeHtml(label)}</a></li>`;
  }).join('\n');

  return `<div class="vbg-custom-topbar">
      ${breadcrumb}
    </div>

    <section class="vbg-custom-hero" aria-labelledby="legal-page-title">
      <div class="vbg-custom-skill-subtitle-row">
        <span class="vbg-custom-badge">${escapeHtml(dict.legal.badge)}</span>
        <span class="vbg-meta">${escapeHtml(dict.legal.updatedAt)}</span>
      </div>
      <h1 id="legal-page-title" class="vbg-title">${escapeHtml(pageCopy.title)}</h1>
      <p class="vbg-lede">${escapeHtml(pageCopy.lede)}</p>
    </section>

    ${sectionsHtml}

    <section class="vbg-custom-section-block" aria-labelledby="legal-related-heading">
      <h2 id="legal-related-heading" class="vbg-heading-24">${escapeHtml(dict.legal.relatedHeading)}</h2>
      <ul class="vbg-custom-chip-row">
        ${relatedLinksHtml}
      </ul>
    </section>`;
}

