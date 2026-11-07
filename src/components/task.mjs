import { escapeHtml, getLocalizedLabel, renderBreadcrumb } from './shell.mjs';

function makeSummaryExcerpt(summary, lang) {
  const text = String(summary ?? '').trim();
  if (!text) {
    return '';
  }
  const maxLen = lang === 'zh' ? 58 : 116;
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen).trimEnd()}…`;
}

export function renderStageChip({ stageId, label = '', href = '', highlighted = false, extraDataAttr = '' }) {
  const content = label
    ? `<span class="vbg-mono">${escapeHtml(stageId)}</span><span>·</span><span>${escapeHtml(label)}</span>`
    : `<span class="vbg-mono">${escapeHtml(stageId)}</span>`;
  const hlAttr = highlighted ? ' data-highlighted="true"' : '';
  const dataAttr = extraDataAttr ? ` ${extraDataAttr}` : '';
  if (href) {
    return `<a class="vbg-custom-chip" href="${escapeHtml(href)}"${hlAttr}${dataAttr}>${content}</a>`;
  }
  return `<span class="vbg-custom-chip"${hlAttr}${dataAttr}>${content}</span>`;
}

export function renderSkillCard({ lang, dict, skill, stage }) {
  const copy = skill.copy[lang];
  const excerpt = makeSummaryExcerpt(copy.summary, lang);
  const skillHref = `/${lang}/skills/${skill.stableSlug}.html?fromStage=${encodeURIComponent(stage.id)}`;

  const excerptHtml = excerpt
    ? `<p class="vbg-custom-excerpt">${escapeHtml(excerpt)}</p>`
    : '';

  return `<li class="vbg-custom-row-card" data-skill-card="${escapeHtml(skill.stableSlug)}">
    <div class="vbg-custom-row-header">
      <a class="vbg-custom-inline-link vbg-custom-card-title" href="${escapeHtml(skillHref)}">${escapeHtml(copy.title)}</a>
      <span class="vbg-meta"><span class="vbg-mono">${escapeHtml(skill.name)}</span></span>
    </div>
    ${excerptHtml}
    <div class="vbg-custom-row-footer">
      ${renderStageChip({ stageId: stage.id })}
      <a class="vbg-custom-inline-link vbg-meta" href="${escapeHtml(skill.upstreamUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(dict.task.upstreamShort)} &#8599;</a>
    </div>
  </li>`;
}

export function renderTaskMain({ lang, dict, task, directory, skillsBySlug }) {
  const dirTitle = getLocalizedLabel(directory.title, lang, directory.id);
  const taskTitle = getLocalizedLabel(task.title, lang, task.id);

  const breadcrumb = renderBreadcrumb({
    dict,
    items: [
      { label: dict.breadcrumb.home, href: `/${lang}/index.html` },
      { label: dirTitle, href: `/${lang}/directories/${directory.id}.html` },
      { label: taskTitle },
    ],
  });

  const stageNavChips = task.stages
    .map((stage) => {
      const shortName = getLocalizedLabel(stage.shortName, lang, stage.id);
      return `<li>${renderStageChip({
        stageId: stage.anchorId,
        label: shortName,
        href: `#${stage.anchorId}`,
      })}</li>`;
    })
    .join('\n');

  const stageSections = task.stages
    .map((stage) => {
      const shortName = getLocalizedLabel(stage.shortName, lang, stage.id);
      const stageSkills = stage.skillSlugs
        .map((slug) => skillsBySlug.get(slug))
        .filter(Boolean);

      const listHtml =
        stageSkills.length > 0
          ? `<ul class="vbg-custom-card-stack">
              ${stageSkills.map((skill) => renderSkillCard({ lang, dict, skill, stage })).join('\n')}
            </ul>`
          : `<p class="vbg-custom-empty-box">${escapeHtml(dict.task.emptyStageSkills)}</p>`;

      return `<section id="${escapeHtml(stage.anchorId)}" class="vbg-custom-section-block" aria-labelledby="heading-${escapeHtml(stage.anchorId)}" data-stage-section="${escapeHtml(stage.id)}">
        <div class="vbg-custom-section-head">
          <h2 id="heading-${escapeHtml(stage.anchorId)}" class="vbg-heading-24"><span class="vbg-mono">${escapeHtml(stage.anchorId)}</span> · ${escapeHtml(shortName)}</h2>
          <span class="vbg-meta"><span class="vbg-mono">${escapeHtml(stage.id)}</span></span>
        </div>
        ${listHtml}
      </section>`;
    })
    .join('\n');

  return `<div>
      <div class="vbg-custom-topbar">
        ${breadcrumb}
      </div>
      <div class="vbg-custom-hero">
        <p class="vbg-meta"><span class="vbg-mono">${escapeHtml(task.id)}</span></p>
        <h1 class="vbg-title">${escapeHtml(taskTitle)}</h1>
        <p class="vbg-meta">${escapeHtml(dict.task.parentDirectoryPrefix)}<a class="vbg-custom-inline-link" href="/${lang}/directories/${escapeHtml(directory.id)}.html">${escapeHtml(dirTitle)}</a></p>
      </div>
    </div>

    <nav aria-label="${escapeHtml(dict.task.stageNavLabel)}">
      <ul class="vbg-custom-chip-row">
        ${stageNavChips}
      </ul>
    </nav>

    ${stageSections}`;
}
