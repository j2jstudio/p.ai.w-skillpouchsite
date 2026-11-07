import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestSiteData } from '../scripts/lib/ingest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

test('ingests real CP2 + XAP-12 datasets with exact 8/16/48/38 counts and 132 manifest routes', () => {
  const defaultResult = ingestSiteData({ siteRoot });
  assert.equal(defaultResult.siteOrigin, 'https://skillpouch.tools.place');

  const result = ingestSiteData({
    siteRoot,
    siteOrigin: 'https://skillpouch.tools.place/',
  });

  assert.equal(result.siteOrigin, 'https://skillpouch.tools.place');
  assert.equal(result.directories.length, 8);
  assert.equal(result.tasks.length, 16);
  assert.equal(result.stages.length, 48);
  assert.equal(result.skills.length, 38);
  assert.equal(result.bilingualComplete, true);

  // Rejected CP2 candidates must never appear
  const slugs = new Set(result.skills.map((s) => s.stableSlug));
  assert.equal(slugs.has('anthropics--knowledge-work-plugins--data-visualization'), false);
  assert.equal(slugs.has('yoli-mi--good-learning-skill--good-learning'), false);

  // Every skill slug must be colon-free and match identityKey
  for (const skill of result.skills) {
    assert.equal(skill.stableSlug.includes(':'), false);
    assert.equal(skill.id, `skill:${skill.stableSlug}`);
    assert.match(skill.upstreamUrl, /^https:\/\//);
    assert.match(skill.revision, /^[0-9a-f]{40}$/);
    assert.match(skill.contentSha256, /^[0-9a-f]{64}$/);
  }

  // Multi-stage skill reverse lookup and whyItems split
  const ecommerce = result.skillsBySlug.get(
    'nexscope-ai--ecommerce-skills--ecommerce-growth-strategy',
  );
  assert.ok(ecommerce);
  assert.deepEqual(ecommerce.stagesBound, [
    'T15.s1',
    'T15.s2',
    'T15.s3',
    'T16.s1',
    'T16.s2',
    'T16.s3',
  ]);
  assert.equal(ecommerce.copy.zh.whyItems.length, 6);
  assert.equal(ecommerce.copy.en.whyItems.length, 6);

  // CC-BY-SA skills already include attribution & share-alike, must not duplicate
  const backwards = result.skillsBySlug.get(
    'garethmanning--education-agent-skills--backwards-design-unit-planner',
  );
  assert.ok(backwards);
  assert.equal(backwards.licenseSpdx, 'CC-BY-SA-4.0');
  assert.equal(backwards.copy.zh.ccBySaNoticeAppended, false);
  assert.equal(backwards.copy.en.ccBySaNoticeAppended, false);

  // Manifest exact inventory: 66 per lang * 2 = 132 content pages (incl. privacy, terms, contact), 0 stage pages
  assert.equal(result.manifest.pages.length, 132);
  const zhPages = result.manifest.pages.filter((p) => p.lang === 'zh');
  const enPages = result.manifest.pages.filter((p) => p.lang === 'en');
  assert.equal(zhPages.length, 66);
  assert.equal(enPages.length, 66);
  assert.equal(
    result.manifest.pages.some((p) => p.routePath.includes('/stages/')),
    false,
  );

  const routeSet = new Set(result.manifest.pages.map((p) => p.routePath));
  for (const page of result.manifest.pages) {
    assert.equal(routeSet.has(page.alternatePath), true);
    assert.equal(page.canonicalUrl, `https://skillpouch.tools.place${page.routePath}`);
  }
});

function createMiniFixture(tmpDir, overrides = {}) {
  const taxonomy = {
    directories: [
      {
        id: 'D01',
        title: { zh: '文档与沟通', en: 'Documents & Communication' },
        taskIds: ['T01'],
      },
    ],
    tasks: [
      {
        id: 'T01',
        directoryId: 'D01',
        title: { zh: '邮件与通知', en: 'Email & Notices' },
        stageIds: ['T01.s1', 'T01.s2', 'T01.s3'],
      },
    ],
    stages: {
      'T01.s1': { zh: '明确对象与目的', en: 'Clarify audience & purpose' },
      'T01.s2': { zh: '起草内容', en: 'Draft the content' },
      'T01.s3': { zh: '修改核对', en: 'Revise & verify' },
    },
  };
  const taxPath = path.join(tmpDir, 'taxonomy.json');
  fs.writeFileSync(taxPath, JSON.stringify(taxonomy, null, 2), 'utf8');

  const sha40 = '9c4c7d5cd2813a8936bf2c9fdb174ea883b85a11';
  const sum64 = '295d567511ea9ef1b91f6f57d4d975e41e3c612a287812e8ce5e745328408c94';

  const cp2Lines = overrides.cp2Lines || [
    'stage,task,domain_bucket,skill,identity_key,status,an,G-I,G-T,G-S,G-U,FS,repo,subpath,revision,sums_hash,license,review_file,notes',
    `T01.s1,T01,产品,alpha,org--repo--alpha,selected,AN2,4.7K,C,542,2026-01-30,"Mar 9, 2026",org/repo,alpha,${sha40},${sum64},${overrides.license || 'MIT'},review.md,`,
    `T01.s2,T01,产品,alpha,org--repo--alpha,selected,,4.7K,C,542,2026-01-30,"Mar 9, 2026",org/repo,alpha,${sha40},${sum64},${overrides.license || 'MIT'},review.md,`,
    `T01.s3,T01,产品,alpha,org--repo--alpha,selected,,4.7K,C,542,2026-01-30,"Mar 9, 2026",org/repo,alpha,${sha40},${sum64},${overrides.license || 'MIT'},review.md,`,
    `T01.s3,T01,产品,bad,org--repo--bad,rejected,AN3,9.0K,C,999,2026-01-30,"Mar 9, 2026",,,,,,review.md,rejected`,
  ];
  const cp2Path = path.join(tmpDir, 'cp2.csv');
  fs.writeFileSync(cp2Path, cp2Lines.join('\n') + '\n', 'utf8');

  const xap12Lines = overrides.xap12Lines || [
    'skill_id,identity_key,name,stages_bound,title_zh,summary_zh,why_recommended_zh,evidence_upstream_url,evidence_review_url,evidence_adoption_url,known_limitations_zh,title_en,summary_en,why_recommended_en,known_limitations_en,reviewed_at,agents_claim_status,repo,subpath,revision,license_spdx,domain_bucket,copy_status',
    `skill:org--repo--alpha,org--repo--alpha,alpha,"T01.s1,T01.s2,T01.s3",${overrides.titleZh || '测试技能'},${overrides.summaryZh || '测试中文简介'},"T01.s1 · 一 | T01.s2 · 二 | T01.s3 · 三",${overrides.upstreamUrl || 'https://github.com/org/repo/tree/' + sha40 + '/alpha'},,,${overrides.limitZh ?? '常规限制说明'},${overrides.titleEn ?? 'Alpha Skill'},${overrides.summaryEn ?? 'Clean English summary'},"T01.s1 · One | T01.s2 · Two | T01.s3 · Three",${overrides.limitEn ?? 'Standard limitation note'},2026-10-28,unverified,org/repo,alpha,${sha40},${overrides.license || 'MIT'},产品,filled`,
  ];
  const xap12Path = path.join(tmpDir, 'xap12.csv');
  fs.writeFileSync(xap12Path, xap12Lines.join('\n') + '\n', 'utf8');

  return {
    siteRoot,
    taxonomyPath: taxPath,
    cp2CsvPath: cp2Path,
    xap12CsvPath: xap12Path,
    expectedCounts: { directories: 1, tasks: 1, stages: 3, skills: 1 },
  };
}

test('rejects forbidden research markers (G-I, AN2, A1, popularity scores) in public copy', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ingest-leak-'));
  try {
    for (const leak of ['含 G-I 指标', '裁决 AN2 放行', '符合 A3 门槛', '研究热度分 98']) {
      const opts = createMiniFixture(tmpDir, { summaryZh: leak });
      assert.throws(() => ingestSiteData(opts), /forbidden|禁填/i);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('rejects non-selected / rejected skills sneaking into XAP-12 public CSV', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ingest-rej-'));
  try {
    const base = createMiniFixture(tmpDir);
    const extraLine =
      'skill:org--repo--bad,org--repo--bad,bad,T01.s3,撤下技能,简介,T01.s3 · 三,https://github.com/org/repo,,,限制,Bad,Summary,T01.s3 · Three,Limit,2026-10-28,unverified,org/repo,bad,9c4c7d5cd2813a8936bf2c9fdb174ea883b85a11,MIT,产品,filled';
    fs.appendFileSync(base.xap12CsvPath, extraLine + '\n', 'utf8');
    base.expectedCounts.skills = 2;
    assert.throws(() => ingestSiteData(base), /rejected|not in CP2 selected/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('appends mandatory CC-BY-SA notice when missing and marks EN pending without copying ZH', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ingest-cc-'));
  try {
    const opts = createMiniFixture(tmpDir, {
      license: 'CC-BY-SA-4.0',
      limitZh: '仅输出框架，需人工核对。',
      summaryEn: 'TBD',
      limitEn: '',
    });
    const res = ingestSiteData(opts);
    assert.equal(res.bilingualComplete, false);
    const skill = res.skills[0];
    assert.equal(skill.copy.zh.ccBySaNoticeAppended, true);
    assert.match(skill.copy.zh.knownLimitations, /署名/);
    assert.match(skill.copy.zh.knownLimitations, /相同方式共享/);

    assert.equal(skill.copy.en.isSummaryPending, true);
    assert.equal(skill.copy.en.summary, '');
    assert.equal(skill.copy.en.ccBySaNoticeAppended, true);
    assert.match(skill.copy.en.knownLimitations, /attribution/i);
    assert.match(skill.copy.en.knownLimitations, /share alike/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('throws when ingested counts do not match expected 8/16/48/34 contract', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ingest-counts-'));
  try {
    const opts = createMiniFixture(tmpDir);
    // Default expectedCounts is 8/16/48/34, so 1/1/3/1 fixture must fail when using default counts
    assert.throws(
      () =>
        ingestSiteData({
          siteRoot,
          taxonomyPath: opts.taxonomyPath,
          cp2CsvPath: opts.cp2CsvPath,
          xap12CsvPath: opts.xap12CsvPath,
        }),
      /Directory count mismatch/i,
    );
    assert.throws(
      () =>
        ingestSiteData({
          ...opts,
          expectedCounts: { directories: 1, tasks: 1, stages: 3, skills: 34 },
        }),
      /Skill count mismatch/i,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
