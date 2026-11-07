import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSitePages } from '../scripts/build-pages.mjs';
import { findForbiddenLeak } from '../scripts/lib/ingest.mjs';
import { initSearchBox } from '../src/client/site-enhance.js';
import { renderDirectoryMain } from '../src/components/directory.mjs';
import { renderTaskMain } from '../src/components/task.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

const PUBLISHED_VBG_TOKENS = new Set([
  '--vbg-surface-primary',
  '--vbg-surface-secondary',
  '--vbg-surface-contrast',
  '--vbg-text-primary',
  '--vbg-text-secondary',
  '--vbg-text-on-contrast',
  '--vbg-text-on-contrast-secondary',
  '--vbg-border-subtle',
  '--vbg-border-default',
  '--vbg-border-strong',
  '--vbg-border-on-contrast',
  '--vbg-focus',
  '--vbg-color-info',
  '--vbg-color-success',
  '--vbg-color-warning',
  '--vbg-color-error',
  '--vbg-chart-1',
  '--vbg-chart-2',
  '--vbg-chart-3',
  '--vbg-chart-4',
  '--vbg-chart-5',
  '--vbg-chart-6',
  '--vbg-space-1',
  '--vbg-space-2',
  '--vbg-space-3',
  '--vbg-space-4',
  '--vbg-space-5',
  '--vbg-space-6',
  '--vbg-space-8',
  '--vbg-space-10',
  '--vbg-space-12',
  '--vbg-space-16',
  '--vbg-radius-small',
  '--vbg-radius',
  '--vbg-type-display',
  '--vbg-type-page-title',
  '--vbg-type-title',
  '--vbg-type-section',
  '--vbg-type-subsection',
  '--vbg-type-lede',
  '--vbg-type-body',
  '--vbg-type-compact',
  '--vbg-type-label',
  '--vbg-type-metadata',
  '--vbg-weight-regular',
  '--vbg-weight-heading',
  '--vbg-weight-medium',
  '--vbg-weight-semibold',
  '--vbg-leading-body',
  '--vbg-leading-compact',
  '--vbg-leading-caption',
  '--vbg-leading-display',
  '--vbg-leading-page-title',
  '--vbg-leading-title',
  '--vbg-leading-section',
  '--vbg-leading-subsection',
  '--vbg-leading-lede',
]);

test('site.css uses only .vbg-custom-* selectors and published --vbg-* tokens', () => {
  const css = fs.readFileSync(path.join(siteRoot, 'src/styles/site.css'), 'utf8');
  assert.equal(findForbiddenLeak(css), null);

  // Strip comments and check every --vbg-* token
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = stripped.match(/--vbg-[a-z0-9-]+/g) || [];
  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    assert.equal(
      PUBLISHED_VBG_TOKENS.has(token),
      true,
      `Unpublished VBG token used in site.css: ${token}`,
    );
  }

  // Every class selector in site.css must start with .vbg-custom-
  const classMatches = stripped.match(/\.[a-zA-Z0-9_-]+/g) || [];
  const cssClasses = classMatches.filter((m) => !/^\.\d/.test(m));
  for (const cls of cssClasses) {
    assert.match(
      cls,
      /^\.vbg-custom-/,
      `Non-custom class selector targeted in site.css: ${cls}`,
    );
  }
});

test('generates bilingual Home, 8 Directories, and 16 Tasks with VBG shell and zero stage pages', () => {
  const tmpGen = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-browse-gen-'));
  try {
    const { data, emittedRoutes } = buildSitePages({
      siteRoot,
      generatedDir: tmpGen,
      writeManifest: false,
      siteOrigin: 'https://skillpouch.tools.place',
    });

    // At least 50 browse routes (2 home + 16 directories + 32 tasks); 118 once Task-003 adds skills
    assert.ok(emittedRoutes.length >= 50);
    assert.equal(
      emittedRoutes.some((r) => r.includes('/stages/')),
      false,
    );

    const manifestRouteSet = new Set(data.manifest.pages.map((p) => p.routePath));

    for (const lang of ['zh', 'en']) {
      const altLang = lang === 'zh' ? 'en' : 'zh';
      const homeHtml = fs.readFileSync(
        path.join(tmpGen, `${lang}/index.html`),
        'utf8',
      );

      // Shell assertions
      assert.equal(findForbiddenLeak(homeHtml), null);
      assert.doesNotMatch(homeHtml, /vbg-wordmark|vbg-logo|theme-toggle|data-theme=/i);
      assert.match(homeHtml, /class="vbg-skip-link" href="#main"/);
      assert.match(
        homeHtml,
        new RegExp(`class="vbg-custom-brand" href="/${lang}/index\\.html">SkillPouch</a>`),
      );
      assert.match(
        homeHtml,
        new RegExp(`data-lang-switch="header" href="/${altLang}/index\\.html"`),
      );
      assert.match(
        homeHtml,
        new RegExp(`data-lang-switch="footer" href="/${altLang}/index\\.html"`),
      );
      assert.match(homeHtml, /data-mobile-nav/);

      // Home IA: 8 directory cards + 62 searchable items (8 + 16 + 38)
      const dirCardMatches = homeHtml.match(/data-directory-card="D0[1-8]"/g) || [];
      assert.equal(dirCardMatches.length, 8);
      const searchItemMatches = homeHtml.match(/data-search-item/g) || [];
      assert.equal(searchItemMatches.length, 62);

      // Directory page D01
      const d01Html = fs.readFileSync(
        path.join(tmpGen, `${lang}/directories/D01.html`),
        'utf8',
      );
      assert.equal(findForbiddenLeak(d01Html), null);
      assert.match(
        d01Html,
        new RegExp(`href="/${lang}/directories/D01\\.html" aria-current="page" data-active="true"`),
      );
      assert.match(d01Html, /data-task-card="T01"/);
      assert.match(d01Html, /data-task-card="T02"/);

      // Task page T01: 3 in-page stage anchors (#s1, #s2, #s3) and SkillCards
      const t01Html = fs.readFileSync(
        path.join(tmpGen, `${lang}/tasks/T01.html`),
        'utf8',
      );
      assert.equal(findForbiddenLeak(t01Html), null);
      assert.match(t01Html, /href="#s1"/);
      assert.match(t01Html, /href="#s2"/);
      assert.match(t01Html, /href="#s3"/);
      assert.match(t01Html, /id="s1"[\s\S]*data-stage-section="T01\.s1"/);
      assert.match(t01Html, /id="s2"[\s\S]*data-stage-section="T01\.s2"/);
      assert.match(t01Html, /id="s3"[\s\S]*data-stage-section="T01\.s3"/);
      assert.match(t01Html, /target="_blank" rel="noopener noreferrer"/);

      // Verify all internal hrefs in browse & legal pages point to valid manifest routes or /assets/
      for (const relRoute of [
        `/${lang}/index.html`,
        `/${lang}/directories/D01.html`,
        `/${lang}/tasks/T01.html`,
        `/${lang}/privacy.html`,
        `/${lang}/terms.html`,
        `/${lang}/contact.html`,
      ]) {
        const html = fs.readFileSync(
          path.join(tmpGen, relRoute.replace(/^\//, '')),
          'utf8',
        );
        assert.equal(findForbiddenLeak(html), null);
        assert.match(html, new RegExp(`href="/${lang}/privacy\\.html"`));
        assert.match(html, new RegExp(`href="/${lang}/terms\\.html"`));
        assert.match(html, new RegExp(`href="/${lang}/contact\\.html"`));
        const hrefMatches = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        for (const href of hrefMatches) {
          if (
            href.startsWith('https://') ||
            href.startsWith('#') ||
            href.startsWith('mailto:')
          ) {
            continue;
          }
          if (href === '/assets/vercel-brand.css' || href.endsWith('site.css')) {
            continue;
          }
          const cleanPath = href.split('?')[0].split('#')[0];
          assert.equal(
            manifestRouteSet.has(cleanPath),
            true,
            `Broken internal link ${href} on ${relRoute}`,
          );
        }
      }
    }
  } finally {
    fs.rmSync(tmpGen, { recursive: true, force: true });
  }
});

test('SearchBox progressive enhancement filters items and toggles empty state accurately', () => {
  function createMockItem(keywords) {
    return {
      hidden: true,
      getAttribute(attr) {
        return attr === 'data-search-keywords' ? keywords : null;
      },
    };
  }

  let inputHandler = null;
  const mockInput = {
    value: '',
    addEventListener(evt, fn) {
      if (evt === 'input') {
        inputHandler = fn;
      }
    },
  };
  const mockStatus = { textContent: '默认提示' };
  const mockEmpty = { hidden: true };
  const mockList = { hidden: true };
  const mockItems = [
    createMockItem('d01 文档与沟通'),
    createMockItem('t01 邮件与通知 email-drafter'),
    createMockItem('frontend-design 界面方案'),
  ];

  const mockSection = {
    getAttribute(attr) {
      if (attr === 'data-status-default') return '默认提示';
      if (attr === 'data-status-matched') return '找到 {count} 项';
      return null;
    },
    querySelector(sel) {
      if (sel === '[data-search-input]') return mockInput;
      if (sel === '[data-search-status]') return mockStatus;
      if (sel === '[data-search-empty]') return mockEmpty;
      if (sel === '[data-search-results]') return mockList;
      return null;
    },
    querySelectorAll(sel) {
      return sel === '[data-search-item]' ? mockItems : [];
    },
  };

  const mockRoot = {
    querySelector(sel) {
      return sel === '[data-search-root]' ? mockSection : null;
    },
  };

  const controller = initSearchBox(mockRoot);
  assert.ok(controller);
  assert.ok(inputHandler);

  // Match 1 item
  mockInput.value = 'email';
  inputHandler();
  assert.equal(mockList.hidden, false);
  assert.equal(mockEmpty.hidden, true);
  assert.equal(mockItems[0].hidden, true);
  assert.equal(mockItems[1].hidden, false);
  assert.equal(mockStatus.textContent, '找到 1 项');

  // Match 0 items -> show empty state
  mockInput.value = 'nonexistent-xyz';
  inputHandler();
  assert.equal(mockList.hidden, true);
  assert.equal(mockEmpty.hidden, false);
  assert.equal(mockStatus.textContent, '找到 0 项');

  // Clear query -> restore default status and hide results & empty box
  mockInput.value = '   ';
  inputHandler();
  assert.equal(mockList.hidden, true);
  assert.equal(mockEmpty.hidden, true);
  assert.equal(mockStatus.textContent, '默认提示');
});

test('renders explicit empty states when directory has 0 tasks or stage has 0 skills', () => {
  const zhDict = JSON.parse(
    fs.readFileSync(path.join(siteRoot, 'content/i18n/zh.json'), 'utf8'),
  );
  const emptyDirHtml = renderDirectoryMain({
    lang: 'zh',
    dict: zhDict,
    directory: { id: 'D01', title: { zh: '文档与沟通' }, tasks: [] },
  });
  assert.match(emptyDirHtml, /当前目录下暂无已准入任务/);

  const emptyStageHtml = renderTaskMain({
    lang: 'zh',
    dict: zhDict,
    directory: { id: 'D01', title: { zh: '文档与沟通' } },
    task: {
      id: 'T01',
      title: { zh: '邮件与通知' },
      stages: [
        {
          id: 'T01.s1',
          anchorId: 's1',
          shortName: { zh: '明确对象与目的' },
          skillSlugs: [],
        },
      ],
    },
    skillsBySlug: new Map(),
  });
  assert.match(emptyStageHtml, /暂无合格推荐/);
});
