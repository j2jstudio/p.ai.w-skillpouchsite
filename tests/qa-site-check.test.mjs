import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { runQaSiteCheck } from '../scripts/qa-site-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

test('full production build passes all 8 dimensions of qa-site-check and tampered dist fails', () => {
  // Build fresh dist/ first
  execFileSync(process.execPath, [path.join(siteRoot, 'scripts/build-pages.mjs')], {
    cwd: siteRoot,
    stdio: 'pipe',
  });
  execFileSync(
    path.join(siteRoot, 'node_modules/.bin/vite'),
    ['build'],
    {
      cwd: siteRoot,
      stdio: 'pipe',
    },
  );

  const distDir = path.join(siteRoot, 'dist');
  const cleanReport = runQaSiteCheck({ siteRoot, distDir });
  assert.equal(
    cleanReport.ok,
    true,
    `Expected clean dist/ to pass QA, got errors:\n${cleanReport.errors.join('\n')}`,
  );
  assert.equal(cleanReport.stats.contentHtmlCount, 132);
  assert.equal(cleanReport.stats.sitemapUrlCount, 132);
  assert.equal(cleanReport.stats.jsonLdParsedCount, 78);

  // Helper to clone dist/ into a temp dir, mutate, and assert QA catches the violation
  function assertTamperFails(label, mutateFn, expectedPattern) {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-qa-tamper-'));
    try {
      copyDirRecursive(distDir, tmpDist);
      mutateFn(tmpDist);
      const report = runQaSiteCheck({ siteRoot, distDir: tmpDist });
      assert.equal(report.ok, false, `Expected tamper "${label}" to fail QA`);
      assert.equal(
        report.errors.some((e) => expectedPattern.test(e)),
        true,
        `Expected tamper "${label}" errors to match ${expectedPattern}, got:\n${report.errors.join('\n')}`,
      );
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  }

  // 1. Forbidden research leak (G-I / AN2 / popularity)
  assertTamperFails(
    'forbidden G-I token',
    (tmpDist) => {
      const target = path.join(tmpDist, 'zh/index.html');
      const html = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(target, html.replace('</main>', '<p>指标 G-I 99</p></main>'), 'utf8');
    },
    /G-I|forbidden|禁填/i,
  );

  // 2. Vercel wordmark / brand violation
  assertTamperFails(
    'vbg-wordmark brand violation',
    (tmpDist) => {
      const target = path.join(tmpDist, 'en/index.html');
      const html = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(
        target,
        html.replace('SkillPouch', '<span class="vbg-wordmark"></span>SkillPouch'),
        'utf8',
      );
    },
    /wordmark/i,
  );

  // 3. Extra stage HTML page (/stages/T01.s1.html)
  assertTamperFails(
    'forbidden standalone stage page',
    (tmpDist) => {
      const stageDir = path.join(tmpDist, 'zh/stages');
      fs.mkdirSync(stageDir, { recursive: true });
      fs.writeFileSync(path.join(stageDir, 'T01.s1.html'), '<!doctype html><html lang="zh-Hans"></html>', 'utf8');
    },
    /stage|132|unexpected/i,
  );

  // 4. Missing EN counterpart page
  assertTamperFails(
    'missing EN counterpart',
    (tmpDist) => {
      fs.unlinkSync(path.join(tmpDist, 'en/tasks/T02.html'));
    },
    /counterpart|parity|132|missing/i,
  );

  // 5. Fake clickable install deep link / enabled install CTA
  assertTamperFails(
    'fake install deep link',
    (tmpDist) => {
      const target = path.join(
        tmpDist,
        'en/skills/claude-office-skills--skills--email-drafter.html',
      );
      const html = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(
        target,
        html.replace('disabled aria-disabled="true"', 'data-href="skillpouch://install/email-drafter"'),
        'utf8',
      );
    },
    /disabled|skillpouch:\/\/|install/i,
  );

  // 6. Broken internal link
  assertTamperFails(
    'broken internal link',
    (tmpDist) => {
      const target = path.join(tmpDist, 'zh/directories/D01.html');
      const html = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(
        target,
        html.replace('/zh/tasks/T01.html', '/zh/tasks/T99.html'),
        'utf8',
      );
    },
    /T99\.html|internal link/i,
  );

  // 7. Invalid JSON-LD
  assertTamperFails(
    'invalid JSON-LD payload',
    (tmpDist) => {
      const target = path.join(tmpDist, 'zh/index.html');
      const html = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(
        target,
        html.replace(
          /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
          '<script type="application/ld+json">{broken json</script>',
        ),
        'utf8',
      );
    },
    /JSON-LD/i,
  );
});

test('vite dev server serves CSS, JS, and bilingual legal/contact pages with HTTP 200', async () => {
  const server = await createServer({
    configFile: path.join(siteRoot, 'vite.config.mjs'),
    logLevel: 'error',
  });
  await server.listen(0);
  try {
    const port = server.config.server.port;
    for (const [route, accept, expectedSnippet] of [
      ['/zh/index.html', 'text/html', 'SkillPouch'],
      ['/zh/privacy.html', 'text/html', '隐私政策'],
      ['/zh/terms.html', 'text/html', '使用协议'],
      ['/zh/contact.html', 'text/html', '联系我们'],
      ['/en/privacy.html', 'text/html', 'Privacy Policy'],
      ['/en/terms.html', 'text/html', 'Terms of Use'],
      ['/en/contact.html', 'text/html', 'Contact Us'],
      ['/src/styles/site.css', 'text/css,*/*;q=0.1', '.vbg-custom-brand'],
      ['/src/client/site-enhance.js', '*/*', 'initSiteEnhancements'],
      ['/assets/vercel-brand.css', 'text/css,*/*;q=0.1', '--vbg-surface-primary'],
    ]) {
      const res = await fetch(`http://localhost:${port}${route}`, {
        headers: { Accept: accept },
      });
      assert.equal(res.status, 200, `Expected 200 for ${route} in dev server, got ${res.status}`);
      const body = await res.text();
      assert.ok(
        body.includes(expectedSnippet),
        `Expected ${route} body to include "${expectedSnippet}"`,
      );
    }
  } finally {
    await server.close();
  }
});
