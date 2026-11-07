import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SITE_ORIGIN = 'https://skillpouch.tools.place';

const FORBIDDEN_PATTERNS = [
  { regex: /\bG-[ISTU]\b/, reason: 'forbidden research metric token (G-I/G-S/G-T/G-U)' },
  { regex: /\bAN[0-9]+\b/, reason: 'forbidden research ruling code (AN*)' },
  { regex: /\bA[1-5]\b/, reason: 'forbidden internal rubric code (A1-A5)' },
  { regex: /热度/, reason: 'forbidden popularity/heat term (热度*)' },
  {
    regex: /snapshots\/|cp2-an-rulings|qa-review-[a-z0-9-]+/i,
    reason: 'forbidden internal research path',
  },
  {
    regex: /vbg-wordmark|vercel-wordmark|vercel-logo\.svg|official vercel/i,
    reason: 'forbidden Vercel wordmark/identity reference',
  },
];

export function findForbiddenLeak(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  for (const { regex, reason } of FORBIDDEN_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      return { token: match[0], reason };
    }
  }
  return null;
}

export function assertNoForbiddenLeak(text, context) {
  const leak = findForbiddenLeak(text);
  if (leak) {
    throw new Error(
      `[ingest] 禁填拦截 (${leak.reason}): "${leak.token}" found in ${context}`,
    );
  }
}

export function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"' && content[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((cell) => cell !== '')) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((cell) => cell !== '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return [];
  }
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    for (let idx = 0; idx < headers.length; idx += 1) {
      obj[headers[idx]] = (cells[idx] ?? '').trim();
    }
    return obj;
  });
}

function normalizeOrigin(rawOrigin) {
  const trimmed = (rawOrigin || DEFAULT_SITE_ORIGIN).trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(trimmed)) {
    throw new Error(`[ingest] SITE_ORIGIN must be an https:// origin without path: ${rawOrigin}`);
  }
  return trimmed;
}

function cleanPublicField(rawValue) {
  const val = (rawValue ?? '').trim();
  if (!val || val === 'TBD' || val === 'TBD-public-copy') {
    return '';
  }
  return val;
}

function splitWhyRecommended(rawWhy) {
  const cleaned = cleanPublicField(rawWhy);
  if (!cleaned) {
    return [];
  }
  return cleaned
    .split(/\s*\|\s*/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasCcBySaEquivalent(text, lang) {
  if (!text) {
    return false;
  }
  if (lang === 'zh') {
    return text.includes('署名') && text.includes('相同方式共享');
  }
  const lower = text.toLowerCase();
  return lower.includes('attribution') && (lower.includes('share alike') || lower.includes('share-alike'));
}

function applyCcBySaRule(knownLimitations, licenseSpdx, lang, template) {
  const isCcBySa = /^CC-BY-SA/i.test(licenseSpdx);
  if (!isCcBySa) {
    return { text: knownLimitations, appended: false };
  }
  if (hasCcBySaEquivalent(knownLimitations, lang)) {
    return { text: knownLimitations, appended: false };
  }
  const notice = template.replace('{licenseSpdx}', licenseSpdx);
  const combined = knownLimitations ? `${knownLimitations} ${notice}` : notice;
  return { text: combined, appended: true };
}

function validateHttpsUrl(url, context) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[ingest] Invalid URL in ${context}: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`[ingest] URL must use https:// in ${context}: ${url}`);
  }
  assertNoForbiddenLeak(url, context);
}

const VENDORED_CP2 = 'content/sources/cp2-final-list-xap45-merged-20261102.csv';
const VENDORED_XAP12 = 'content/sources/xap12-public-fields-by-skill-en-20261102.csv';
const MONOREPO_CP2 =
  'SkillPouch/docs/research/skills/v2/work/s3w-2026-10-29/xap-curation-delta/cp2-final-list-xap45-merged-20261102.csv';
const MONOREPO_XAP12 =
  'SkillPouch/docs/research/skills/v2/work/s3w-2026-10-29/xap12/xap12-public-fields-by-skill-en-20261102.csv';

function resolveCuratedCsv(siteRoot, repoRoot, vendoredRelative, monorepoRelative) {
  const monorepoPath = path.join(repoRoot, monorepoRelative);
  if (fs.existsSync(monorepoPath)) {
    return monorepoPath;
  }
  return path.join(siteRoot, vendoredRelative);
}

export function ingestSiteData(options = {}) {
  const siteRoot = options.siteRoot
    ? path.resolve(options.siteRoot)
    : path.resolve(process.cwd());
  const repoRoot = path.resolve(siteRoot, '..');

  const cp2CsvPath =
    options.cp2CsvPath ||
    resolveCuratedCsv(siteRoot, repoRoot, VENDORED_CP2, MONOREPO_CP2);
  const xap12CsvPath =
    options.xap12CsvPath ||
    resolveCuratedCsv(siteRoot, repoRoot, VENDORED_XAP12, MONOREPO_XAP12);
  const taxonomyPath =
    options.taxonomyPath || path.join(siteRoot, 'content/taxonomy.json');
  const i18nZhPath =
    options.i18nZhPath || path.join(siteRoot, 'content/i18n/zh.json');
  const i18nEnPath =
    options.i18nEnPath || path.join(siteRoot, 'content/i18n/en.json');

  const expectedCounts = options.expectedCounts || {
    directories: 8,
    tasks: 16,
    stages: 48,
    skills: 38,
  };

  const siteOrigin = normalizeOrigin(options.siteOrigin || process.env.SITE_ORIGIN);

  const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));
  const i18n = {
    zh: JSON.parse(fs.readFileSync(i18nZhPath, 'utf8')),
    en: JSON.parse(fs.readFileSync(i18nEnPath, 'utf8')),
  };

  // Scan taxonomy and i18n strings for forbidden leaks
  assertNoForbiddenLeak(JSON.stringify(taxonomy), 'content/taxonomy.json');
  assertNoForbiddenLeak(JSON.stringify(i18n.zh), 'content/i18n/zh.json');
  assertNoForbiddenLeak(JSON.stringify(i18n.en), 'content/i18n/en.json');

  const cp2Rows = parseCsv(fs.readFileSync(cp2CsvPath, 'utf8'));
  const xap12Rows = parseCsv(fs.readFileSync(xap12CsvPath, 'utf8'));

  const canonicalStageOrder = [];
  for (const task of taxonomy.tasks) {
    for (const stageId of task.stageIds) {
      if (!taxonomy.stages[stageId]) {
        throw new Error(`[ingest] Stage ${stageId} missing from taxonomy.stages`);
      }
      canonicalStageOrder.push(stageId);
    }
  }
  const stageOrderIndex = new Map(
    canonicalStageOrder.map((stageId, idx) => [stageId, idx]),
  );

  const rejectedKeys = new Set();
  const selectedByStage = new Map();
  const cp2SkillMeta = new Map();

  for (const row of cp2Rows) {
    const status = row.status;
    const identityKey = row.identity_key;
    if (!identityKey) {
      throw new Error(`[ingest] Empty identity_key in CP2 row for stage ${row.stage}`);
    }
    if (status !== 'selected') {
      rejectedKeys.add(identityKey);
      continue;
    }

    if (!stageOrderIndex.has(row.stage)) {
      throw new Error(`[ingest] Unknown stage in CP2 selected row: ${row.stage}`);
    }
    if (!selectedByStage.has(row.stage)) {
      selectedByStage.set(row.stage, []);
    }
    selectedByStage.get(row.stage).push(identityKey);

    if (!cp2SkillMeta.has(identityKey)) {
      cp2SkillMeta.set(identityKey, {
        identityKey,
        name: row.skill,
        repo: row.repo,
        subpath: row.subpath,
        revision: row.revision,
        contentSha256: row.sums_hash,
        licenseSpdx: row.license,
        stages: new Set([row.stage]),
      });
    } else {
      const existing = cp2SkillMeta.get(identityKey);
      if (
        existing.revision !== row.revision ||
        existing.contentSha256 !== row.sums_hash ||
        existing.licenseSpdx !== row.license
      ) {
        throw new Error(
          `[ingest] Inconsistent CP2 metadata across stages for ${identityKey}`,
        );
      }
      existing.stages.add(row.stage);
    }
  }

  // Ensure every taxonomy stage has at least one selected skill
  for (const stageId of canonicalStageOrder) {
    const bound = selectedByStage.get(stageId) || [];
    if (bound.length === 0) {
      throw new Error(`[ingest] Stage ${stageId} has zero selected skills in CP2`);
    }
  }

  // Cross-check XAP-12 rows against CP2 selected set
  const xap12Map = new Map();
  for (const row of xap12Rows) {
    const key = row.identity_key;
    if (!key) {
      throw new Error('[ingest] Empty identity_key in XAP-12 CSV');
    }
    if (rejectedKeys.has(key) && !cp2SkillMeta.has(key)) {
      throw new Error(`[ingest] Rejected CP2 skill "${key}" found in XAP-12 CSV`);
    }
    if (!cp2SkillMeta.has(key)) {
      throw new Error(`[ingest] Skill "${key}" in XAP-12 is not in CP2 selected set`);
    }
    if (xap12Map.has(key)) {
      throw new Error(`[ingest] Duplicate identity_key in XAP-12 CSV: ${key}`);
    }
    xap12Map.set(key, row);
  }

  for (const key of cp2SkillMeta.keys()) {
    if (!xap12Map.has(key)) {
      throw new Error(`[ingest] CP2 selected skill "${key}" is missing from XAP-12 CSV`);
    }
  }

  let bilingualComplete = true;
  const skills = [];
  const skillsBySlug = new Map();

  for (const [key, row] of xap12Map.entries()) {
    const cp2 = cp2SkillMeta.get(key);
    if (/[/:\\\s]/.test(key)) {
      throw new Error(`[ingest] Invalid stableSlug characters in identity_key: ${key}`);
    }
    const expectedId = `skill:${key}`;
    if (row.skill_id !== expectedId) {
      throw new Error(
        `[ingest] skill_id mismatch for ${key}: expected ${expectedId}, got ${row.skill_id}`,
      );
    }
    if (!/^skill:[a-zA-Z0-9._-]+(--[a-zA-Z0-9._-]+)+$/.test(row.skill_id)) {
      throw new Error(`[ingest] skill_id fails XAP-10 pattern: ${row.skill_id}`);
    }
    if (!/^[0-9a-f]{40}$/.test(row.revision) || row.revision !== cp2.revision) {
      throw new Error(`[ingest] Invalid or mismatched revision for ${key}`);
    }
    if (!/^[0-9a-f]{64}$/.test(cp2.contentSha256)) {
      throw new Error(`[ingest] Invalid contentSha256 in CP2 for ${key}`);
    }
    if (!row.license_spdx || row.license_spdx !== cp2.licenseSpdx) {
      throw new Error(
        `[ingest] License mismatch between CP2 (${cp2.licenseSpdx}) and XAP-12 (${row.license_spdx}) for ${key}`,
      );
    }
    if (!['unverified', 'spot_checked', 'n/a'].includes(row.agents_claim_status)) {
      throw new Error(
        `[ingest] Invalid agents_claim_status "${row.agents_claim_status}" for ${key}`,
      );
    }

    const stagesBound = [...cp2.stages].sort(
      (a, b) => stageOrderIndex.get(a) - stageOrderIndex.get(b),
    );
    const csvStages = row.stages_bound
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort((a, b) => (stageOrderIndex.get(a) ?? 999) - (stageOrderIndex.get(b) ?? 999));

    if (stagesBound.join(',') !== csvStages.join(',')) {
      throw new Error(
        `[ingest] stages_bound mismatch for ${key}: CP2=${stagesBound.join(',')} vs XAP12=${csvStages.join(',')}`,
      );
    }

    validateHttpsUrl(row.evidence_upstream_url, `${key}.evidence_upstream_url`);
    const evidenceLinks = [
      {
        kind: 'upstream',
        url: row.evidence_upstream_url,
        retrievedAt: row.reviewed_at || '',
        synthesized: false,
      },
    ];
    if (row.evidence_review_url) {
      validateHttpsUrl(row.evidence_review_url, `${key}.evidence_review_url`);
      evidenceLinks.push({
        kind: 'review',
        url: row.evidence_review_url,
        retrievedAt: row.reviewed_at || '',
        synthesized: false,
      });
    }
    if (row.evidence_adoption_url) {
      validateHttpsUrl(row.evidence_adoption_url, `${key}.evidence_adoption_url`);
      evidenceLinks.push({
        kind: 'adoption',
        url: row.evidence_adoption_url,
        retrievedAt: row.reviewed_at || '',
        synthesized: false,
      });
    }

    const rawTitleZh = cleanPublicField(row.title_zh);
    const rawSummaryZh = cleanPublicField(row.summary_zh);
    const whyItemsZh = splitWhyRecommended(row.why_recommended_zh);
    const rawLimitZh = cleanPublicField(row.known_limitations_zh);

    const rawTitleEn = cleanPublicField(row.title_en);
    const rawSummaryEn = cleanPublicField(row.summary_en);
    const whyItemsEn = splitWhyRecommended(row.why_recommended_en);
    const rawLimitEn = cleanPublicField(row.known_limitations_en);

    for (const [fieldLabel, fieldVal] of [
      ['title_zh', rawTitleZh],
      ['summary_zh', rawSummaryZh],
      ['why_recommended_zh', whyItemsZh.join(' | ')],
      ['known_limitations_zh', rawLimitZh],
      ['title_en', rawTitleEn],
      ['summary_en', rawSummaryEn],
      ['why_recommended_en', whyItemsEn.join(' | ')],
      ['known_limitations_en', rawLimitEn],
    ]) {
      assertNoForbiddenLeak(fieldVal, `${key}.${fieldLabel}`);
    }

    const isZhComplete = Boolean(
      rawTitleZh && rawSummaryZh && whyItemsZh.length > 0 && rawLimitZh,
    );
    const isEnComplete = Boolean(
      rawTitleEn && rawSummaryEn && whyItemsEn.length > 0 && rawLimitEn,
    );
    if (!isZhComplete || !isEnComplete) {
      bilingualComplete = false;
    }

    const limitZhResult = applyCcBySaRule(
      rawLimitZh,
      row.license_spdx,
      'zh',
      i18n.zh.skill.ccBySaTemplate,
    );
    const limitEnResult = applyCcBySaRule(
      rawLimitEn,
      row.license_spdx,
      'en',
      i18n.en.skill.ccBySaTemplate,
    );

    const primaryStageId = stagesBound[0];
    const primaryTaskId = primaryStageId.split('.')[0];

    const skillEntity = {
      id: row.skill_id,
      identityKey: key,
      stableSlug: key,
      name: row.name,
      repo: row.repo,
      subpath: row.subpath,
      revision: row.revision,
      contentSha256: cp2.contentSha256,
      licenseSpdx: row.license_spdx,
      upstreamUrl: row.evidence_upstream_url,
      evidenceLinks,
      reviewedAt: row.reviewed_at || '',
      agentsClaimStatus: row.agents_claim_status,
      supportedAgents: [],
      stagesBound,
      primaryTaskId,
      copy: {
        zh: {
          title: rawTitleZh || row.name || i18n.zh.skill.empty.untitled,
          isTitlePending: !rawTitleZh,
          summary: rawSummaryZh,
          isSummaryPending: !rawSummaryZh,
          whyItems: whyItemsZh,
          isWhyPending: whyItemsZh.length === 0,
          knownLimitations: limitZhResult.text,
          isLimitationsPending: !rawLimitZh && !limitZhResult.appended,
          ccBySaNoticeAppended: limitZhResult.appended,
        },
        en: {
          title: rawTitleEn || row.name || i18n.en.skill.empty.untitled,
          isTitlePending: !rawTitleEn,
          summary: rawSummaryEn,
          isSummaryPending: !rawSummaryEn,
          whyItems: whyItemsEn,
          isWhyPending: whyItemsEn.length === 0,
          knownLimitations: limitEnResult.text,
          isLimitationsPending: !rawLimitEn && !limitEnResult.appended,
          ccBySaNoticeAppended: limitEnResult.appended,
        },
      },
    };

    skills.push(skillEntity);
    skillsBySlug.set(key, skillEntity);
  }

  // Enrich stages, tasks, and directories with bound skill references
  const stages = canonicalStageOrder.map((stageId) => {
    const taskId = stageId.split('.')[0];
    const shortKey = stageId.split('.')[1];
    const boundKeys = selectedByStage.get(stageId) || [];
    return {
      id: stageId,
      taskId,
      anchorId: shortKey,
      shortName: taxonomy.stages[stageId],
      skillSlugs: boundKeys,
    };
  });
  const stagesById = new Map(stages.map((s) => [s.id, s]));

  const tasks = taxonomy.tasks.map((taskDef) => {
    const taskStages = taskDef.stageIds.map((sid) => stagesById.get(sid));
    const uniqueSkillSlugs = [
      ...new Set(taskStages.flatMap((st) => st.skillSlugs)),
    ];
    return {
      id: taskDef.id,
      directoryId: taskDef.directoryId,
      title: taskDef.title,
      stages: taskStages,
      skillSlugs: uniqueSkillSlugs,
      skillCount: uniqueSkillSlugs.length,
    };
  });
  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  const directories = taxonomy.directories.map((dirDef) => {
    const dirTasks = dirDef.taskIds.map((tid) => {
      const t = tasksById.get(tid);
      if (!t) {
        throw new Error(`[ingest] Task ${tid} referenced in ${dirDef.id} not found`);
      }
      return t;
    });
    const uniqueSkillSlugs = [
      ...new Set(dirTasks.flatMap((t) => t.skillSlugs)),
    ];
    return {
      id: dirDef.id,
      title: dirDef.title,
      tasks: dirTasks,
      taskCount: dirTasks.length,
      skillCount: uniqueSkillSlugs.length,
    };
  });
  const directoriesById = new Map(directories.map((d) => [d.id, d]));

  if (directories.length !== expectedCounts.directories) {
    throw new Error(
      `[ingest] Directory count mismatch: expected ${expectedCounts.directories}, got ${directories.length}`,
    );
  }
  if (tasks.length !== expectedCounts.tasks) {
    throw new Error(
      `[ingest] Task count mismatch: expected ${expectedCounts.tasks}, got ${tasks.length}`,
    );
  }
  if (stages.length !== expectedCounts.stages) {
    throw new Error(
      `[ingest] Stage count mismatch: expected ${expectedCounts.stages}, got ${stages.length}`,
    );
  }
  if (skills.length !== expectedCounts.skills) {
    throw new Error(
      `[ingest] Skill count mismatch: expected ${expectedCounts.skills}, got ${skills.length}`,
    );
  }

  // Build page-manifest covering all 59 * 2 = 118 content pages
  const langs = ['zh', 'en'];
  const pages = [];

  for (const lang of langs) {
    const altLang = lang === 'zh' ? 'en' : 'zh';
    const dict = i18n[lang];

    // 1. Home
    pages.push({
      lang,
      htmlLang: dict.htmlLang,
      ogLocale: dict.ogLocale,
      ogLocaleAlternate: dict.ogLocaleAlternate,
      pageType: 'home',
      entityId: 'home',
      routePath: `/${lang}/index.html`,
      alternatePath: `/${altLang}/index.html`,
      xDefaultPath: '/zh/index.html',
      canonicalUrl: `${siteOrigin}/${lang}/index.html`,
      title: dict.home.seoTitle,
      description: dict.home.seoDescription,
    });

    // 2. Directories (8)
    for (const dir of directories) {
      const routePath = `/${lang}/directories/${dir.id}.html`;
      const alternatePath = `/${altLang}/directories/${dir.id}.html`;
      pages.push({
        lang,
        htmlLang: dict.htmlLang,
        ogLocale: dict.ogLocale,
        ogLocaleAlternate: dict.ogLocaleAlternate,
        pageType: 'directory',
        entityId: dir.id,
        routePath,
        alternatePath,
        xDefaultPath: `/zh/directories/${dir.id}.html`,
        canonicalUrl: `${siteOrigin}${routePath}`,
        title: dict.directory.seoTitleTemplate
          .replace('{title}', dir.title[lang])
          .replace('{id}', dir.id),
        description: dict.directory.seoDescriptionTemplate
          .replace('{title}', dir.title[lang])
          .replace('{taskCount}', String(dir.taskCount)),
      });
    }

    // 3. Tasks (16)
    for (const task of tasks) {
      const dir = directoriesById.get(task.directoryId);
      const stageNames = task.stages.map((s) => s.shortName[lang]).join(' / ');
      const routePath = `/${lang}/tasks/${task.id}.html`;
      const alternatePath = `/${altLang}/tasks/${task.id}.html`;
      pages.push({
        lang,
        htmlLang: dict.htmlLang,
        ogLocale: dict.ogLocale,
        ogLocaleAlternate: dict.ogLocaleAlternate,
        pageType: 'task',
        entityId: task.id,
        routePath,
        alternatePath,
        xDefaultPath: `/zh/tasks/${task.id}.html`,
        canonicalUrl: `${siteOrigin}${routePath}`,
        title: dict.task.seoTitleTemplate
          .replace('{title}', task.title[lang])
          .replace('{id}', task.id)
          .replace('{directoryTitle}', dir.title[lang]),
        description: dict.task.seoDescriptionTemplate
          .replace('{stages}', stageNames)
          .replace('{title}', task.title[lang]),
      });
    }

    // 4. Skills (38)
    for (const skill of skills) {
      const copy = skill.copy[lang];
      const routePath = `/${lang}/skills/${skill.stableSlug}.html`;
      const alternatePath = `/${altLang}/skills/${skill.stableSlug}.html`;
      const desc =
        copy.summary ||
        dict.skill.seoDescriptionFallbackTemplate.replace('{name}', skill.name);
      pages.push({
        lang,
        htmlLang: dict.htmlLang,
        ogLocale: dict.ogLocale,
        ogLocaleAlternate: dict.ogLocaleAlternate,
        pageType: 'skill',
        entityId: skill.id,
        stableSlug: skill.stableSlug,
        routePath,
        alternatePath,
        xDefaultPath: `/zh/skills/${skill.stableSlug}.html`,
        canonicalUrl: `${siteOrigin}${routePath}`,
        title: dict.skill.seoTitleTemplate
          .replace('{title}', copy.title)
          .replace('{name}', skill.name),
        description: desc,
      });
    }

    // 5. Standard site pages: privacy, terms, contact (3)
    for (const legalSlug of ['privacy', 'terms', 'contact']) {
      const legalCopy = dict.legal?.pages?.[legalSlug];
      if (!legalCopy) {
        throw new Error(
          `[ingest] Missing legal page definition "${legalSlug}" in i18n.${lang}`,
        );
      }
      const routePath = `/${lang}/${legalSlug}.html`;
      const alternatePath = `/${altLang}/${legalSlug}.html`;
      pages.push({
        lang,
        htmlLang: dict.htmlLang,
        ogLocale: dict.ogLocale,
        ogLocaleAlternate: dict.ogLocaleAlternate,
        pageType: 'legal',
        entityId: legalSlug,
        routePath,
        alternatePath,
        xDefaultPath: `/zh/${legalSlug}.html`,
        canonicalUrl: `${siteOrigin}${routePath}`,
        title: legalCopy.seoTitle,
        description: legalCopy.seoDescription,
      });
    }
  }

  const manifest = {
    schemaVersion: '1.0.0',
    sourceReleaseSet: 'cp2-final-list-xap45-merged-20261102@108f873',
    siteOrigin,
    bilingualComplete,
    counts: {
      directories: directories.length,
      tasks: tasks.length,
      stages: stages.length,
      skills: skills.length,
      contentPagesPerLang: pages.length / 2,
      contentPagesTotal: pages.length,
    },
    pages,
  };

  return {
    siteOrigin,
    bilingualComplete,
    i18n,
    taxonomy,
    directories,
    directoriesById,
    tasks,
    tasksById,
    stages,
    stagesById,
    skills,
    skillsBySlug,
    rejectedKeys: [...rejectedKeys],
    manifest,
  };
}

export function writePageManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}
