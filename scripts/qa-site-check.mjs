import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestSiteData, findForbiddenLeak } from './lib/ingest.mjs';
import { escapeHtml } from '../src/components/shell.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSiteRoot = path.resolve(__dirname, '..');

const TEXT_EXTENSIONS = new Set([
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.svg',
  '.txt',
  '.xml',
  '.json',
]);

function walkFiles(dir, baseDir = dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, baseDir, out);
    } else if (entry.isFile()) {
      out.push({
        fullPath,
        relPath: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
        ext: path.extname(entry.name).toLowerCase(),
      });
    }
  }
  return out;
}

function extractMetaContent(html, attrName, attrVal) {
  const escaped = attrVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(
    `<meta[^>]*\\b${attrName}="${escaped}"[^>]*\\bcontent="([^"]*)"`,
    'i',
  );
  const m1 = html.match(re1);
  if (m1) return m1[1];
  const re2 = new RegExp(
    `<meta[^>]*\\bcontent="([^"]*)"[^>]*\\b${attrName}="${escaped}"`,
    'i',
  );
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function resolveDistTarget(distDir, fromRelPath, rawUrl) {
  const [withoutHash, hash = ''] = rawUrl.split('#');
  const cleanUrl = withoutHash.split('?')[0];
  let targetRel = '';
  if (!cleanUrl) {
    targetRel = fromRelPath;
  } else if (cleanUrl.startsWith('/')) {
    targetRel = cleanUrl.replace(/^\//, '');
  } else {
    targetRel = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromRelPath), cleanUrl),
    );
  }
  return {
    targetRel,
    targetFull: path.join(distDir, targetRel),
    hash,
  };
}

export function runQaSiteCheck(options = {}) {
  const siteRoot = options.siteRoot
    ? path.resolve(options.siteRoot)
    : defaultSiteRoot;
  const distDir = options.distDir
    ? path.resolve(options.distDir)
    : path.join(siteRoot, 'dist');

  const errors = [];

  if (!fs.existsSync(distDir)) {
    return {
      ok: false,
      errors: [`[qa] dist directory does not exist: ${distDir}`],
      stats: {},
    };
  }

  let data;
  try {
    data = ingestSiteData({
      siteRoot,
      siteOrigin: options.siteOrigin || process.env.SITE_ORIGIN,
    });
  } catch (err) {
    return {
      ok: false,
      errors: [`[qa] ingest validation failed: ${err instanceof Error ? err.message : String(err)}`],
      stats: {},
    };
  }

  const allFiles = walkFiles(distDir);
  const htmlCache = new Map();

  // 1. Scan all text assets in dist/ for brand, theme-toggle, pending, rejected, and forbidden leaks
  for (const file of allFiles) {
    if (!TEXT_EXTENSIONS.has(file.ext)) {
      continue;
    }
    const content = fs.readFileSync(file.fullPath, 'utf8');
    if (file.ext === '.html') {
      htmlCache.set(file.relPath, content);
    }

    const leak = findForbiddenLeak(content);
    if (leak) {
      errors.push(
        `[qa][11.1/11.6] Forbidden token "${leak.token}" (${leak.reason}) in dist/${file.relPath}`,
      );
    }

    if (/theme-toggle|theme-switch|data-theme-toggle|<body[^>]*\bdata-theme=/i.test(content)) {
      errors.push(
        `[qa][11.1] Visible theme toggle or forced body[data-theme] detected in dist/${file.relPath}`,
      );
    }

    if (/skillpouch:\/\//i.test(content)) {
      errors.push(
        `[qa][11.5] Unapproved install deep-link protocol (skillpouch://) found in dist/${file.relPath}`,
      );
    }

    if (!file.relPath.startsWith('catalogue/v1/') && /catalogue\/v1\//i.test(content)) {
      errors.push(
        `[qa][11.6] Runtime R2 catalogue/v1 reference found in dist/${file.relPath}`,
      );
    }

    for (const rejSlug of data.rejectedKeys) {
      if (content.includes(rejSlug)) {
        errors.push(
          `[qa][11.6] Rejected CP2 skill "${rejSlug}" leaked into dist/${file.relPath}`,
        );
      }
    }

    if (
      file.ext === '.html' &&
      /English copy pending|English label pending|简介撰写中|推荐说明撰写中|TBD-public-copy/.test(
        content,
      )
    ) {
      errors.push(
        `[qa][11.8] Unfilled pending copy placeholder found in dist/${file.relPath}`,
      );
    }
  }

  if (!data.bilingualComplete) {
    errors.push('[qa][11.8] Bilingual dataset is incomplete (bilingualComplete=false)');
  }

  // 2. Exact scope & page inventory (§11.2 & §11.3)
  const htmlFiles = allFiles.filter((f) => f.ext === '.html');
  for (const f of htmlFiles) {
    if (f.relPath.includes('/stages/') || f.relPath.startsWith('stages/')) {
      errors.push(`[qa][11.2] Forbidden standalone stage HTML page found: dist/${f.relPath}`);
    }
  }

  const expectedPageCount = data.manifest.pages.length;
  const contentHtmlFiles = htmlFiles.filter((f) => f.relPath !== 'index.html');
  if (contentHtmlFiles.length !== expectedPageCount) {
    errors.push(
      `[qa][11.2] Expected exactly ${expectedPageCount} content HTML files, found ${contentHtmlFiles.length}`,
    );
  }

  const manifestByRel = new Map(
    data.manifest.pages.map((p) => [p.routePath.replace(/^\//, ''), p]),
  );
  const actualContentRels = new Set(contentHtmlFiles.map((f) => f.relPath));

  for (const [expectedRel, page] of manifestByRel.entries()) {
    if (!actualContentRels.has(expectedRel)) {
      errors.push(`[qa][11.2/11.3] Missing expected HTML page in dist: dist/${expectedRel}`);
    }
    const altRel = page.alternatePath.replace(/^\//, '');
    if (!actualContentRels.has(altRel)) {
      errors.push(
        `[qa][11.3] Missing bilingual counterpart dist/${altRel} for dist/${expectedRel}`,
      );
    }
  }
  for (const actualRel of actualContentRels) {
    if (!manifestByRel.has(actualRel)) {
      errors.push(`[qa][11.2] Unexpected extra HTML page in dist: dist/${actualRel}`);
    }
  }

  // Verify exact 38 skill slugs in dist/zh/skills and dist/en/skills match CP2 selected
  const expectedSkillSlugs = new Set(data.skills.map((s) => s.stableSlug));
  for (const lang of ['zh', 'en']) {
    const langSkillFiles = contentHtmlFiles.filter((f) =>
      f.relPath.startsWith(`${lang}/skills/`),
    );
    if (langSkillFiles.length !== 38) {
      errors.push(
        `[qa][11.2] Expected 38 skill pages under dist/${lang}/skills/, found ${langSkillFiles.length}`,
      );
    }
    for (const sf of langSkillFiles) {
      const slug = path.basename(sf.relPath, '.html');
      if (slug.includes(':')) {
        errors.push(`[qa][11.2] Colon found in skill HTML filename: dist/${sf.relPath}`);
      }
      if (!expectedSkillSlugs.has(slug)) {
        errors.push(
          `[qa][11.2] Skill HTML slug "${slug}" is not in CP2 selected 38 set`,
        );
      }
    }
  }

  // 3. Per-page SEO, Brand, Bilingual Parity, JSON-LD, Dual CTAs & CC-BY-SA (§11.1, §11.3–§11.6)
  const seenTitles = new Map();
  let jsonLdParsedCount = 0;

  for (const [relPath, page] of manifestByRel.entries()) {
    const html = htmlCache.get(relPath);
    if (!html) {
      continue;
    }

    // html lang
    const htmlLangMatch = html.match(/<html[^>]*\blang="([^"]+)"/i);
    if (!htmlLangMatch || htmlLangMatch[1] !== page.htmlLang) {
      errors.push(
        `[qa][11.4] Expected <html lang="${page.htmlLang}"> in dist/${relPath}, got "${htmlLangMatch?.[1] || ''}"`,
      );
    }

    // Single H1
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) {
      errors.push(`[qa][11.1] Expected exactly 1 <h1> in dist/${relPath}, found ${h1Count}`);
    }

    // Brand in header & footer
    if (
      !/<header class="vbg-header">[\s\S]*?SkillPouch[\s\S]*?<\/header>/.test(html) ||
      !/<footer class="vbg-footer">[\s\S]*?SkillPouch[\s\S]*?<\/footer>/.test(html)
    ) {
      errors.push(
        `[qa][11.1] Missing SkillPouch brand mark in header or footer of dist/${relPath}`,
      );
    }

    // Unique non-empty <title>
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const titleVal = (titleMatch?.[1] || '').trim();
    if (!titleVal) {
      errors.push(`[qa][11.3/11.4] Empty <title> in dist/${relPath}`);
    } else if (seenTitles.has(titleVal)) {
      errors.push(
        `[qa][11.4] Duplicate <title> "${titleVal}" shared by dist/${seenTitles.get(titleVal)} and dist/${relPath}`,
      );
    } else {
      seenTitles.set(titleVal, relPath);
    }

    // Description, Canonical, OG
    const desc = extractMetaContent(html, 'name', 'description');
    if (!desc || !desc.trim()) {
      errors.push(`[qa][11.3/11.4] Missing or empty meta description in dist/${relPath}`);
    }

    const canonicalMatch = html.match(/<link[^>]*\brel="canonical"[^>]*\bhref="([^"]+)"/i);
    if (!canonicalMatch || canonicalMatch[1] !== page.canonicalUrl) {
      errors.push(
        `[qa][11.4] Canonical mismatch in dist/${relPath}: expected "${page.canonicalUrl}", got "${canonicalMatch?.[1] || ''}"`,
      );
    }

    for (const ogProp of [
      'og:title',
      'og:description',
      'og:url',
      'og:type',
      'og:locale',
      'og:locale:alternate',
    ]) {
      const val = extractMetaContent(html, 'property', ogProp);
      if (!val || !val.trim()) {
        errors.push(`[qa][11.3/11.4] Missing or empty ${ogProp} in dist/${relPath}`);
      }
    }

    // Hreflang reciprocity
    const zhUrl = `${data.siteOrigin}${page.lang === 'zh' ? page.routePath : page.alternatePath}`;
    const enUrl = `${data.siteOrigin}${page.lang === 'en' ? page.routePath : page.alternatePath}`;
    const xDefaultUrl = `${data.siteOrigin}${page.xDefaultPath}`;

    for (const [hl, expectedHref] of [
      ['zh-Hans', zhUrl],
      ['en', enUrl],
      ['x-default', xDefaultUrl],
    ]) {
      const hlRe = new RegExp(
        `<link[^>]*\\brel="alternate"[^>]*\\bhreflang="${hl}"[^>]*\\bhref="([^"]+)"`,
        'i',
      );
      const m = html.match(hlRe);
      if (!m || m[1] !== expectedHref) {
        errors.push(
          `[qa][11.3/11.4] hreflang="${hl}" mismatch in dist/${relPath}: expected "${expectedHref}", got "${m?.[1] || ''}"`,
        );
      }
    }

    // LangSwitch in header & footer
    if (
      !html.includes(`data-lang-switch="header" href="${escapeHtml(page.alternatePath)}"`) ||
      !html.includes(`data-lang-switch="footer" href="${escapeHtml(page.alternatePath)}"`)
    ) {
      errors.push(
        `[qa][11.3] Header/Footer LangSwitch does not point to "${page.alternatePath}" in dist/${relPath}`,
      );
    }

    // JSON-LD on home & skill pages
    if (page.pageType === 'home' || page.pageType === 'skill') {
      const ldMatch = html.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i,
      );
      if (!ldMatch) {
        errors.push(`[qa][11.4] Missing JSON-LD script in dist/${relPath}`);
      } else {
        try {
          const parsed = JSON.parse(ldMatch[1]);
          jsonLdParsedCount += 1;
          const expectedType =
            page.pageType === 'home' ? 'WebSite' : 'SoftwareApplication';
          if (parsed['@type'] !== expectedType) {
            errors.push(
              `[qa][11.4] Expected JSON-LD @type="${expectedType}" in dist/${relPath}, got "${parsed['@type']}"`,
            );
          }
          if (page.pageType === 'skill') {
            for (const reqField of ['name', 'description', 'license', 'url', 'isPartOf']) {
              if (!parsed[reqField]) {
                errors.push(
                  `[qa][11.4] Missing JSON-LD field "${reqField}" in dist/${relPath}`,
                );
              }
            }
          }
        } catch (err) {
          errors.push(
            `[qa][11.4] Invalid JSON-LD in dist/${relPath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Skill-specific CTA & CC-BY-SA checks (§11.5 & §11.6)
    if (page.pageType === 'skill') {
      const skill = data.skillsBySlug.get(page.stableSlug);

      const upstreamCtaMatch = html.match(/<a\b[^>]*\bdata-cta="upstream"[^>]*>/i);
      if (!upstreamCtaMatch) {
        errors.push(`[qa][11.5] Missing upstream CTA link in dist/${relPath}`);
      } else {
        const tag = upstreamCtaMatch[0];
        const hrefM = tag.match(/\bhref="([^"]+)"/i);
        const relM = tag.match(/\brel="([^"]+)"/i);
        if (!hrefM || hrefM[1] !== escapeHtml(skill.upstreamUrl) || !hrefM[1].startsWith('https://')) {
          errors.push(
            `[qa][11.5] Upstream CTA href mismatch in dist/${relPath}: got "${hrefM?.[1] || ''}"`,
          );
        }
        if (!relM || !/\bnoopener\b/.test(relM[1])) {
          errors.push(`[qa][11.5/11.6] Upstream CTA missing rel="noopener" in dist/${relPath}`);
        }
      }

      const installBtnMatch = html.match(
        /<button\b[^>]*\bdata-cta="install-placeholder"[^>]*>([\s\S]*?)<\/button>/i,
      );
      if (!installBtnMatch) {
        errors.push(`[qa][11.5] Missing install placeholder button in dist/${relPath}`);
      } else {
        const openTag = installBtnMatch[0];
        const btnText = installBtnMatch[1];
        if (!/\bdisabled\b/i.test(openTag) || !/\baria-disabled="true"/i.test(openTag)) {
          errors.push(
            `[qa][11.5] Install CTA must have disabled and aria-disabled="true" in dist/${relPath}`,
          );
        }
        if (!/coming soon/i.test(btnText)) {
          errors.push(
            `[qa][11.5] Install CTA must visibly state Coming soon in dist/${relPath}`,
          );
        }
      }

      if (/^CC-BY-SA/i.test(skill.licenseSpdx)) {
        const secFMatch = html.match(
          /data-evidence-section="F"[\s\S]*?<\/section>/i,
        );
        const secFText = secFMatch ? secFMatch[0] : '';
        if (page.lang === 'zh') {
          if (!secFText.includes('署名') || !secFText.includes('相同方式共享')) {
            errors.push(
              `[qa][11.6] Missing CC-BY-SA attribution/share-alike notice in Section F of dist/${relPath}`,
            );
          }
        } else if (
          !/attribution/i.test(secFText) ||
          !/share[- ]alike/i.test(secFText)
        ) {
          errors.push(
            `[qa][11.6] Missing CC-BY-SA attribution/share-alike notice in Section F of dist/${relPath}`,
          );
        }
      }
    }
  }

  // 4. Site-level SEO/GEO files: robots.txt, sitemap.xml, llms.txt (§11.4)
  // 根路径在 html_handling=none 下不会改写成 index.html，必须由 _redirects 送到中文首页。
  const redirectsPath = path.join(distDir, '_redirects');
  if (!fs.existsSync(redirectsPath)) {
    errors.push('[qa][11.4] Missing dist/_redirects');
  } else {
    const redirects = fs.readFileSync(redirectsPath, 'utf8');
    if (!/^\/\s+\/zh\/index\.html\s+302\s*$/m.test(redirects)) {
      errors.push('[qa][11.4] dist/_redirects must 302 / to /zh/index.html');
    }
  }

  const robotsPath = path.join(distDir, 'robots.txt');
  if (!fs.existsSync(robotsPath)) {
    errors.push('[qa][11.4] Missing dist/robots.txt');
  } else {
    const robotsTxt = fs.readFileSync(robotsPath, 'utf8');
    if (
      !/Allow:\s*\//.test(robotsTxt) ||
      !robotsTxt.includes(`Sitemap: ${data.siteOrigin}/sitemap.xml`)
    ) {
      errors.push('[qa][11.4] dist/robots.txt missing Allow: / or Sitemap URL');
    }
  }

  let sitemapUrlCount = 0;
  const sitemapPath = path.join(distDir, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    errors.push('[qa][11.4] Missing dist/sitemap.xml');
  } else {
    const sitemapXml = fs.readFileSync(sitemapPath, 'utf8');
    const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    sitemapUrlCount = locs.length;
    if (locs.length !== expectedPageCount) {
      errors.push(
        `[qa][11.4] Expected ${expectedPageCount} <loc> entries in dist/sitemap.xml, found ${locs.length}`,
      );
    }
    const locSet = new Set(locs);
    for (const page of data.manifest.pages) {
      if (!locSet.has(page.canonicalUrl)) {
        errors.push(
          `[qa][11.4] Missing canonical URL in dist/sitemap.xml: ${page.canonicalUrl}`,
        );
      }
    }
  }

  const llmsPath = path.join(distDir, 'llms.txt');
  if (!fs.existsSync(llmsPath)) {
    errors.push('[qa][11.4] Missing dist/llms.txt');
  } else {
    const llmsTxt = fs.readFileSync(llmsPath, 'utf8');
    for (const skill of data.skills) {
      if (!llmsTxt.includes(`/en/skills/${skill.stableSlug}.html`)) {
        errors.push(
          `[qa][11.4] dist/llms.txt missing canonical link for skill "${skill.stableSlug}"`,
        );
      }
    }
  }

  // 5. External rel="noopener" & Internal link + fragment resolution across all HTML files
  for (const [relPath, html] of htmlCache.entries()) {
    // Check <a ...> tags
    for (const aMatch of html.matchAll(/<a\b[^>]*>/gi)) {
      const aTag = aMatch[0];
      const hrefMatch = aTag.match(/\bhref="([^"]+)"/i);
      if (!hrefMatch) {
        continue;
      }
      const href = hrefMatch[1];
      if (/^http:\/\//i.test(href)) {
        errors.push(`[qa][11.6] Insecure http:// link "${href}" in dist/${relPath}`);
        continue;
      }
      if (/^https:\/\//i.test(href)) {
        const relMatch = aTag.match(/\brel="([^"]+)"/i);
        if (!relMatch || !/\bnoopener\b/.test(relMatch[1])) {
          errors.push(
            `[qa][11.6] External link "${href}" missing rel="noopener" in dist/${relPath}`,
          );
        }
        continue;
      }
      if (/^mailto:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i.test(href)) {
        continue;
      }
      if (/^(mailto:|tel:|javascript:)/i.test(href)) {
        errors.push(`[qa][11.6] Unexpected link scheme "${href}" in dist/${relPath}`);
        continue;
      }

      const resolved = resolveDistTarget(distDir, relPath, href);
      if (!fs.existsSync(resolved.targetFull)) {
        errors.push(
          `[qa][11.6] Broken internal link "${href}" in dist/${relPath} -> missing dist/${resolved.targetRel}`,
        );
      } else if (resolved.hash && resolved.targetRel.endsWith('.html')) {
        const targetHtml = htmlCache.get(resolved.targetRel) || fs.readFileSync(resolved.targetFull, 'utf8');
        const idRe = new RegExp(`\\bid="${resolved.hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
        if (!idRe.test(targetHtml)) {
          errors.push(
            `[qa][11.6] Broken anchor "#${resolved.hash}" in link "${href}" from dist/${relPath}`,
          );
        }
      }
    }

    // Check local stylesheet & script assets
    for (const assetMatch of html.matchAll(
      /<(?:link\b[^>]*\brel="stylesheet"[^>]*\bhref|script\b[^>]*\bsrc)="([^"]+)"/gi,
    )) {
      const assetUrl = assetMatch[1];
      if (/^https:\/\//i.test(assetUrl)) {
        continue;
      }
      const resolved = resolveDistTarget(distDir, relPath, assetUrl);
      if (!fs.existsSync(resolved.targetFull)) {
        errors.push(
          `[qa][11.6] Missing local asset "${assetUrl}" referenced in dist/${relPath}`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      siteOrigin: data.siteOrigin,
      directories: data.directories.length,
      tasks: data.tasks.length,
      stages: data.stages.length,
      skills: data.skills.length,
      contentHtmlCount: contentHtmlFiles.length,
      uniqueTitlesCount: seenTitles.size,
      jsonLdParsedCount,
      sitemapUrlCount,
    },
  };
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const report = runQaSiteCheck({ siteRoot: defaultSiteRoot });
  if (!report.ok) {
    console.error(`[qa-site-check] FAILED with ${report.errors.length} violation(s):`);
    for (const err of report.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(
    `[qa-site-check] PASS: contentHtml=${report.stats.contentHtmlCount} uniqueTitles=${report.stats.uniqueTitlesCount} jsonLd=${report.stats.jsonLdParsedCount} sitemapUrls=${report.stats.sitemapUrlCount} skills=${report.stats.skills} (0 violations)`,
  );
}
