import { escapeHtml, getLocalizedLabel } from './shell.mjs';

export function renderDirectoryCard({ lang, dict, directory }) {
  const title = getLocalizedLabel(directory.title, lang, directory.id);
  const taskStat =
    lang === 'en' && directory.taskCount === 1
      ? '1 task'
      : `${directory.taskCount} ${dict.home.directoriesCountUnit}`;
  const skillStat =
    lang === 'en' && directory.skillCount === 1
      ? '1 skill'
      : `${directory.skillCount} ${dict.home.skillsCountUnit}`;

  return `<li class="vbg-custom-dir-card" data-directory-card="${escapeHtml(directory.id)}">
    <a class="vbg-custom-card-link" href="/${lang}/directories/${escapeHtml(directory.id)}.html">
      <div class="vbg-custom-card-top">
        <span class="vbg-meta"><span class="vbg-mono">${escapeHtml(directory.id)}</span></span>
        <span class="vbg-custom-card-title">${escapeHtml(title)}</span>
      </div>
      <span class="vbg-custom-card-meta">${escapeHtml(taskStat)} · ${escapeHtml(skillStat)}</span>
    </a>
  </li>`;
}

function buildSearchItems({ lang, dict, directories, tasks, skills, directoriesById }) {
  const items = [];

  for (const dir of directories) {
    const title = getLocalizedLabel(dir.title, lang, dir.id);
    items.push({
      kindLabel: dict.home.searchKindDirectory,
      code: dir.id,
      title,
      href: `/${lang}/directories/${dir.id}.html`,
      keywords: `${dir.id} ${title}`.toLowerCase(),
    });
  }

  for (const task of tasks) {
    const title = getLocalizedLabel(task.title, lang, task.id);
    const parentDir = directoriesById.get(task.directoryId);
    const parentTitle = parentDir ? getLocalizedLabel(parentDir.title, lang, parentDir.id) : '';
    const stageText = task.stages
      .map((st) => getLocalizedLabel(st.shortName, lang, st.id))
      .join(' · ');
    items.push({
      kindLabel: dict.home.searchKindTask,
      code: task.id,
      title,
      context: parentTitle ? `${parentTitle} · ${stageText}` : stageText,
      href: `/${lang}/tasks/${task.id}.html`,
      keywords: `${task.id} ${title} ${parentTitle} ${stageText}`.toLowerCase(),
    });
  }

  for (const skill of skills) {
    const copy = skill.copy[lang];
    items.push({
      kindLabel: dict.home.searchKindSkill,
      code: skill.name,
      title: copy.title,
      context: skill.stagesBound.join(', '),
      href: `/${lang}/skills/${skill.stableSlug}.html`,
      keywords: `${copy.title} ${skill.name} ${skill.stableSlug} ${skill.stagesBound.join(' ')} ${copy.summary}`.toLowerCase(),
    });
  }

  return items;
}

export function renderHomeMain({
  lang,
  dict,
  directories,
  tasks,
  skills,
  directoriesById,
}) {
  const dirCards = directories
    .map((directory) => renderDirectoryCard({ lang, dict, directory }))
    .join('\n');

  const searchItems = buildSearchItems({
    lang,
    dict,
    directories,
    tasks,
    skills,
    directoriesById,
  });

  const searchResultRows = searchItems
    .map((item) => {
      const contextBit = item.context
        ? `<span class="vbg-custom-card-meta">${escapeHtml(item.context)}</span>`
        : '';
      return `<li class="vbg-custom-search-item" data-search-item data-search-keywords="${escapeHtml(item.keywords)}" hidden>
        <div>
          <span class="vbg-custom-badge">${escapeHtml(item.kindLabel)}</span>
          <a class="vbg-custom-inline-link" href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a>
          <span class="vbg-meta"> (<span class="vbg-mono">${escapeHtml(item.code)}</span>)</span>
        </div>
        ${contextBit}
      </li>`;
    })
    .join('\n');

  const curationBullets = dict.home.curationPoints
    .map((pt) => `<li>${escapeHtml(pt)}</li>`)
    .join('\n');

  return `<section class="vbg-custom-hero" aria-labelledby="home-title">
      <h1 id="home-title" class="vbg-title">${escapeHtml(dict.home.title)}</h1>
      <p class="vbg-lede">${escapeHtml(dict.home.lede)}</p>
    </section>

    <section class="vbg-custom-section-block" aria-labelledby="home-directories-heading">
      <h2 id="home-directories-heading" class="vbg-heading-24">${escapeHtml(dict.home.directoriesHeading)}</h2>
      <ul class="vbg-custom-dir-grid">
        ${dirCards}
      </ul>
    </section>

    <section class="vbg-custom-section-block" aria-labelledby="home-search-heading" data-search-root data-status-default="${escapeHtml(dict.home.searchStatusDefault)}" data-status-matched="${escapeHtml(dict.home.searchStatusMatched)}">
      <h2 id="home-search-heading" class="vbg-heading-24">${escapeHtml(dict.home.searchHeading)}</h2>
      <div class="vbg-custom-search-box">
        <label class="vbg-label" for="site-search-input">${escapeHtml(dict.home.searchLabel)}</label>
        <input
          id="site-search-input"
          class="vbg-custom-search-input"
          type="search"
          autocomplete="off"
          placeholder="${escapeHtml(dict.home.searchPlaceholder)}"
          data-search-input
        >
        <p id="site-search-status" class="vbg-meta" role="status" aria-live="polite" data-search-status>${escapeHtml(dict.home.searchStatusDefault)}</p>
        <p id="site-search-empty" class="vbg-custom-empty-box" data-search-empty hidden>${escapeHtml(dict.home.searchEmpty)}</p>
        <ul class="vbg-custom-search-results" data-search-results hidden>
          ${searchResultRows}
        </ul>
      </div>
    </section>

    <section class="vbg-custom-section-block" aria-labelledby="home-curation-heading">
      <h2 id="home-curation-heading" class="vbg-heading-24">${escapeHtml(dict.home.curationHeading)}</h2>
      <ul class="vbg-custom-bullet-list">
        ${curationBullets}
      </ul>
    </section>`;
}
