export function initSearchBox(root) {
  const searchSection = root.querySelector('[data-search-root]');
  if (!searchSection) {
    return null;
  }

  const input = searchSection.querySelector('[data-search-input]');
  const statusEl = searchSection.querySelector('[data-search-status]');
  const emptyEl = searchSection.querySelector('[data-search-empty]');
  const listEl = searchSection.querySelector('[data-search-results]');
  const items = Array.from(searchSection.querySelectorAll('[data-search-item]'));

  if (!input || !statusEl || !emptyEl || !listEl) {
    return null;
  }

  const defaultStatus = searchSection.getAttribute('data-status-default') || '';
  const matchedTemplate = searchSection.getAttribute('data-status-matched') || '{count}';

  function applyQuery(rawQuery) {
    const query = String(rawQuery ?? '').trim().toLowerCase();
    if (!query) {
      listEl.hidden = true;
      emptyEl.hidden = true;
      for (const item of items) {
        item.hidden = true;
      }
      statusEl.textContent = defaultStatus;
      return { query: '', matchedCount: 0 };
    }

    let matchedCount = 0;
    for (const item of items) {
      const haystack = (item.getAttribute('data-search-keywords') || '').toLowerCase();
      const matched = haystack.includes(query);
      item.hidden = !matched;
      if (matched) {
        matchedCount += 1;
      }
    }

    if (matchedCount > 0) {
      listEl.hidden = false;
      emptyEl.hidden = true;
    } else {
      listEl.hidden = true;
      emptyEl.hidden = false;
    }
    statusEl.textContent = matchedTemplate.replace('{count}', String(matchedCount));
    return { query, matchedCount };
  }

  input.addEventListener('input', () => {
    applyQuery(input.value);
  });

  if (input.value) {
    applyQuery(input.value);
  }

  return { applyQuery };
}

export function initMobileNav(root) {
  const details = root.querySelector('[data-mobile-nav]');
  if (!details) {
    return;
  }

  details.addEventListener('click', (event) => {
    const target = event.target;
    if (target && typeof target.closest === 'function' && target.closest('a')) {
      details.open = false;
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && details.open) {
      details.open = false;
    }
  });
}

export function initFromStageHighlight(
  root,
  locationSearch = typeof window !== 'undefined' ? window.location.search : '',
) {
  if (!locationSearch) {
    return null;
  }
  const params = new URLSearchParams(locationSearch);
  const fromStage = (params.get('fromStage') || '').trim();
  if (!/^T\d{2}\.s[1-3]$/.test(fromStage)) {
    return null;
  }

  const chips = Array.from(root.querySelectorAll('[data-stage-chip]'));
  let highlightedChip = null;
  for (const chip of chips) {
    const isMatch = chip.getAttribute('data-stage-chip') === fromStage;
    chip.setAttribute('data-highlighted', isMatch ? 'true' : 'false');
    if (isMatch) {
      highlightedChip = chip;
    }
  }
  return highlightedChip;
}

export function initCopySkillId(root, options = {}) {
  const copyBtn = root.querySelector('[data-copy-skill-id]');
  if (!copyBtn) {
    return null;
  }
  const statusEl = root.querySelector('[data-copy-status]');
  const skillId = copyBtn.getAttribute('data-copy-skill-id') || '';
  const defaultLabel = copyBtn.getAttribute('data-copy-default') || 'Copy skillId';
  const copiedLabel = copyBtn.getAttribute('data-copy-copied') || 'Copied';

  const writeText =
    options.writeText ||
    (async (text) => {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    });

  const scheduleReset =
    options.scheduleReset ||
    ((fn) => {
      setTimeout(fn, 2000);
    });

  copyBtn.addEventListener('click', async () => {
    try {
      await writeText(skillId);
      copyBtn.textContent = copiedLabel;
      if (statusEl) {
        statusEl.textContent = `${copiedLabel}: ${skillId}`;
      }
      scheduleReset(() => {
        copyBtn.textContent = defaultLabel;
      });
    } catch {
      // Leave button in default state if clipboard access is denied
    }
  });

  return copyBtn;
}

export function initSiteEnhancements(root = document) {
  initSearchBox(root);
  initMobileNav(root);
  initFromStageHighlight(root);
  initCopySkillId(root);
}

if (typeof document !== 'undefined') {
  initSiteEnhancements(document);
}
