import fs from 'node:fs';
import path from 'node:path';
import { ingestSiteData, findForbiddenLeak } from './ingest.mjs';
import {
  computeSha256Hex,
  formatSha256Sidecar,
  signCatalogueBytes,
  TEST_ONLY_SIGNATURE_PLACEHOLDER,
} from './sign-catalogue.mjs';

export class CatalogueValidationError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = 'CatalogueValidationError';
    this.code = code;
  }
}

function canonicalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        sorted[key] = canonicalizeValue(value[key]);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Deterministic Canonical JSON serialization (sorted object keys, 2-space indent, trailing LF).
 */
export function serializeCanonicalJson(value) {
  return `${JSON.stringify(canonicalizeValue(value), null, 2)}\n`;
}

function makeLocalizedString(zhText, enText) {
  const i18n = {};
  if (zhText && zhText.trim()) {
    i18n['zh-Hans'] = zhText.trim();
  }
  if (enText && enText.trim()) {
    i18n.en = enText.trim();
  }
  const defaultLang = i18n['zh-Hans'] ? 'zh-Hans' : Object.keys(i18n)[0] || 'en';
  return {
    default: defaultLang,
    i18n,
  };
}

function resolveEvidenceLabel(kind, i18nDicts) {
  const keyMap = {
    upstream: 'upstreamDefault',
    review: 'reviewDefault',
    adoption: 'adoptionDefault',
    other: 'otherDefault',
  };
  const labelKey = keyMap[kind] || 'otherDefault';
  const zhLabel = i18nDicts.zh?.skill?.evidenceLabels?.[labelKey] || kind;
  const enLabel = i18nDicts.en?.skill?.evidenceLabels?.[labelKey] || kind;
  return makeLocalizedString(zhLabel, enLabel);
}

/**
 * Build an in-memory `CatalogueDocument` from the shared `skillpouch-site` source of truth.
 */
export function buildCatalogueDocumentFromSiteData(siteData, options = {}) {
  const schemaVersion = options.schemaVersion || '1.0.0';
  const catalogueVersion = options.catalogueVersion || '2026.11.0';
  const releaseSequence = options.releaseSequence ?? 1;
  const minimumAppVersion = options.minimumAppVersion || '1.0.0';
  const generatedAt = options.generatedAt || new Date().toISOString();
  const withdrawals = options.withdrawals || [];
  const changelogSummary =
    options.changelogSummary ||
    makeLocalizedString(
      '同步最新策展精选目录（8 大目录 / 16 项任务 / 48 个阶段 / 38 个精选技能）。',
      'Synced curated catalogue release (8 directories / 16 tasks / 48 stages / 38 curated skills).',
    );

  const directories = siteData.directories.map((dir, index) => ({
    id: dir.id,
    sortOrder: index + 1,
    taskIds: [...dir.tasks.map((task) => task.id)],
    title: makeLocalizedString(dir.title.zh, dir.title.en),
  }));

  const tasks = [];
  for (const dir of siteData.directories) {
    dir.tasks.forEach((task, indexInDir) => {
      tasks.push({
        directoryId: task.directoryId,
        id: task.id,
        sortOrder: indexInDir + 1,
        stageIds: task.stages.map((st) => st.id),
        status: 'active',
        title: makeLocalizedString(task.title.zh, task.title.en),
      });
    });
  }

  const stages = [];
  for (const task of siteData.tasks) {
    task.stages.forEach((st, indexInTask) => {
      stages.push({
        id: st.id,
        skillIds: st.skillSlugs.map((slug) => `skill:${slug}`),
        sortOrder: indexInTask + 1,
        taskId: st.taskId,
        title: makeLocalizedString(st.shortName.zh, st.shortName.en),
      });
    });
  }

  const skills = siteData.skills.map((skill) => {
    const entry = {
      agentsClaimStatus: skill.agentsClaimStatus,
      contentSha256: skill.contentSha256,
      evidenceLinks: skill.evidenceLinks.map((ev) => {
        const link = {
          kind: ev.kind,
          label: resolveEvidenceLabel(ev.kind, siteData.i18n),
          url: ev.url,
        };
        if (ev.retrievedAt && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(ev.retrievedAt)) {
          link.retrievedAt = ev.retrievedAt;
        }
        return link;
      }),
      id: skill.id,
      identityKey: skill.identityKey,
      licenseSpdx: skill.licenseSpdx,
      name: skill.name,
      repo: skill.repo,
      revision: skill.revision,
      subpath: skill.subpath,
      supportedAgents: [...skill.supportedAgents],
      title: makeLocalizedString(skill.copy.zh.title, skill.copy.en.title),
      upstreamUrl: skill.upstreamUrl,
    };

    if (skill.reviewedAt && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(skill.reviewedAt)) {
      entry.reviewedAt = skill.reviewedAt;
    }
    if (skill.copy.zh.summary || skill.copy.en.summary) {
      entry.summary = makeLocalizedString(skill.copy.zh.summary, skill.copy.en.summary);
    }
    const whyZh = skill.copy.zh.whyItems.join(' | ');
    const whyEn = skill.copy.en.whyItems.join(' | ');
    if (whyZh || whyEn) {
      entry.whyRecommended = makeLocalizedString(whyZh, whyEn);
    }
    if (skill.copy.zh.knownLimitations || skill.copy.en.knownLimitations) {
      entry.knownLimitations = makeLocalizedString(
        skill.copy.zh.knownLimitations,
        skill.copy.en.knownLimitations,
      );
    }

    return entry;
  });

  return {
    catalogueVersion,
    changelogSummary,
    directories,
    generatedAt,
    i18nDefault: 'zh-Hans',
    minimumAppVersion,
    releaseSequence,
    schemaVersion,
    skills,
    sourceReleaseSet: siteData.manifest.sourceReleaseSet,
    stages,
    tasks,
    withdrawals,
  };
}

function assertOnlyAllowedKeys(obj, allowedKeys, context) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new CatalogueValidationError('schema_invalid', `${context} must be an object`);
  }
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw new CatalogueValidationError(
        'schema_invalid',
        `Unexpected property "${key}" in ${context}`,
      );
    }
  }
}

function assertLocalizedString(loc, context) {
  assertOnlyAllowedKeys(loc, new Set(['default', 'i18n']), context);
  if (typeof loc.default !== 'string' || loc.default.length < 2) {
    throw new CatalogueValidationError(
      'schema_invalid',
      `Invalid default language tag in ${context}`,
    );
  }
  if (!loc.i18n || typeof loc.i18n !== 'object' || Array.isArray(loc.i18n)) {
    throw new CatalogueValidationError('schema_invalid', `Missing i18n map in ${context}`);
  }
  const keys = Object.keys(loc.i18n);
  if (keys.length === 0) {
    throw new CatalogueValidationError('schema_invalid', `Empty i18n map in ${context}`);
  }
  for (const [lang, val] of Object.entries(loc.i18n)) {
    if (typeof val !== 'string' || val.trim().length === 0) {
      throw new CatalogueValidationError(
        'schema_invalid',
        `Empty localized value for "${lang}" in ${context}`,
      );
    }
    if (val === 'TBD' || val === 'TBD-public-copy') {
      throw new CatalogueValidationError(
        'forbidden_field',
        `Unfilled placeholder "${val}" found in ${context}.${lang}`,
      );
    }
  }
}

/**
 * Validate `CatalogueDocument` against XAP-10 TDD rules V01–V10.
 */
export function validateCatalogueDocument(doc, options = {}) {
  const {
    previousReleaseSequence = null,
    rejectedKeys = [],
    pageManifest = null,
  } = options;

  // V07: releaseSequence integer >= 1 and strictly monotonic if previous sequence exists
  if (!doc || typeof doc !== 'object') {
    throw new CatalogueValidationError('schema_invalid', 'Document must be a JSON object');
  }
  if (!Number.isInteger(doc.releaseSequence) || doc.releaseSequence < 1) {
    throw new CatalogueValidationError(
      'sequence_invalid',
      `releaseSequence must be an integer >= 1, got ${doc.releaseSequence}`,
    );
  }
  if (
    previousReleaseSequence !== null &&
    doc.releaseSequence <= previousReleaseSequence
  ) {
    throw new CatalogueValidationError(
      'sequence_invalid',
      `releaseSequence (${doc.releaseSequence}) must be > previousReleaseSequence (${previousReleaseSequence})`,
    );
  }

  // V01: Root schema check
  const rootAllowed = new Set([
    'schemaVersion',
    'catalogueVersion',
    'releaseSequence',
    'minimumAppVersion',
    'generatedAt',
    'sourceReleaseSet',
    'i18nDefault',
    'changelogSummary',
    'directories',
    'tasks',
    'stages',
    'skills',
    'withdrawals',
  ]);
  assertOnlyAllowedKeys(doc, rootAllowed, 'CatalogueDocument');

  for (const semverField of ['schemaVersion', 'minimumAppVersion']) {
    if (typeof doc[semverField] !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(doc[semverField])) {
      throw new CatalogueValidationError(
        'schema_invalid',
        `Invalid semver in ${semverField}: ${doc[semverField]}`,
      );
    }
  }
  for (const strField of ['catalogueVersion', 'sourceReleaseSet', 'i18nDefault']) {
    if (typeof doc[strField] !== 'string' || doc[strField].trim().length === 0) {
      throw new CatalogueValidationError('schema_invalid', `Missing required ${strField}`);
    }
  }
  if (typeof doc.generatedAt !== 'string' || Number.isNaN(Date.parse(doc.generatedAt))) {
    throw new CatalogueValidationError(
      'schema_invalid',
      `Invalid RFC3339 generatedAt: ${doc.generatedAt}`,
    );
  }
  if (doc.changelogSummary !== undefined) {
    assertLocalizedString(doc.changelogSummary, 'changelogSummary');
  }

  for (const arrField of ['directories', 'tasks', 'stages', 'skills', 'withdrawals']) {
    if (!Array.isArray(doc[arrField])) {
      throw new CatalogueValidationError('schema_invalid', `${arrField} must be an array`);
    }
  }
  if (
    doc.directories.length === 0 ||
    doc.tasks.length === 0 ||
    doc.stages.length === 0 ||
    doc.skills.length === 0
  ) {
    throw new CatalogueValidationError(
      'empty_task_or_stage',
      'directories, tasks, stages, and skills must all be non-empty',
    );
  }

  // V04 + V06 + V05 (Skill checks)
  const skillById = new Map();
  const seenIdentityKeys = new Set();
  const seenRepoSubpath = new Map();
  const rejectedSet = new Set(rejectedKeys);

  for (const skill of doc.skills) {
    assertOnlyAllowedKeys(
      skill,
      new Set([
        'id',
        'identityKey',
        'name',
        'repo',
        'subpath',
        'revision',
        'contentSha256',
        'licenseSpdx',
        'upstreamUrl',
        'title',
        'summary',
        'whyRecommended',
        'evidenceLinks',
        'reviewedAt',
        'knownLimitations',
        'supportedAgents',
        'agentsClaimStatus',
        'dependenciesNote',
      ]),
      `skill(${skill?.id})`,
    );

    if (
      typeof skill.id !== 'string' ||
      !/^skill:[a-zA-Z0-9._-]+(--[a-zA-Z0-9._-]+)+$/.test(skill.id)
    ) {
      throw new CatalogueValidationError('schema_invalid', `Invalid skill.id: ${skill.id}`);
    }
    if (skillById.has(skill.id) || seenIdentityKeys.has(skill.identityKey)) {
      throw new CatalogueValidationError('duplicate_id', `Duplicate skill id: ${skill.id}`);
    }
    if (rejectedSet.has(skill.identityKey)) {
      throw new CatalogueValidationError(
        'non_admitted_leak',
        `Rejected skill "${skill.identityKey}" leaked into active skills`,
      );
    }

    const repoSubKey = `${skill.repo}::${skill.subpath}`;
    if (seenRepoSubpath.has(repoSubKey)) {
      throw new CatalogueValidationError(
        'duplicate_id',
        `Duplicate (repo, subpath) mapping for ${repoSubKey}`,
      );
    }
    seenRepoSubpath.set(repoSubKey, skill.id);

    if (typeof skill.revision !== 'string' || !/^[0-9a-f]{40}$/.test(skill.revision)) {
      throw new CatalogueValidationError(
        'pin_invalid',
        `Skill ${skill.id} revision must be 40-char lowercase hex, got "${skill.revision}"`,
      );
    }
    if (typeof skill.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(skill.contentSha256)) {
      throw new CatalogueValidationError(
        'pin_invalid',
        `Skill ${skill.id} contentSha256 must be 64-char lowercase hex, got "${skill.contentSha256}"`,
      );
    }
    if (!['unverified', 'spot_checked', 'n/a'].includes(skill.agentsClaimStatus)) {
      throw new CatalogueValidationError(
        'schema_invalid',
        `Invalid agentsClaimStatus on ${skill.id}`,
      );
    }
    if (!Array.isArray(skill.supportedAgents)) {
      throw new CatalogueValidationError(
        'schema_invalid',
        `supportedAgents must be an array on ${skill.id}`,
      );
    }

    assertLocalizedString(skill.title, `${skill.id}.title`);
    if (skill.summary !== undefined) {
      assertLocalizedString(skill.summary, `${skill.id}.summary`);
    }
    if (skill.whyRecommended !== undefined) {
      assertLocalizedString(skill.whyRecommended, `${skill.id}.whyRecommended`);
    }
    if (skill.knownLimitations !== undefined) {
      assertLocalizedString(skill.knownLimitations, `${skill.id}.knownLimitations`);
    }
    if (skill.dependenciesNote !== undefined) {
      assertLocalizedString(skill.dependenciesNote, `${skill.id}.dependenciesNote`);
    }

    if (skill.evidenceLinks !== undefined) {
      if (!Array.isArray(skill.evidenceLinks)) {
        throw new CatalogueValidationError(
          'schema_invalid',
          `${skill.id}.evidenceLinks must be an array`,
        );
      }
      for (const [evIdx, ev] of skill.evidenceLinks.entries()) {
        assertOnlyAllowedKeys(
          ev,
          new Set(['label', 'url', 'kind', 'retrievedAt']),
          `${skill.id}.evidenceLinks[${evIdx}]`,
        );
        assertLocalizedString(ev.label, `${skill.id}.evidenceLinks[${evIdx}].label`);
        if (!['upstream', 'review', 'adoption', 'other'].includes(ev.kind)) {
          throw new CatalogueValidationError(
            'schema_invalid',
            `Invalid evidenceLink kind "${ev.kind}" on ${skill.id}`,
          );
        }
        if (typeof ev.url !== 'string' || !ev.url.startsWith('https://')) {
          throw new CatalogueValidationError(
            'schema_invalid',
            `EvidenceLink url must be https:// on ${skill.id}`,
          );
        }
      }
    }

    skillById.set(skill.id, skill);
    seenIdentityKeys.add(skill.identityKey);
  }

  // Stages check (V01, V02, V03, V04)
  const stageById = new Map();
  for (const stage of doc.stages) {
    assertOnlyAllowedKeys(
      stage,
      new Set(['id', 'taskId', 'title', 'skillIds', 'sortOrder']),
      `stage(${stage?.id})`,
    );
    if (typeof stage.id !== 'string' || !/^T[0-9]{2}\.s[0-9]+$/.test(stage.id)) {
      throw new CatalogueValidationError('schema_invalid', `Invalid stage.id: ${stage.id}`);
    }
    if (stageById.has(stage.id)) {
      throw new CatalogueValidationError('duplicate_id', `Duplicate stage.id: ${stage.id}`);
    }
    assertLocalizedString(stage.title, `stage(${stage.id}).title`);

    if (!Array.isArray(stage.skillIds) || stage.skillIds.length === 0) {
      throw new CatalogueValidationError(
        'empty_task_or_stage',
        `Stage ${stage.id} must have non-empty skillIds`,
      );
    }
    const uniqueSkillIds = new Set();
    for (const sid of stage.skillIds) {
      if (uniqueSkillIds.has(sid)) {
        throw new CatalogueValidationError(
          'duplicate_id',
          `Duplicate skillId "${sid}" in stage ${stage.id}`,
        );
      }
      uniqueSkillIds.add(sid);
      if (!skillById.has(sid)) {
        throw new CatalogueValidationError(
          'broken_ref',
          `Stage ${stage.id} references missing skillId "${sid}"`,
        );
      }
    }
    stageById.set(stage.id, stage);
  }

  // Tasks check (V01, V02, V03, V04, V05)
  const taskById = new Map();
  for (const task of doc.tasks) {
    assertOnlyAllowedKeys(
      task,
      new Set(['id', 'directoryId', 'title', 'summary', 'stageIds', 'status', 'sortOrder']),
      `task(${task?.id})`,
    );
    if (typeof task.id !== 'string' || !/^T[0-9]{2}$/.test(task.id)) {
      throw new CatalogueValidationError('schema_invalid', `Invalid task.id: ${task.id}`);
    }
    if (taskById.has(task.id)) {
      throw new CatalogueValidationError('duplicate_id', `Duplicate task.id: ${task.id}`);
    }
    if (task.status !== 'active') {
      throw new CatalogueValidationError(
        'non_admitted_leak',
        `Non-active task "${task.id}" (status=${task.status}) found in published catalogue`,
      );
    }
    assertLocalizedString(task.title, `task(${task.id}).title`);
    if (task.summary !== undefined) {
      assertLocalizedString(task.summary, `task(${task.id}).summary`);
    }
    if (!Array.isArray(task.stageIds) || task.stageIds.length === 0) {
      throw new CatalogueValidationError(
        'empty_task_or_stage',
        `Task ${task.id} must have non-empty stageIds`,
      );
    }
    for (const stId of task.stageIds) {
      const stage = stageById.get(stId);
      if (!stage) {
        throw new CatalogueValidationError(
          'broken_ref',
          `Task ${task.id} references missing stageId "${stId}"`,
        );
      }
      if (stage.taskId !== task.id) {
        throw new CatalogueValidationError(
          'broken_ref',
          `Stage ${stId} taskId (${stage.taskId}) does not match parent task ${task.id}`,
        );
      }
    }
    taskById.set(task.id, task);
  }

  // Directories check (V01, V02, V03, V04)
  const dirById = new Map();
  for (const dir of doc.directories) {
    assertOnlyAllowedKeys(
      dir,
      new Set(['id', 'title', 'taskIds', 'sortOrder']),
      `directory(${dir?.id})`,
    );
    if (typeof dir.id !== 'string' || !/^D[0-9]{2}$/.test(dir.id)) {
      throw new CatalogueValidationError('schema_invalid', `Invalid directory.id: ${dir.id}`);
    }
    if (dirById.has(dir.id)) {
      throw new CatalogueValidationError('duplicate_id', `Duplicate directory.id: ${dir.id}`);
    }
    assertLocalizedString(dir.title, `directory(${dir.id}).title`);
    if (!Array.isArray(dir.taskIds) || dir.taskIds.length === 0) {
      throw new CatalogueValidationError(
        'empty_task_or_stage',
        `Directory ${dir.id} must have non-empty taskIds`,
      );
    }
    for (const tId of dir.taskIds) {
      const task = taskById.get(tId);
      if (!task) {
        throw new CatalogueValidationError(
          'broken_ref',
          `Directory ${dir.id} references missing taskId "${tId}"`,
        );
      }
      if (task.directoryId !== dir.id) {
        throw new CatalogueValidationError(
          'broken_ref',
          `Task ${tId} directoryId (${task.directoryId}) does not match parent directory ${dir.id}`,
        );
      }
    }
    dirById.set(dir.id, dir);
  }

  // Ensure no orphan tasks or stages exist outside active navigation graph
  const referencedTaskIds = new Set(doc.directories.flatMap((d) => d.taskIds));
  for (const tId of taskById.keys()) {
    if (!referencedTaskIds.has(tId)) {
      throw new CatalogueValidationError(
        'broken_ref',
        `Orphan task "${tId}" is not referenced by any directory`,
      );
    }
  }
  const referencedStageIds = new Set(doc.tasks.flatMap((t) => t.stageIds));
  for (const stId of stageById.keys()) {
    if (!referencedStageIds.has(stId)) {
      throw new CatalogueValidationError(
        'broken_ref',
        `Orphan stage "${stId}" is not referenced by any task`,
      );
    }
  }

  // V08: withdrawals must not collide with active entity IDs
  const activeEntityIds = new Set([
    ...dirById.keys(),
    ...taskById.keys(),
    ...stageById.keys(),
    ...skillById.keys(),
  ]);
  for (const wd of doc.withdrawals) {
    assertOnlyAllowedKeys(
      wd,
      new Set([
        'id',
        'entityType',
        'entityId',
        'reasonCode',
        'reasonPublic',
        'withdrawnAt',
        'evidenceRef',
      ]),
      `withdrawal(${wd?.id})`,
    );
    if (activeEntityIds.has(wd.entityId)) {
      throw new CatalogueValidationError(
        'withdraw_conflict',
        `Withdrawn entity "${wd.entityId}" cannot appear in active catalogue graph`,
      );
    }
  }

  // V09: Forbidden research tokens / private key material scan across entire serialized JSON
  const serialized = serializeCanonicalJson(doc);
  const leak = findForbiddenLeak(serialized);
  if (leak) {
    throw new CatalogueValidationError(
      'forbidden_field',
      `Forbidden token "${leak.token}" (${leak.reason}) detected in CatalogueDocument`,
    );
  }
  if (/PRIVATE KEY/i.test(serialized)) {
    throw new CatalogueValidationError(
      'forbidden_field',
      'Private key marker detected in CatalogueDocument',
    );
  }

  // V10: Exact ID parity with skillpouch-site page-manifest.json
  if (pageManifest) {
    const manifestDirIds = new Set(
      pageManifest.pages
        .filter((p) => p.lang === 'zh' && p.pageType === 'directory')
        .map((p) => p.entityId),
    );
    const manifestTaskIds = new Set(
      pageManifest.pages
        .filter((p) => p.lang === 'zh' && p.pageType === 'task')
        .map((p) => p.entityId),
    );
    const manifestSkillIds = new Set(
      pageManifest.pages
        .filter((p) => p.lang === 'zh' && p.pageType === 'skill')
        .map((p) => p.entityId),
    );

    const compareSets = (label, setA, setB) => {
      if (setA.size !== setB.size || [...setA].some((item) => !setB.has(item))) {
        throw new CatalogueValidationError(
          'site_app_divergence',
          `${label} ID set diverges between page-manifest (${setA.size}) and CatalogueDocument (${setB.size})`,
        );
      }
    };

    compareSets('Directory', manifestDirIds, new Set(dirById.keys()));
    compareSets('Task', manifestTaskIds, new Set(taskById.keys()));
    compareSets('Skill', manifestSkillIds, new Set(skillById.keys()));
  }

  return true;
}

/**
 * Build `catalogue/v1/index.json` pointer document and validate against `index.schema.json`.
 */
export function buildCatalogueIndex({
  releaseSequence,
  catalogueVersion,
  updatedAt,
  sha256Hex,
  baseUrl = '',
}) {
  const normalizedBase = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const relPrefix = `${normalizedBase}/catalogue/v1/releases/${releaseSequence}`;
  const indexDoc = {
    catalogueUrl: `${relPrefix}/catalogue.json`,
    catalogueVersion,
    currentReleaseSequence: releaseSequence,
    etagHint: `rel-${releaseSequence}-${catalogueVersion}-${sha256Hex.slice(0, 12)}`,
    schemaVersion: '1.0.0',
    sha256Url: `${relPrefix}/catalogue.json.sha256`,
    sigUrl: `${relPrefix}/catalogue.sig`,
    updatedAt,
  };
  validateCatalogueIndex(indexDoc);
  return indexDoc;
}

export function validateCatalogueIndex(indexDoc) {
  assertOnlyAllowedKeys(
    indexDoc,
    new Set([
      'schemaVersion',
      'currentReleaseSequence',
      'catalogueVersion',
      'catalogueUrl',
      'sha256Url',
      'sigUrl',
      'updatedAt',
      'etagHint',
      '_notice',
    ]),
    'CatalogueIndex',
  );
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(indexDoc.schemaVersion || '')) {
    throw new CatalogueValidationError('schema_invalid', 'Invalid index.schemaVersion');
  }
  if (!Number.isInteger(indexDoc.currentReleaseSequence) || indexDoc.currentReleaseSequence < 1) {
    throw new CatalogueValidationError('sequence_invalid', 'Invalid currentReleaseSequence');
  }
  const seq = indexDoc.currentReleaseSequence;
  const expectedSuffixes = [
    ['catalogueUrl', `/catalogue/v1/releases/${seq}/catalogue.json`],
    ['sha256Url', `/catalogue/v1/releases/${seq}/catalogue.json.sha256`],
    ['sigUrl', `/catalogue/v1/releases/${seq}/catalogue.sig`],
  ];
  for (const [field, suffix] of expectedSuffixes) {
    const val = indexDoc[field];
    if (typeof val !== 'string' || !(val === suffix || (val.startsWith('https://') && val.endsWith(suffix)))) {
      throw new CatalogueValidationError(
        'schema_invalid',
        `Index ${field} ("${val}") does not match expected immutable release path "${suffix}"`,
      );
    }
  }
  if (typeof indexDoc.updatedAt !== 'string' || Number.isNaN(Date.parse(indexDoc.updatedAt))) {
    throw new CatalogueValidationError('schema_invalid', 'Invalid index.updatedAt');
  }
  if (typeof indexDoc.etagHint !== 'string' || indexDoc.etagHint.trim().length === 0) {
    throw new CatalogueValidationError('schema_invalid', 'Missing index.etagHint');
  }
  return true;
}

/**
 * Full pipeline: ingest site data, build & validate CatalogueDocument, sign, and emit
 * `/catalogue/v1/releases/{seq}/{catalogue.json, catalogue.json.sha256, catalogue.sig}` + `index.json`.
 */
export function emitCatalogueRelease(options = {}) {
  const siteRoot = options.siteRoot
    ? path.resolve(options.siteRoot)
    : path.resolve(process.cwd());
  const outputRoot = options.outputRoot
    ? path.resolve(options.outputRoot)
    : path.join(siteRoot, 'public/catalogue/v1');

  const indexPath = path.join(outputRoot, 'index.json');
  if (options.ensureOnly && fs.existsSync(indexPath)) {
    return {
      skipped: true,
      indexPath,
    };
  }

  let existingSequence = null;
  if (fs.existsSync(indexPath)) {
    const currentIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (Number.isInteger(currentIndex.currentReleaseSequence)) {
      existingSequence = currentIndex.currentReleaseSequence;
    }
  }

  let targetSequence;
  if (options.bump) {
    targetSequence = (existingSequence ?? 0) + 1;
  } else if (options.releaseSequence !== undefined) {
    targetSequence = options.releaseSequence;
  } else {
    targetSequence = existingSequence ?? 1;
  }

  const releaseDir = path.join(outputRoot, 'releases', String(targetSequence));
  const releaseExists = fs.existsSync(releaseDir);

  if (releaseExists && !options.forceDev) {
    throw new CatalogueValidationError(
      'sequence_invalid',
      `Immutable release directory already exists: ${releaseDir}. Pass --bump to publish sequence ${(existingSequence ?? targetSequence) + 1} or --force-dev to rebuild local dev release in place.`,
    );
  }

  const previousReleaseSequence =
    options.forceDev || existingSequence === null ? null : existingSequence;

  const siteData = ingestSiteData({ siteRoot });
  const manifestPath =
    options.pageManifestPath || path.join(siteRoot, 'content/page-manifest.json');
  const pageManifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : siteData.manifest;

  const timestamp = options.timestamp || new Date().toISOString();
  const doc = buildCatalogueDocumentFromSiteData(siteData, {
    catalogueVersion: options.catalogueVersion || '2026.11.0',
    generatedAt: timestamp,
    minimumAppVersion: options.minimumAppVersion || '1.0.0',
    releaseSequence: targetSequence,
    withdrawals: options.withdrawals || [],
  });

  validateCatalogueDocument(doc, {
    pageManifest,
    previousReleaseSequence,
    rejectedKeys: siteData.rejectedKeys,
  });

  const catalogueJsonText = serializeCanonicalJson(doc);
  const catalogueBytes = Buffer.from(catalogueJsonText, 'utf8');
  const sha256Hex = computeSha256Hex(catalogueBytes);
  const sha256SidecarText = formatSha256Sidecar(sha256Hex, 'catalogue.json');

  const envelope = signCatalogueBytes(
    catalogueBytes,
    {
      catalogueVersion: doc.catalogueVersion,
      releaseSequence: doc.releaseSequence,
      signedAt: timestamp,
    },
    {
      allowDevFixture: options.allowDevFixture !== false,
      keyId: options.keyId,
      privateKey: options.privateKey,
      testOnly: options.testOnly === true,
    },
  );

  if (!options.testOnly && envelope.signature === TEST_ONLY_SIGNATURE_PLACEHOLDER) {
    throw new CatalogueValidationError(
      'forbidden_field',
      'TEST_ONLY signature placeholder cannot be emitted without explicit testOnly flag',
    );
  }

  const sigJsonText = serializeCanonicalJson(envelope);
  const indexDoc = buildCatalogueIndex({
    baseUrl: options.baseUrl || '',
    catalogueVersion: doc.catalogueVersion,
    releaseSequence: doc.releaseSequence,
    sha256Hex,
    updatedAt: timestamp,
  });
  const indexJsonText = serializeCanonicalJson(indexDoc);

  // Two-phase write order: write immutable release files first, then update index.json pointer
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, 'catalogue.json'), catalogueBytes);
  fs.writeFileSync(path.join(releaseDir, 'catalogue.json.sha256'), sha256SidecarText, 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'catalogue.sig'), sigJsonText, 'utf8');

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(indexPath, indexJsonText, 'utf8');

  return {
    skipped: false,
    outputRoot,
    releaseDir,
    indexPath,
    releaseSequence: doc.releaseSequence,
    catalogueVersion: doc.catalogueVersion,
    sha256: sha256Hex,
    keyId: envelope.keyId,
    byteLength: catalogueBytes.length,
    counts: {
      directories: doc.directories.length,
      tasks: doc.tasks.length,
      stages: doc.stages.length,
      skills: doc.skills.length,
    },
  };
}

