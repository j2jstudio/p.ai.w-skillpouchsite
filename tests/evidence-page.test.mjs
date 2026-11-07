import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestSiteData, findForbiddenLeak } from '../scripts/lib/ingest.mjs';
import { buildSitePages } from '../scripts/build-pages.mjs';
import { renderSkillEvidenceMain } from '../src/components/skill-evidence.mjs';
import {
  initFromStageHighlight,
  initCopySkillId,
} from '../src/client/site-enhance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

test('renders A->G fixed section order and dual CTAs for 1-stage, 2-stage, 6-stage, and CC-BY-SA skills', () => {
  const data = ingestSiteData({ siteRoot });

  for (const lang of ['zh', 'en']) {
    const dict = data.i18n[lang];

    // 1. Single-stage: email-drafter
    const emailSkill = data.skillsBySlug.get(
      'claude-office-skills--skills--email-drafter',
    );
    const emailHtml = renderSkillEvidenceMain({
      lang,
      dict,
      skill: emailSkill,
      primaryTask: data.tasksById.get(emailSkill.primaryTaskId),
      primaryDirectory: data.directoriesById.get(
        data.tasksById.get(emailSkill.primaryTaskId).directoryId,
      ),
      stagesById: data.stagesById,
    });

    assert.equal(findForbiddenLeak(emailHtml), null);

    // Verify strict A -> B -> C -> D -> E -> F -> G order
    const order = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((sec) =>
      emailHtml.indexOf(`data-evidence-section="${sec}"`),
    );
    for (let i = 0; i < order.length; i += 1) {
      assert.ok(order[i] >= 0, `Missing section index ${i} in ${lang}`);
      if (i > 0) {
        assert.ok(
          order[i] > order[i - 1],
          `Section order broken between ${i - 1} and ${i} in ${lang}`,
        );
      }
    }

    // Only upstream evidence group rendered when review/adoption/other are empty
    assert.match(emailHtml, /data-evidence-kind="upstream"/);
    assert.doesNotMatch(emailHtml, /data-evidence-kind="review"/);
    assert.doesNotMatch(emailHtml, /data-evidence-kind="adoption"/);
    assert.doesNotMatch(emailHtml, /data-evidence-kind="other"/);

    // Three visual zones stay distinct while A→G order is unchanged.
    assert.match(emailHtml, /data-skill-zone="identity"/);
    assert.match(emailHtml, /data-skill-zone="rationale"/);
    assert.match(emailHtml, /data-skill-zone="operate"/);
    assert.match(emailHtml, /data-skill-zone="specs"/);
    const rationaleAt = emailHtml.indexOf('data-skill-zone="rationale"');
    const operateAt = emailHtml.indexOf('data-skill-zone="operate"');
    const sourcesAt = emailHtml.indexOf('data-skill-zone="sources"');
    assert.ok(rationaleAt >= 0 && rationaleAt < operateAt && operateAt < sourcesAt);
    assert.match(emailHtml, lang === 'zh' ? /基础信息/ : /Essentials/);
    assert.match(emailHtml, lang === 'zh' ? /选择理由/ : /Why we picked it/);
    assert.match(emailHtml, lang === 'zh' ? /操作说明/ : /How to use/);
    const operateBlock = emailHtml.slice(
      operateAt,
      emailHtml.indexOf('data-evidence-section="E"'),
    );
    assert.match(operateBlock, /data-cta="upstream"/);
    assert.match(operateBlock, /data-cta="install-placeholder"/);
    assert.match(emailHtml, /class="vbg-custom-why-item"/);
    assert.match(emailHtml, /T01\.s1/);

    // Dual CTA rules
    assert.match(
      emailHtml,
      new RegExp(
        `data-cta="upstream" href="https://github\\.com/claude-office-skills/skills/[^"]+" target="_blank" rel="noopener noreferrer"`,
      ),
    );
    assert.match(
      emailHtml,
      lang === 'zh' ? /打开上游仓库/ : /Open upstream repository/,
    );
    assert.match(
      emailHtml,
      /<button type="button"[^>]*data-cta="install-placeholder"[^>]*disabled aria-disabled="true"/,
    );
    assert.doesNotMatch(emailHtml, /skillpouch:\/\//i);

    // Copy skillId button
    assert.match(
      emailHtml,
      /data-copy-skill-id="skill:claude-office-skills--skills--email-drafter"/,
    );

    // 2. Dual-stage: frontend-design
    const feSkill = data.skillsBySlug.get('anthropics--skills--frontend-design');
    const feHtml = renderSkillEvidenceMain({
      lang,
      dict,
      skill: feSkill,
      primaryTask: data.tasksById.get(feSkill.primaryTaskId),
      primaryDirectory: data.directoriesById.get(
        data.tasksById.get(feSkill.primaryTaskId).directoryId,
      ),
      stagesById: data.stagesById,
    });
    assert.match(feHtml, /data-stage-chip="T11\.s2"/);
    assert.match(feHtml, /data-stage-chip="T12\.s2"/);

    // 3. Six-stage cross-task: ecommerce-growth-strategy
    const ecSkill = data.skillsBySlug.get(
      'nexscope-ai--ecommerce-skills--ecommerce-growth-strategy',
    );
    const ecHtml = renderSkillEvidenceMain({
      lang,
      dict,
      skill: ecSkill,
      primaryTask: data.tasksById.get(ecSkill.primaryTaskId),
      primaryDirectory: data.directoriesById.get(
        data.tasksById.get(ecSkill.primaryTaskId).directoryId,
      ),
      stagesById: data.stagesById,
    });
    const chipMatches = ecHtml.match(/data-stage-chip="T1[56]\.s[123]"/g) || [];
    assert.equal(chipMatches.length, 6);
    assert.match(ecHtml, new RegExp(`href="/${lang}/tasks/T15\\.html#s1"`));
    assert.match(ecHtml, new RegExp(`href="/${lang}/tasks/T16\\.html#s3"`));

    // 4. CC-BY-SA: backwards-design-unit-planner must NOT duplicate notice
    const ccSkill = data.skillsBySlug.get(
      'garethmanning--education-agent-skills--backwards-design-unit-planner',
    );
    const ccHtml = renderSkillEvidenceMain({
      lang,
      dict,
      skill: ccSkill,
      primaryTask: data.tasksById.get(ccSkill.primaryTaskId),
      primaryDirectory: data.directoriesById.get(
        data.tasksById.get(ccSkill.primaryTaskId).directoryId,
      ),
      stagesById: data.stagesById,
    });
    assert.match(ccHtml, /CC-BY-SA-4\.0/);
    if (lang === 'zh') {
      const count = (ccHtml.match(/相同方式共享/g) || []).length;
      assert.equal(count, 1, 'CC-BY-SA notice in ZH must appear once without duplication');
    } else {
      const count = (ccHtml.match(/share[- ]alike/gi) || []).length;
      assert.equal(count, 1, 'CC-BY-SA notice in EN must appear once without duplication');
    }
  }
});

test('handles empty/pending fields, synthesized upstream link, and missing CC-BY-SA notice fallback', () => {
  const enDict = JSON.parse(
    fs.readFileSync(path.join(siteRoot, 'content/i18n/en.json'), 'utf8'),
  );

  const syntheticSkill = {
    id: 'skill:org--repo--synthetic',
    identityKey: 'org--repo--synthetic',
    stableSlug: 'org--repo--synthetic',
    name: 'synthetic',
    repo: 'org/repo',
    subpath: 'synthetic',
    revision: '9c4c7d5cd2813a8936bf2c9fdb174ea883b85a11',
    licenseSpdx: 'CC-BY-SA-4.0',
    upstreamUrl: 'https://github.com/org/repo',
    evidenceLinks: [],
    reviewedAt: '',
    agentsClaimStatus: 'unverified',
    stagesBound: [],
    copy: {
      en: {
        title: 'synthetic',
        summary: '',
        whyItems: [],
        knownLimitations: '',
      },
    },
  };

  const html = renderSkillEvidenceMain({
    lang: 'en',
    dict: enDict,
    skill: syntheticSkill,
    primaryTask: null,
    primaryDirectory: null,
    stagesById: new Map(),
  });

  // Headings preserved even when empty
  assert.match(html, /Summary/);
  assert.match(html, /Why recommended/);
  assert.match(html, /Applicable stages/);
  assert.match(html, /English copy pending/);
  assert.match(html, /No stage bindings recorded/);
  assert.match(html, /Derived from skill metadata/);
  assert.match(html, /Review date not recorded/);
  // CC-BY-SA fallback notice automatically injected into Section F
  assert.match(html, /retain original author attribution and share alike/i);
});

test('?fromStage= highlight and Copy skillId client enhancements work accurately', async () => {
  const chips = [
    {
      highlighted: false,
      getAttribute(attr) {
        return attr === 'data-stage-chip' ? 'T15.s1' : null;
      },
      setAttribute(attr, val) {
        if (attr === 'data-highlighted') this.highlighted = val === 'true';
      },
    },
    {
      highlighted: false,
      getAttribute(attr) {
        return attr === 'data-stage-chip' ? 'T15.s2' : null;
      },
      setAttribute(attr, val) {
        if (attr === 'data-highlighted') this.highlighted = val === 'true';
      },
    },
  ];

  const mockRoot = {
    querySelectorAll(sel) {
      return sel === '[data-stage-chip]' ? chips : [];
    },
  };

  initFromStageHighlight(mockRoot, '?fromStage=T15.s2');
  assert.equal(chips[0].highlighted, false);
  assert.equal(chips[1].highlighted, true);

  let clickHandler = null;
  let copiedText = '';
  const mockBtn = {
    textContent: 'Copy skillId',
    getAttribute(attr) {
      if (attr === 'data-copy-skill-id') return 'skill:org--repo--demo';
      if (attr === 'data-copy-default') return 'Copy skillId';
      if (attr === 'data-copy-copied') return 'Copied';
      return null;
    },
    addEventListener(evt, fn) {
      if (evt === 'click') clickHandler = fn;
    },
  };
  const mockStatus = { textContent: '' };
  const copyRoot = {
    querySelector(sel) {
      if (sel === '[data-copy-skill-id]') return mockBtn;
      if (sel === '[data-copy-status]') return mockStatus;
      return null;
    },
  };

  initCopySkillId(copyRoot, {
    writeText: async (txt) => {
      copiedText = txt;
    },
    scheduleReset: () => {},
  });

  assert.ok(clickHandler);
  await clickHandler();
  assert.equal(copiedText, 'skill:org--repo--demo');
  assert.equal(mockBtn.textContent, 'Copied');
  assert.equal(mockStatus.textContent, 'Copied: skill:org--repo--demo');
});

test('buildSitePages emits all 132 bilingual HTML content pages plus root redirect index.html', () => {
  const tmpGen = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-full-gen-'));
  try {
    const { emittedRoutes } = buildSitePages({
      siteRoot,
      generatedDir: tmpGen,
      writeManifest: false,
    });
    assert.equal(emittedRoutes.length, 132);
    assert.equal(fs.existsSync(path.join(tmpGen, 'index.html')), true);
    assert.equal(
      fs.existsSync(
        path.join(
          tmpGen,
          'zh/skills/claude-office-skills--skills--email-drafter.html',
        ),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          tmpGen,
          'en/skills/claude-office-skills--skills--email-drafter.html',
        ),
      ),
      true,
    );
  } finally {
    fs.rmSync(tmpGen, { recursive: true, force: true });
  }
});
