import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestSiteData, writePageManifest } from './lib/ingest.mjs';
import { escapeHtml, renderDocument } from '../src/components/shell.mjs';
import { renderHomeMain } from '../src/components/home.mjs';
import { renderDirectoryMain } from '../src/components/directory.mjs';
import { renderTaskMain } from '../src/components/task.mjs';
import { renderSkillEvidenceMain } from '../src/components/skill-evidence.mjs';
import { renderLegalMain } from '../src/components/legal.mjs';
import {
  buildHomeJsonLd,
  buildSkillJsonLd,
  renderRobotsTxt,
  renderSitemapXml,
  renderLlmsTxt,
} from '../src/components/seo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSiteRoot = path.resolve(__dirname, '..');

function renderRootRedirectHtml({ siteOrigin, siteCssHref }) {
  const targetUrl = `${siteOrigin}/zh/index.html`;
  return `<!doctype html>
<html lang="zh-Hans">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SkillPouch · 精选 Agent Skills</title>
    <meta name="robots" content="noindex, follow">
    <meta http-equiv="refresh" content="0; url=/zh/index.html">
    <link rel="canonical" href="${escapeHtml(targetUrl)}">
    <link rel="stylesheet" href="/assets/vercel-brand.css">
    <link rel="stylesheet" href="${escapeHtml(siteCssHref)}">
  </head>
  <body class="vbg-report">
    <div class="vbg-shell">
      <main id="main" class="vbg-custom-page-main">
        <div class="vbg-custom-hero">
          <h1 class="vbg-title">SkillPouch</h1>
          <p class="vbg-meta">
            <a class="vbg-custom-inline-link" href="/zh/index.html">进入中文站（简体中文）</a>
            ·
            <a class="vbg-custom-inline-link" href="/en/index.html">Enter English site</a>
          </p>
        </div>
      </main>
    </div>
  </body>
</html>
`;
}

export function buildSitePages(options = {}) {
  const siteRoot = options.siteRoot
    ? path.resolve(options.siteRoot)
    : defaultSiteRoot;
  const generatedDir =
    options.generatedDir || path.join(siteRoot, '.generated');
  const writeManifest = options.writeManifest !== false;
  const writePublicAssets =
    options.writePublicAssets !== undefined
      ? options.writePublicAssets
      : writeManifest;
  const publicDir = options.publicDir || path.join(siteRoot, 'public');

  const data = ingestSiteData({
    ...options,
    siteRoot,
  });

  if (writeManifest) {
    const manifestPath = path.join(siteRoot, 'content/page-manifest.json');
    writePageManifest(manifestPath, data.manifest);
  }

  if (writePublicAssets) {
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(
      path.join(publicDir, 'robots.txt'),
      renderRobotsTxt({ siteOrigin: data.siteOrigin }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(publicDir, 'sitemap.xml'),
      renderSitemapXml({ manifest: data.manifest, siteOrigin: data.siteOrigin }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(publicDir, 'llms.txt'),
      renderLlmsTxt({ data }),
      'utf8',
    );
  }

  fs.rmSync(generatedDir, { recursive: true, force: true });
  fs.mkdirSync(generatedDir, { recursive: true });

  const siteCssHref = '/src/styles/site.css';
  const clientScriptSrc = '/src/client/site-enhance.js';

  // Root redirect index.html -> /zh/index.html (excluded from content page count)
  const rootIndexFile = path.join(generatedDir, 'index.html');
  fs.writeFileSync(
    rootIndexFile,
    renderRootRedirectHtml({
      siteOrigin: data.siteOrigin,
      siteCssHref,
    }),
    'utf8',
  );

  const emittedRoutes = [];

  for (const page of data.manifest.pages) {
    const dict = data.i18n[page.lang];
    const outFile = path.join(generatedDir, page.routePath.replace(/^\//, ''));

    let mainHtml = '';
    let currentDirectoryId = '';
    let jsonLd = null;

    if (page.pageType === 'home') {
      jsonLd = buildHomeJsonLd({ page, dict });
      mainHtml = renderHomeMain({
        lang: page.lang,
        dict,
        directories: data.directories,
        tasks: data.tasks,
        skills: data.skills,
        directoriesById: data.directoriesById,
      });
    } else if (page.pageType === 'directory') {
      const directory = data.directoriesById.get(page.entityId);
      currentDirectoryId = directory.id;
      mainHtml = renderDirectoryMain({
        lang: page.lang,
        dict,
        directory,
      });
    } else if (page.pageType === 'task') {
      const task = data.tasksById.get(page.entityId);
      const directory = data.directoriesById.get(task.directoryId);
      currentDirectoryId = directory.id;
      mainHtml = renderTaskMain({
        lang: page.lang,
        dict,
        task,
        directory,
        skillsBySlug: data.skillsBySlug,
      });
    } else if (page.pageType === 'skill') {
      const skill = data.skillsBySlug.get(page.stableSlug);
      const primaryTask = data.tasksById.get(skill.primaryTaskId);
      const primaryDirectory = primaryTask
        ? data.directoriesById.get(primaryTask.directoryId)
        : null;
      currentDirectoryId = primaryDirectory ? primaryDirectory.id : '';
      jsonLd = buildSkillJsonLd({
        page,
        dict,
        skill,
        siteOrigin: data.siteOrigin,
      });
      mainHtml = renderSkillEvidenceMain({
        lang: page.lang,
        dict,
        skill,
        primaryTask,
        primaryDirectory,
        stagesById: data.stagesById,
      });
    } else if (page.pageType === 'legal') {
      mainHtml = renderLegalMain({
        lang: page.lang,
        dict,
        pageSlug: page.entityId,
      });
    } else {
      throw new Error(`[build-pages] Unknown pageType: ${page.pageType}`);
    }

    const html = renderDocument({
      page,
      siteOrigin: data.siteOrigin,
      dict,
      directories: data.directories,
      currentDirectoryId,
      mainHtml,
      jsonLd,
      siteCssHref,
      clientScriptSrc,
    });

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, html, 'utf8');
    emittedRoutes.push(page.routePath);
  }

  return {
    data,
    generatedDir,
    emittedRoutes,
  };
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  try {
    const result = buildSitePages({ siteRoot: defaultSiteRoot });
    console.log(
      `[build-pages] OK: emitted ${result.emittedRoutes.length} bilingual content HTML entries (+ root redirect + robots/sitemap/llms) into ${path.relative(defaultSiteRoot, result.generatedDir)}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
