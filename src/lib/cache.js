'use strict';

const fs = require('fs');
const path = require('path');
const { CACHE_PATH } = require('./configPaths');
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
 * Validate that all name fields in meta exist in the cached lists.
 * Returns an array of error strings; empty means all valid.
 * Fields whose list is absent from the cache are silently skipped.
 */
function validateNames(meta, instanceCache, configCategories) {
  const errors = [];
  const projectId = lookupProjectId(instanceCache, meta.REDMINE_PROJECT);

  checkName(errors, instanceCache?.statuses,              meta.REDMINE_STATUS,      'status');
  checkName(errors, instanceCache?.priorities,            meta.REDMINE_PRIORITY,    'priority');
  checkName(errors, instanceCache?.projects,              meta.REDMINE_PROJECT,     'project');
  checkName(errors, instanceCache?.members?.[projectId],  meta.REDMINE_ASSIGNED_TO, 'assigned_to');
  checkName(errors, instanceCache?.versions?.[projectId], meta.REDMINE_VERSION,     'version');
  checkName(errors, configCategories,                     meta.REDMINE_CATEGORY,    'category');

  return errors;
}

/**
 * Look up the numeric ID for each name field in meta using the cached lists.
 * Returns a resolvedIds object suitable for passing to orgToPayload.
 * Fields that are empty or whose list is absent from the cache are omitted.
 */
function resolveNames(meta, instanceCache, configCategories) {
  const resolved = {};
  const projectId = lookupProjectId(instanceCache, meta.REDMINE_PROJECT);

  findId(instanceCache?.statuses,              meta.REDMINE_STATUS,      resolved, 'status_id');
  findId(instanceCache?.priorities,            meta.REDMINE_PRIORITY,    resolved, 'priority_id');
  findId(instanceCache?.projects,              meta.REDMINE_PROJECT,     resolved, 'project_id');
  findId(instanceCache?.members?.[projectId],  meta.REDMINE_ASSIGNED_TO, resolved, 'assigned_to_id');
  findId(instanceCache?.versions?.[projectId], meta.REDMINE_VERSION,     resolved, 'fixed_version_id');
  findId(configCategories,                     meta.REDMINE_CATEGORY,    resolved, 'category_id');

  return resolved;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function lookupProjectId(instanceCache, projectName) {
  if (!projectName || !instanceCache?.projects) return null;
  return instanceCache.projects.find(p => p.name === projectName)?.id ?? null;
}

function checkName(errors, list, name, label) {
  if (!name || !list) return;
  if (!list.find(item => item.name === name)) {
    const available = list.map(item => item.name).join(', ');
    errors.push(`Unknown ${label} "${name}". Available: ${available}`);
  }
}

function findId(list, name, resolved, key) {
  if (!name || !list) return;
  const found = list.find(item => item.name === name);
  if (found) resolved[key] = found.id;
}

module.exports = { getInstanceCache, setInstanceCache, isStale, validateNames, resolveNames, CACHE_PATH };
