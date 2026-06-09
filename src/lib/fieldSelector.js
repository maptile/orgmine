'use strict';

const chalk = require('chalk');
const { askChoiceOrSkip } = require('./prompt');

/**
 * Fetch assignee / category / version options from the API and prompt the user
 * to select each field that is currently empty in meta.
 *
 * Returns an object with the meta keys to merge (only the fields the user
 * actually selected). Fields that are already set in meta are left alone.
 */
async function promptMissingFields(client, projectId, meta, config = {}) {
  const updates = {};

  await promptAssignee(client, projectId, meta, updates);
  await promptCategory(client, projectId, meta, updates, config.categories);
  await promptVersion(client, projectId, meta, updates);

  return updates;
}

async function promptAssignee(client, projectId, meta, updates) {
  if (meta.REDMINE_ASSIGNED_TO) return;

  const members = await fetchSafe(() => client.getProjectMembers(projectId), 'members');
  if (!members || members.length === 0) return;

  const selected = await askChoiceOrSkip('Assignee:', members, m => m.name);
  if (selected) updates.REDMINE_ASSIGNED_TO = selected.name;
}

async function promptCategory(client, projectId, meta, updates, configCategories) {
  if (meta.REDMINE_CATEGORY) return;

  let categories = await fetchSafe(() => client.getIssueCategories(projectId), 'categories');

  // Fall back to static list from config when the API is not accessible
  if (!categories || categories.length === 0) {
    categories = configCategories || [];
  }

  if (categories.length === 0) return;

  const selected = await askChoiceOrSkip('Category:', categories, c => c.name);
  if (selected) updates.REDMINE_CATEGORY = selected.name;
}

async function promptVersion(client, projectId, meta, updates) {
  if (meta.REDMINE_VERSION) return;

  const versions = await fetchSafe(() => client.getVersions(projectId), 'versions');
  if (!versions || versions.length === 0) return;

  const open = versions
    .filter(v => v.status !== 'closed')
    .sort((a, b) => compareSemver(a.name, b.name));

  if (open.length === 0) return;

  const selected = await askChoiceOrSkip('Version:', open, v => v.name);
  if (selected) updates.REDMINE_VERSION = selected.name;
}

/**
 * Compare two version strings semantically (ascending).
 * Strips a leading "v/V", splits on "." or "-", compares each segment
 * numerically where possible, falls back to string comparison.
 * Non-parseable names sort after numeric ones.
 */
function compareSemver(a, b) {
  const parse = str => str.replace(/^[vV]/, '').split(/[.\-]/).map(p => {
    const n = parseInt(p, 10);
    return isNaN(n) ? p : n;
  });

  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      if (va !== vb) return va - vb;
    } else if (typeof va === 'number') {
      return -1; // numeric before non-numeric
    } else if (typeof vb === 'number') {
      return 1;
    } else {
      const c = String(va).localeCompare(String(vb));
      if (c !== 0) return c;
    }
  }
  return 0;
}

async function fetchSafe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.warn(chalk.yellow(`Warning: could not fetch ${label}: ${e.message}`));
    return null;
  }
}

module.exports = { promptMissingFields };
