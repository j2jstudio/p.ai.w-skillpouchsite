import { escapeHtml, getLocalizedLabel, renderBreadcrumb } from './shell.mjs';

const EVIDENCE_KIND_ORDER = ['upstream', 'review', 'adoption', 'other'];

/**
 * 技能证据页布局。
 * 文档顺序仍为 A→G，视觉上分成三块：
 * 基础信息（身份、简介、侧栏规格）、选择理由、操作说明（阶段 + 取得方式）。
 * 证据与使用边界作为理由和操作之后的辅助区，避免和主信息挤成同一列表。
 */

function hasCcBySaEquivalent(text, lang) {
  if (!text) {
    return false;
  }
  if (lang === 'zh') {
    return text.includes('署名') && text.includes('相同方式共享');
  }
  const lower = text.toLowerCase();
  return (
    lower.includes('attribution') &&
    (lower.includes('share alike') || lower.includes('share-alike'))
  );
}

function resolveKnownLimitations(rawText, licenseSpdx, lang, template) {
  const cleaned = String(rawText ?? '').trim();
  if (!/^CC-BY-SA/i.test(licenseSpdx || '')) {
    return cleaned;
  }
  if (hasCcBySaEquivalent(cleaned, lang)) {
    return cleaned;
  }
  const notice = template.replace('{licenseSpdx}', licenseSpdx);
  return cleaned ? `${cleaned} ${notice}` : notice;
}

function getHostnameFallback(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function normalizeEvidenceGroups(skill) {
  const rawLinks = Array.isArray(skill.evidenceLinks) ? skill.evidenceLinks : [];
  let effectiveLinks = rawLinks.filter((lnk) =>
    EVIDENCE_KIND_ORDER.includes(lnk.kind) && Boolean(lnk.url),
  );

  if (effectiveLinks.length === 0 && skill.upstreamUrl) {
    effectiveLinks = [
      {
        kind: 'upstream',
        url: skill.upstreamUrl,
        retrievedAt: skill.reviewedAt || '',
        synthesized: true,
      },
    ];
  }

  const groups = new Map();
  for (const kind of EVIDENCE_KIND_ORDER) {
    groups.set(kind, []);
  }
  for (const link of effectiveLinks) {
    groups.get(link.kind).push(link);
  }
  return groups;
}

function zoneCopy(dict) {
  return dict.skill.zones || {};
}

function renderZoneHeading({ id, kicker, title, hint = '' }) {
  const hintHtml = hint
    ? `<p class="vbg-custom-zone-hint">${escapeHtml(hint)}</p>`
    : '';
  return `<div class="vbg-custom-zone-head">
      <h2 id="${escapeHtml(id)}" class="vbg-heading-24 vbg-custom-zone-title">
        <span class="vbg-custom-zone-kicker">${escapeHtml(kicker)}</span>
        <span class="vbg-custom-zone-name">${escapeHtml(title)}</span>
      </h2>
      ${hintHtml}
    </div>`;
}

function stageHref(stageId, lang) {
  const [taskId, anchorId] = String(stageId || '').split('.');
  if (!taskId || !anchorId) {
    return '';
  }
  return `/${lang}/tasks/${taskId}.html#${anchorId}`;
}

function parseWhyItem(raw) {
  const text = String(raw ?? '').trim();
  const staged = text.match(/^(T\d+\.s\d+)\s*[·・•]\s*([\s\S]+)$/);
  if (!staged) {
    return { stageId: '', title: '', body: text };
  }
  const rest = staged[2].trim();
  const split = rest.match(/^([^：:]{1,80})[：:]\s*([\s\S]+)$/);
  if (!split) {
    return { stageId: staged[1], title: '', body: rest };
  }
  return {
    stageId: staged[1],
    title: split[1].trim(),
    body: split[2].trim(),
  };
}

function renderPlacement({ lang, dict, primaryTask, primaryDirectory }) {
  const zones = zoneCopy(dict);
  const links = [];
  if (primaryDirectory) {
    links.push(
      `<a class="vbg-custom-inline-link" href="/${lang}/directories/${escapeHtml(primaryDirectory.id)}.html">${escapeHtml(getLocalizedLabel(primaryDirectory.title, lang, primaryDirectory.id))}</a>`,
    );
  }
  if (primaryTask) {
    links.push(
      `<a class="vbg-custom-inline-link" href="/${lang}/tasks/${escapeHtml(primaryTask.id)}.html">${escapeHtml(getLocalizedLabel(primaryTask.title, lang, primaryTask.id))}</a>`,
    );
  }
  if (links.length === 0) {
    return '';
  }
  return `<p class="vbg-custom-skill-placement">
      <span class="vbg-custom-zone-kicker">${escapeHtml(zones.placedIn || '')}</span>
      <span class="vbg-custom-skill-placement-links">${links.join('<span class="vbg-custom-breadcrumb-sep" aria-hidden="true">/</span>')}</span>
    </p>`;
}

function renderWhyList(whyItems) {
  return `<ol class="vbg-custom-why-list">
      ${whyItems
        .map((item, index) => {
          const parsed = parseWhyItem(item);
          const indexLabel = String(index + 1).padStart(2, '0');
          const stageHtml = parsed.stageId
            ? `<p class="vbg-custom-why-stage"><span class="vbg-mono">${escapeHtml(parsed.stageId)}</span>${
                parsed.title
                  ? `<span aria-hidden="true"> · </span><span>${escapeHtml(parsed.title)}</span>`
                  : ''
              }</p>`
            : '';
          const bodyHtml = parsed.body
            ? `<p class="vbg-custom-why-body">${escapeHtml(parsed.body)}</p>`
            : '';
          return `<li class="vbg-custom-why-item">
              <span class="vbg-mono vbg-custom-why-index" aria-hidden="true">${indexLabel}</span>
              <div class="vbg-custom-why-copy">
                ${stageHtml}
                ${bodyHtml}
              </div>
            </li>`;
        })
        .join('\n')}
    </ol>`;
}

function renderStageCard({ stageId, lang, stagesById, openLabel }) {
  const stageEntity = stagesById?.get(stageId);
  const shortLabel = stageEntity
    ? getLocalizedLabel(stageEntity.shortName, lang, '')
    : '';
  const href = stageHref(stageId, lang);
  const labelHtml = shortLabel
    ? `<span class="vbg-custom-stage-card-label">${escapeHtml(shortLabel)}</span>`
    : '';
  const goHtml = href
    ? `<span class="vbg-custom-stage-card-go">${escapeHtml(openLabel)}</span>`
    : '';
  const inner = `<span class="vbg-mono vbg-custom-stage-card-id">${escapeHtml(stageId)}</span>
      ${labelHtml}
      ${goHtml}`;
  if (href) {
    return `<li><a class="vbg-custom-stage-card" href="${escapeHtml(href)}" data-stage-chip="${escapeHtml(stageId)}">${inner}</a></li>`;
  }
  return `<li><span class="vbg-custom-stage-card" data-stage-chip="${escapeHtml(stageId)}">${inner}</span></li>`;
}

export function renderSkillEvidenceMain({
  lang,
  dict,
  skill,
  primaryTask,
  primaryDirectory,
  stagesById,
}) {
  const copy = skill.copy?.[lang] || {
    title: '',
    summary: '',
    whyItems: [],
    knownLimitations: '',
  };
  const zones = zoneCopy(dict);

  const displayTitle =
    String(copy.title || '').trim() ||
    String(skill.name || '').trim() ||
    dict.skill.empty.untitled;

  const breadcrumbItems = [{ label: dict.breadcrumb.home, href: `/${lang}/index.html` }];
  if (primaryDirectory) {
    breadcrumbItems.push({
      label: getLocalizedLabel(primaryDirectory.title, lang, primaryDirectory.id),
      href: `/${lang}/directories/${primaryDirectory.id}.html`,
    });
  }
  if (primaryTask) {
    breadcrumbItems.push({
      label: getLocalizedLabel(primaryTask.title, lang, primaryTask.id),
      href: `/${lang}/tasks/${primaryTask.id}.html`,
    });
  }
  breadcrumbItems.push({ label: displayTitle });

  const claimKey = dict.skill.claims[skill.agentsClaimStatus]
    ? skill.agentsClaimStatus
    : 'unverified';
  const claimInfo = dict.skill.claims[claimKey];

  const nameBadgeHtml = skill.name
    ? `<span class="vbg-meta"><span class="vbg-mono">${escapeHtml(skill.name)}</span></span>`
    : '';
  const sectionA = `<header class="vbg-custom-skill-header" data-evidence-section="A" data-skill-zone="identity">
      <p class="vbg-custom-zone-kicker">${escapeHtml(zones.identity || '')}</p>
      <h1 class="vbg-title vbg-custom-skill-title">${escapeHtml(displayTitle)}</h1>
      ${renderPlacement({ lang, dict, primaryTask, primaryDirectory })}
      <div class="vbg-custom-skill-subtitle-row">
        ${nameBadgeHtml}
        <span class="vbg-custom-badge" data-claim-badge="${escapeHtml(claimKey)}">${escapeHtml(claimInfo.badge)}</span>
        <span class="vbg-custom-badge" data-license-badge><span class="vbg-mono">${escapeHtml(skill.licenseSpdx)}</span></span>
      </div>
    </header>`;

  const summaryBody = copy.summary
    ? `<p class="vbg-custom-skill-lede">${escapeHtml(copy.summary)}</p>`
    : `<div class="vbg-custom-empty-box">
        <p><strong>${escapeHtml(dict.skill.empty.summaryTitle)}</strong></p>
        <p class="vbg-caption">${escapeHtml(dict.skill.empty.summaryDetail)}</p>
      </div>`;
  const sectionB = `<section class="vbg-custom-skill-summary" aria-labelledby="skill-summary-heading" data-evidence-section="B">
      <h2 id="skill-summary-heading" class="vbg-heading-24 vbg-custom-zone-title">
        <span class="vbg-custom-zone-name">${escapeHtml(dict.skill.sections.summary)}</span>
      </h2>
      ${summaryBody}
    </section>`;

  const whyItems = Array.isArray(copy.whyItems) ? copy.whyItems : [];
  const whyBody =
    whyItems.length > 0
      ? renderWhyList(whyItems)
      : `<p class="vbg-custom-empty-box">${escapeHtml(dict.skill.empty.whyRecommended)}</p>`;
  const sectionC = `<section class="vbg-custom-why-panel" aria-labelledby="skill-why-heading" data-evidence-section="C" data-skill-zone="rationale">
      ${renderZoneHeading({
        id: 'skill-why-heading',
        kicker: zones.why || dict.skill.sections.whyRecommended,
        title: dict.skill.sections.whyRecommended,
        hint: zones.whyHint || '',
      })}
      ${whyBody}
    </section>`;

  const stagesBound = Array.isArray(skill.stagesBound) ? skill.stagesBound : [];
  const stagesBody =
    stagesBound.length > 0
      ? `<ul class="vbg-custom-stage-grid">
          ${stagesBound
            .map((stageId) =>
              renderStageCard({
                stageId,
                lang,
                stagesById,
                openLabel: zones.openStage || '',
              }),
            )
            .join('\n')}
        </ul>`
      : `<p class="vbg-custom-empty-box">${escapeHtml(dict.skill.empty.stagesBound)}</p>`;

  const upstreamCtaHtml =
    skill.upstreamUrl && /^https:\/\//i.test(skill.upstreamUrl)
      ? `<a class="vbg-custom-cta-link" data-cta="upstream" href="${escapeHtml(skill.upstreamUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(dict.skill.cta.openUpstream)} &#8599;</a>`
      : '';

  const sectionD = `<section class="vbg-custom-operate-panel" aria-labelledby="skill-stages-heading" data-evidence-section="D" data-skill-zone="operate">
      ${renderZoneHeading({
        id: 'skill-stages-heading',
        kicker: zones.operate || dict.skill.sections.stagesBound,
        title: dict.skill.sections.stagesBound,
        hint: zones.operateHint || '',
      })}
      ${stagesBody}
      <div class="vbg-custom-acquire">
        <h3 class="vbg-heading-16 vbg-custom-acquire-title">${escapeHtml(zones.acquire || '')}</h3>
        <div class="vbg-custom-cta-row">
          ${upstreamCtaHtml}
          <button type="button" class="vbg-custom-cta-disabled" data-cta="install-placeholder" disabled aria-disabled="true">${escapeHtml(dict.skill.cta.installPlaceholder)}</button>
        </div>
        <p class="vbg-custom-zone-hint">${escapeHtml(dict.skill.cta.installHint)}</p>
      </div>
    </section>`;

  const evidenceGroups = normalizeEvidenceGroups(skill);
  const nonEmptyGroupBlocks = [];
  for (const kind of EVIDENCE_KIND_ORDER) {
    const items = evidenceGroups.get(kind) || [];
    if (items.length === 0) {
      continue;
    }
    const defaultLabelMap = {
      upstream: skill.repo
        ? `${dict.skill.evidenceLabels.upstreamDefault} (${skill.repo})`
        : dict.skill.evidenceLabels.upstreamDefault,
      review: dict.skill.evidenceLabels.reviewDefault,
      adoption: dict.skill.evidenceLabels.adoptionDefault,
      other: dict.skill.evidenceLabels.otherDefault,
    };

    const rows = items
      .map((link) => {
        const label =
          String(link.label || '').trim() ||
          defaultLabelMap[kind] ||
          getHostnameFallback(link.url);
        const verifiedLine = link.retrievedAt
          ? `<span class="vbg-caption">${escapeHtml(
              dict.skill.evidenceLabels.verifiedOnTemplate.replace(
                '{date}',
                link.retrievedAt,
              ),
            )}</span>`
          : '';
        const synthLine = link.synthesized
          ? `<span class="vbg-caption">${escapeHtml(dict.skill.evidenceLabels.synthesizedFootnote)}</span>`
          : '';
        return `<li class="vbg-custom-evidence-item">
            <a class="vbg-custom-inline-link vbg-custom-break" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} &#8599;</a>
            ${verifiedLine}
            ${synthLine}
          </li>`;
      })
      .join('\n');

    nonEmptyGroupBlocks.push(`<div class="vbg-custom-evidence-group" data-evidence-kind="${escapeHtml(kind)}">
        <h3 class="vbg-heading-16 vbg-custom-evidence-kind">${escapeHtml(dict.skill.evidenceGroups[kind])}</h3>
        <ul class="vbg-custom-evidence-list">
          ${rows}
        </ul>
      </div>`);
  }

  const evidenceBody =
    nonEmptyGroupBlocks.length > 0
      ? `<div class="vbg-custom-evidence-groups">${nonEmptyGroupBlocks.join('\n')}</div>`
      : `<p class="vbg-custom-empty-box">${escapeHtml(dict.skill.empty.evidence)}</p>`;
  const sectionE = `<section class="vbg-custom-support-block" aria-labelledby="skill-evidence-heading" data-evidence-section="E" data-skill-zone="sources">
      ${renderZoneHeading({
        id: 'skill-evidence-heading',
        kicker: zones.evidence || dict.skill.sections.evidence,
        title: dict.skill.sections.evidence,
        hint: zones.evidenceHint || '',
      })}
      ${evidenceBody}
    </section>`;

  const limitationsText = resolveKnownLimitations(
    copy.knownLimitations,
    skill.licenseSpdx,
    lang,
    dict.skill.ccBySaTemplate,
  );
  const limitationsBody = limitationsText
    ? `<div class="vbg-custom-callout-warning" role="note">
        <p>${escapeHtml(limitationsText)}</p>
      </div>`
    : `<p class="vbg-custom-empty-box">${escapeHtml(dict.skill.empty.knownLimitations)}</p>`;
  const sectionF = `<section class="vbg-custom-support-block" aria-labelledby="skill-limitations-heading" data-evidence-section="F" data-skill-zone="limits">
      ${renderZoneHeading({
        id: 'skill-limitations-heading',
        kicker: zones.limits || dict.skill.sections.knownLimitations,
        title: dict.skill.sections.knownLimitations,
      })}
      ${limitationsBody}
    </section>`;

  const reviewedValue = skill.reviewedAt
    ? dict.skill.metaLabels.reviewedAtValueTemplate.replace(
        '{date}',
        skill.reviewedAt,
      )
    : dict.skill.empty.reviewedAt;

  const repoDisplay = skill.subpath && skill.subpath !== '.'
    ? `${skill.repo} / ${skill.subpath}`
    : skill.repo || '';

  const sectionG = `<section class="vbg-custom-skill-rail" aria-labelledby="skill-meta-heading" data-evidence-section="G" data-skill-zone="specs">
      <div class="vbg-custom-zone-head">
        <h2 id="skill-meta-heading" class="vbg-heading-24 vbg-custom-zone-title">
          <span class="vbg-custom-zone-name">${escapeHtml(dict.skill.sections.meta)}</span>
        </h2>
        <p class="vbg-custom-zone-hint">${escapeHtml(zones.specsHint || '')}</p>
      </div>
      <dl class="vbg-custom-meta-grid">
        <div class="vbg-custom-meta-item">
          <dt class="vbg-custom-meta-term">${escapeHtml(dict.skill.metaLabels.reviewedAt)}</dt>
          <dd class="vbg-custom-meta-desc">${escapeHtml(reviewedValue)}</dd>
        </div>
        <div class="vbg-custom-meta-item">
          <dt class="vbg-custom-meta-term">${escapeHtml(dict.skill.metaLabels.agentsClaim)}</dt>
          <dd class="vbg-custom-meta-desc"><strong>${escapeHtml(claimInfo.badge)}</strong>: ${escapeHtml(claimInfo.description)}</dd>
        </div>
        <div class="vbg-custom-meta-item">
          <dt class="vbg-custom-meta-term">${escapeHtml(dict.skill.metaLabels.license)}</dt>
          <dd class="vbg-custom-meta-desc"><span class="vbg-mono">${escapeHtml(skill.licenseSpdx)}</span></dd>
        </div>
        <div class="vbg-custom-meta-item">
          <dt class="vbg-custom-meta-term">${escapeHtml(dict.skill.metaLabels.sourceRepo)}</dt>
          <dd class="vbg-custom-meta-desc"><span class="vbg-mono vbg-custom-break">${escapeHtml(repoDisplay)}</span></dd>
        </div>
        <div class="vbg-custom-meta-item">
          <dt class="vbg-custom-meta-term">${escapeHtml(dict.skill.metaLabels.revision)}</dt>
          <dd class="vbg-custom-meta-desc"><span class="vbg-mono vbg-custom-break">${escapeHtml(skill.revision)}</span></dd>
        </div>
        <div class="vbg-custom-meta-item">
          <dt class="vbg-custom-meta-term">${escapeHtml(dict.skill.metaLabels.skillId)}</dt>
          <dd class="vbg-custom-meta-desc"><span class="vbg-mono vbg-custom-break">${escapeHtml(skill.id)}</span></dd>
        </div>
      </dl>
    </section>`;

  return `<article class="vbg-custom-skill-page">
      <div class="vbg-custom-topbar">
        ${renderBreadcrumb({ dict, items: breadcrumbItems })}
        <div>
          <button
            type="button"
            class="vbg-custom-copy-btn"
            data-copy-skill-id="${escapeHtml(skill.id)}"
            data-copy-default="${escapeHtml(dict.skill.copySkillId)}"
            data-copy-copied="${escapeHtml(dict.skill.copiedSkillId)}"
          >${escapeHtml(dict.skill.copySkillId)}</button>
          <span class="vbg-visually-hidden" role="status" aria-live="polite" data-copy-status></span>
        </div>
      </div>
      <div class="vbg-custom-skill-identity">
        ${sectionA}
        ${sectionB}
      </div>
      <div class="vbg-custom-skill-layout">
        <div class="vbg-custom-skill-main">
          ${sectionC}
          ${sectionD}
          ${sectionE}
          ${sectionF}
        </div>
        ${sectionG}
      </div>
    </article>`;
}
