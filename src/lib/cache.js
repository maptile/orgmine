'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_PATH = path.join(os.homedir(), '.config', 'orgmine', 'cache.json');
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function loadAll() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch (_) {
    return {};
  }
}

function saveAll(data) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function getInstanceCache(instanceName) {
  return loadAll()[instanceName] || null;
}

function setInstanceCache(instanceName, data) {
  const all = loadAll();
  all[instanceName] = { ...data, fetchedAt: new Date().toISOString() };
  saveAll(all);
}

function isStale(instanceCache) {
  if (!instanceCache?.fetchedAt) return true;
  return Date.now() - new Date(instanceCache.fetchedAt).getTime() > ONE_WEEK_MS;
}

/**
 * Validate all ID/name fields in meta.
 *
 * instanceCache  — loaded from cache.json for this instance
 * configCategories — the `categories` array from config (may be undefined)
 *
 * Returns an array of error strings (empty = all valid).
 * Fields whose list is absent from the cache are silently skipped.
 */
function validateMeta(meta, instanceCache, configCategories) {
  const errors = [];
  const projectId = meta.REDMINE_PROJECT_ID;

  // ── global lookups ────────────────────────────────────────────────────────
  checkField(errors, instanceCache?.statuses,
    meta.REDMINE_STATUS_ID, meta.REDMINE_STATUS, 'status');

  checkField(errors, instanceCache?.priorities,
    meta.REDMINE_PRIORITY_ID, meta.REDMINE_PRIORITY, 'priority');

  checkField(errors, instanceCache?.projects,
    meta.REDMINE_PROJECT_ID, meta.REDMINE_PROJECT, 'project');

  // ── per-project lookups ───────────────────────────────────────────────────
  if (projectId) {
    checkField(errors, instanceCache?.members?.[projectId],
      meta.REDMINE_ASSIGNED_TO_ID, meta.REDMINE_ASSIGNED_TO, 'assigned_to');

    checkField(errors, instanceCache?.versions?.[projectId],
      meta.REDMINE_VERSION_ID, meta.REDMINE_VERSION, 'version');
  }

  // ── category from config ──────────────────────────────────────────────────
  checkField(errors, configCategories,
    meta.REDMINE_CATEGORY_ID, meta.REDMINE_CATEGORY, 'category');

  return errors;
}

/**
 * Check that:
 *  1. If id is set, it exists in list.
 *  2. If both id and name are set, they agree.
 *
 * list items must have { id: number, name: string }.
 */
function checkField(errors, list, id, name, label) {
  if (!id && !name) return;
  if (!list) return; // no cache data for this field — skip

  if (id) {
    const found = list.find(item => item.id === Number(id));
    if (!found) {
      const available = list.map(item => `${item.id}=${item.name}`).join(', ');
      errors.push(`Invalid ${label} ID "${id}". Available: ${available}`);
      return; // skip name check when ID is already wrong
    }
    if (name && found.name !== name) {
      errors.push(`${label} name "${name}" does not match ID ${id} (should be "${found.name}")`);
    }
  }
}

module.exports = { getInstanceCache, setInstanceCache, isStale, validateMeta, CACHE_PATH };
