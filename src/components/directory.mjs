import { escapeHtml, getLocalizedLabel, renderBreadcrumb } from './shell.mjs';

export function renderTaskCard({ lang, dict, task }) {
  const taskTitle = getLocalizedLabel(task.title, lang, task.id);
  const stageShortNames = task.stages
    .map((st) => getLocalizedLabel(st.shortName, lang, st.id))
    .join(' · ');
  const countText =
    lang === 'en' && task.skillCount === 1
      ? '1 curated skill'
      : dict.directory.skillCountLabel.replace('{count}', String(task.skillCount));

  return `<li class="vbg-custom-row-card" data-task-card="${escapeHtml(task.id)}">
    <div class="vbg-custom-row-header">
      <a class="vbg-custom-inline-link vbg-custom-card-title" href="/${lang}/tasks/${escapeHtml(task.id)}.html">
        <span class="vbg-mono">${escapeHtml(task.id)}</span> · ${escapeHtml(taskTitle)}
      </a>
      <span class="vbg-custom-badge">${escapeHtml(countText)}</span>
    </div>
    <p class="vbg-custom-excerpt">${escapeHtml(dict.directory.stagesPrefix)}${escapeHtml(stageShortNames)}</p>
  </li>`;
}

export function renderDirectoryMain({ lang, dict, directory }) {
  const dirTitle = getLocalizedLabel(directory.title, lang, directory.id);
  const breadcrumb = renderBreadcrumb({
    dict,
    items: [
      { label: dict.breadcrumb.home, href: `/${lang}/index.html` },
      { label: dirTitle },
    ],
  });

  const taskContent =
    directory.tasks.length > 0
      ? `<ul class="vbg-custom-card-stack">
          ${directory.tasks.map((task) => renderTaskCard({ lang, dict, task })).join('\n')}
        </ul>`
      : `<p class="vbg-custom-empty-box">${escapeHtml(dict.directory.emptyTasks)}</p>`;

  return `<div>
      <div class="vbg-custom-topbar">
        ${breadcrumb}
      </div>
      <div class="vbg-custom-hero">
        <p class="vbg-meta"><span class="vbg-mono">${escapeHtml(directory.id)}</span></p>
        <h1 class="vbg-title">${escapeHtml(dirTitle)}</h1>
      </div>
    </div>

    <section class="vbg-custom-section-block" aria-labelledby="directory-tasks-heading">
      <h2 id="directory-tasks-heading" class="vbg-heading-24">${escapeHtml(dict.directory.tasksHeading)}</h2>
      ${taskContent}
    </section>`;
}
