export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getLocalizedLabel(labelObj, lang, fallback = '') {
  const val = typeof labelObj === 'object' && labelObj !== null ? labelObj[lang] : '';
  const trimmed = String(val ?? '').trim();
  if (trimmed) {
    return trimmed;
  }
  return fallback || (lang === 'en' ? 'English label pending' : '待补充');
}

export function renderBreadcrumb({ dict, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  const listItems = items
    .map((item, idx) => {
      const isLast = idx === items.length - 1;
      if (!isLast && item.href) {
        return `<li class="vbg-custom-breadcrumb-item"><a class="vbg-custom-inline-link" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a><span class="vbg-custom-breadcrumb-sep" aria-hidden="true">/</span></li>`;
      }
      return `<li class="vbg-custom-breadcrumb-item"><span aria-current="page">${escapeHtml(item.label)}</span></li>`;
    })
    .join('');

  return `<nav aria-label="${escapeHtml(dict.breadcrumb.ariaLabel)}"><ol class="vbg-custom-breadcrumb-list">${listItems}</ol></nav>`;
}

export function renderSiteHeader({
  lang,
  dict,
  directories,
  currentDirectoryId = '',
  isDirectoryPage = false,
  alternatePath,
}) {
  const altHreflang = lang === 'zh' ? 'en' : 'zh-Hans';

  function buildDirNavAttr(dirId) {
    if (dirId !== currentDirectoryId) {
      return '';
    }
    return isDirectoryPage
      ? ' aria-current="page" data-active="true"'
      : ' data-active="true"';
  }

  const navItemsDesktop = directories
    .map((dir) => {
      const label = getLocalizedLabel(dir.title, lang, dir.id);
      const attrs = buildDirNavAttr(dir.id);
      return `<li class="vbg-custom-nav-item"><a class="vbg-custom-nav-link" href="/${lang}/directories/${escapeHtml(dir.id)}.html"${attrs}><span class="vbg-mono">${escapeHtml(dir.id)}</span><span>${escapeHtml(label)}</span></a></li>`;
    })
    .join('');

  const navItemsMobile = directories
    .map((dir) => {
      const label = getLocalizedLabel(dir.title, lang, dir.id);
      const attrs = buildDirNavAttr(dir.id);
      return `<li class="vbg-custom-nav-item"><a class="vbg-custom-nav-link" href="/${lang}/directories/${escapeHtml(dir.id)}.html"${attrs}><span class="vbg-mono">${escapeHtml(dir.id)}</span><span>${escapeHtml(label)}</span></a></li>`;
    })
    .join('');

  return `<header class="vbg-header">
      <div class="vbg-custom-header-bar">
        <div class="vbg-masthead">
          <span class="vbg-identity"><a class="vbg-custom-brand" href="/${lang}/index.html">${escapeHtml(dict.siteName)}</a></span>
          <div class="vbg-document-meta">
            <span class="vbg-meta">${escapeHtml(dict.header.metaCatalogue)}</span>
            <span class="vbg-meta">${escapeHtml(dict.header.metaRelease)}</span>
            <a class="vbg-custom-lang-link" data-lang-switch="header" href="${escapeHtml(alternatePath)}" hreflang="${altHreflang}">${escapeHtml(dict.header.langSwitchLabel)}</a>
          </div>
        </div>
        <nav class="vbg-custom-nav-wrap" aria-label="${escapeHtml(dict.header.navAriaLabel)}">
          <ul class="vbg-custom-nav-list vbg-custom-nav-desktop">${navItemsDesktop}</ul>
          <details class="vbg-custom-mobile-nav" data-mobile-nav>
            <summary class="vbg-custom-mobile-nav-summary">${escapeHtml(dict.header.mobileMenuLabel)} &#9662;</summary>
            <ul class="vbg-custom-mobile-nav-list">${navItemsMobile}</ul>
          </details>
        </nav>
      </div>
    </header>`;
}

export function renderSiteFooter({ lang, dict, alternatePath, currentRoutePath = '' }) {
  const altHreflang = lang === 'zh' ? 'en' : 'zh-Hans';
  const statementSuffix = dict.footer.statement.replace(/^SkillPouch\s*·\s*/, '');

  const langRow =
    lang === 'zh'
      ? `<span>${escapeHtml(dict.footer.langPrefix)}</span><strong aria-current="page">简体中文</strong><span aria-hidden="true">|</span><a class="vbg-custom-lang-link" data-lang-switch="footer" href="${escapeHtml(alternatePath)}" hreflang="${altHreflang}">English</a>`
      : `<span>${escapeHtml(dict.footer.langPrefix)}</span><a class="vbg-custom-lang-link" data-lang-switch="footer" href="${escapeHtml(alternatePath)}" hreflang="${altHreflang}">简体中文</a><span aria-hidden="true">|</span><strong aria-current="page">English</strong>`;

  const footerLinks = dict.footer.links
    ? `<nav class="vbg-custom-footer-nav" aria-label="${escapeHtml(dict.footer.linksAriaLabel || '')}">
          <a class="vbg-custom-footer-link" href="/${lang}/privacy.html"${currentRoutePath === `/${lang}/privacy.html` ? ' aria-current="page"' : ''}>${escapeHtml(dict.footer.links.privacy)}</a>
          <span aria-hidden="true">·</span>
          <a class="vbg-custom-footer-link" href="/${lang}/terms.html"${currentRoutePath === `/${lang}/terms.html` ? ' aria-current="page"' : ''}>${escapeHtml(dict.footer.links.terms)}</a>
          <span aria-hidden="true">·</span>
          <a class="vbg-custom-footer-link" href="/${lang}/contact.html"${currentRoutePath === `/${lang}/contact.html` ? ' aria-current="page"' : ''}>${escapeHtml(dict.footer.links.contact)}</a>
        </nav>`
    : '';

  return `<footer class="vbg-footer">
      <div class="vbg-custom-footer-stack">
        <p class="vbg-meta"><a class="vbg-custom-brand" href="/${lang}/index.html">${escapeHtml(dict.siteName)}</a> · ${escapeHtml(statementSuffix)}</p>
        <p class="vbg-caption">${escapeHtml(dict.footer.licenseNote)}</p>
        <div class="vbg-custom-footer-bottom">
          ${footerLinks}
          <div class="vbg-custom-footer-lang">${langRow}</div>
        </div>
      </div>
    </footer>`;
}

export function renderDocument({
  page,
  siteOrigin,
  dict,
  directories,
  currentDirectoryId = '',
  mainHtml,
  jsonLd = null,
  siteCssHref,
  clientScriptSrc,
}) {
  const zhPath = page.lang === 'zh' ? page.routePath : page.alternatePath;
  const enPath = page.lang === 'en' ? page.routePath : page.alternatePath;
  const zhUrl = `${siteOrigin}${zhPath}`;
  const enUrl = `${siteOrigin}${enPath}`;
  const xDefaultUrl = `${siteOrigin}${page.xDefaultPath}`;
  const ogType = page.pageType === 'skill' ? 'article' : 'website';

  const jsonLdScript = jsonLd
    ? `\n    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(page.htmlLang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}">
    <link rel="canonical" href="${escapeHtml(page.canonicalUrl)}">
    <meta property="og:site_name" content="${escapeHtml(dict.siteName)}">
    <meta property="og:title" content="${escapeHtml(page.title)}">
    <meta property="og:description" content="${escapeHtml(page.description)}">
    <meta property="og:url" content="${escapeHtml(page.canonicalUrl)}">
    <meta property="og:type" content="${ogType}">
    <meta property="og:locale" content="${escapeHtml(page.ogLocale)}">
    <meta property="og:locale:alternate" content="${escapeHtml(page.ogLocaleAlternate)}">
    <link rel="alternate" hreflang="zh-Hans" href="${escapeHtml(zhUrl)}">
    <link rel="alternate" hreflang="en" href="${escapeHtml(enUrl)}">
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(xDefaultUrl)}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..600&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet" referrerpolicy="no-referrer">
    <link rel="stylesheet" href="/assets/vercel-brand.css">
    <link rel="stylesheet" href="${escapeHtml(siteCssHref)}">${jsonLdScript}
  </head>
  <body class="vbg-report">
    <div class="vbg-shell">
      <a class="vbg-skip-link" href="#main">${escapeHtml(dict.skipToContent)}</a>
      ${renderSiteHeader({
        lang: page.lang,
        dict,
        directories,
        currentDirectoryId,
        isDirectoryPage: page.pageType === 'directory',
        alternatePath: page.alternatePath,
      })}
      <main id="main" class="vbg-custom-page-main">
        ${mainHtml}
      </main>
      ${renderSiteFooter({
        lang: page.lang,
        dict,
        alternatePath: page.alternatePath,
        currentRoutePath: page.routePath,
      })}
    </div>
    <script type="module" src="${escapeHtml(clientScriptSrc)}"></script>
  </body>
</html>
`;
}
