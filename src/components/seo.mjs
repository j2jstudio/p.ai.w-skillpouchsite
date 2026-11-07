import { assertNoForbiddenLeak } from '../../scripts/lib/ingest.mjs';
import { escapeHtml, getLocalizedLabel } from './shell.mjs';

export function buildHomeJsonLd({ page, dict }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: dict.siteName,
    headline: page.title,
    description: page.description,
    inLanguage: page.htmlLang,
    url: page.canonicalUrl,
  };
}

export function buildSkillJsonLd({ page, dict, skill, siteOrigin }) {
  const copy = skill.copy[page.lang];
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    applicationCategory: 'DeveloperApplication',
    name: copy.title,
    alternateName: skill.name,
    identifier: skill.id,
    description: page.description,
    inLanguage: page.htmlLang,
    license: `https://spdx.org/licenses/${skill.licenseSpdx}.html`,
    url: page.canonicalUrl,
    codeRepository: skill.upstreamUrl,
    softwareVersion: skill.revision,
    isPartOf: {
      '@type': 'WebSite',
      name: dict.siteName,
      url: `${siteOrigin}/${page.lang}/index.html`,
    },
  };
  if (skill.reviewedAt) {
    payload.dateModified = skill.reviewedAt;
  }
  return payload;
}

export function renderRobotsTxt({ siteOrigin }) {
  return `User-agent: *
Allow: /

Sitemap: ${siteOrigin}/sitemap.xml
`;
}

export function renderSitemapXml({ manifest, siteOrigin }) {
  const urlBlocks = manifest.pages
    .map((page) => {
      const zhPath = page.lang === 'zh' ? page.routePath : page.alternatePath;
      const enPath = page.lang === 'en' ? page.routePath : page.alternatePath;
      const zhUrl = `${siteOrigin}${zhPath}`;
      const enUrl = `${siteOrigin}${enPath}`;
      const xDefaultUrl = `${siteOrigin}${page.xDefaultPath}`;
      return `  <url>
    <loc>${escapeHtml(page.canonicalUrl)}</loc>
    <xhtml:link rel="alternate" hreflang="zh-Hans" href="${escapeHtml(zhUrl)}" />
    <xhtml:link rel="alternate" hreflang="en" href="${escapeHtml(enUrl)}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(xDefaultUrl)}" />
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlBlocks}
</urlset>
`;
}

export function renderLlmsTxt({ data }) {
  const { siteOrigin, directories, skills } = data;

  const dirLines = directories
    .map((dir) => {
      const enTitle = getLocalizedLabel(dir.title, 'en', dir.id);
      const zhTitle = getLocalizedLabel(dir.title, 'zh', dir.id);
      const taskWord = dir.taskCount === 1 ? 'task' : 'tasks';
      const skillWord = dir.skillCount === 1 ? 'curated skill' : 'curated skills';
      return `- [${dir.id} · ${enTitle} / ${zhTitle}](${siteOrigin}/en/directories/${dir.id}.html): ${dir.taskCount} ${taskWord}, ${dir.skillCount} ${skillWord} ([zh-Hans](${siteOrigin}/zh/directories/${dir.id}.html))`;
    })
    .join('\n');

  const skillLines = skills
    .map((skill) => {
      const enCopy = skill.copy.en;
      const zhCopy = skill.copy.zh;
      const summary =
        enCopy.summary ||
        `Curated Agent skill (${skill.name}) bound to stages ${skill.stagesBound.join(', ')}.`;
      return `- [${enCopy.title} (${skill.name})](${siteOrigin}/en/skills/${skill.stableSlug}.html) | [中文: ${zhCopy.title}](${siteOrigin}/zh/skills/${skill.stableSlug}.html): ${summary} [SPDX: ${skill.licenseSpdx}; Stages: ${skill.stagesBound.join(', ')}; Upstream: ${skill.upstreamUrl}]`;
    })
    .join('\n');

  const content = `# SkillPouch

> SkillPouch publishes a curated, evidence-backed Agent skills directory organized across 8 directories, 16 three-stage workflow tasks, and 34 deduplicated selected skills. Pages document stage fit rationale, pinned git revisions, SPDX licenses, and known limitations. This website is not a popularity ranking, does not issue official Agent compatibility certifications, and is separate from the SkillPouch desktop application's signed configuration endpoint.

## Entry Points

- [English Home](${siteOrigin}/en/index.html)
- [简体中文首页](${siteOrigin}/zh/index.html)
- [Privacy Policy / 隐私政策](${siteOrigin}/en/privacy.html) ([zh-Hans](${siteOrigin}/zh/privacy.html))
- [Terms of Use / 使用协议](${siteOrigin}/en/terms.html) ([zh-Hans](${siteOrigin}/zh/terms.html))
- [Contact Us / 联系我们](${siteOrigin}/en/contact.html) ([zh-Hans](${siteOrigin}/zh/contact.html))
- [XML Sitemap](${siteOrigin}/sitemap.xml)

## Curated Directories (8)

${dirLines}

## Selected Agent Skills (34)

${skillLines}
`;

  assertNoForbiddenLeak(content, 'public/llms.txt');
  return content;
}
