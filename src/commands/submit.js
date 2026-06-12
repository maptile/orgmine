'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { RedmineClient, ConflictError } = require('../lib/redmine');
const { readOrgFile, writeOrgFile, orgToPayload, issueFilePath, findFileById } = require('../lib/orgFile');
const { loadConfig } = require('../lib/config');
const { promptMissingFields } = require('../lib/fieldSelector');
const { ask } = require('../lib/prompt');
const { getInstanceCache, isStale, validateNames, resolveNames } = require('../lib/cache');
const { showIssueDiff } = require('../lib/diff');
const { planStatusChange, updateWithStatusWorkflow } = require('../lib/statusWorkflow');

async function submit(fileOrId, cmdConfig, options) {
  const isId = /^\d+$/.test(fileOrId);

  // ── resolve file path (no I/O yet) ────────────────────────────────────────
  const filePath = isId ? findById(fileOrId, cmdConfig) : fileOrId;

  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`File not found: ${filePath}`));
    process.exit(1);
  }

  const { meta, description } = readOrgFile(filePath);

  // ── load full config ──────────────────────────────────────────────────────
  const instanceName = cmdConfig.instanceName || meta.REDMINE_INSTANCE;
  if (!instanceName) {
    console.error(chalk.red('Cannot determine target instance. Set #+REDMINE_INSTANCE in the file or use -i <instance>'));
    process.exit(1);
  }
  const config = instanceName !== cmdConfig.instanceName
    ? loadConfig(instanceName, {})
    : cmdConfig;

  if (!meta.TITLE?.trim()) {
    console.error(chalk.red('#+TITLE must not be empty'));
    process.exit(1);
  }

  // ── stale cache warning ───────────────────────────────────────────────────
  const instanceCache = getInstanceCache(config.instanceName);
  if (isStale(instanceCache)) {
    console.warn(chalk.yellow('⚠  Lookup cache is missing or older than 1 week. Run: orgmine refresh'));
  }

  // ── block on validation errors ────────────────────────────────────────────
  const validationErrors = validateNames(meta, instanceCache, config.categories);
  if (validationErrors.length > 0) {
    validationErrors.forEach(e => console.error(chalk.red(`✗ ${e}`)));
    process.exit(1);
  }

  // ── prepare final payload and confirmation ────────────────────────────────
  const client = new RedmineClient(config);
  const issueId = meta.REDMINE_ID;
  const isNew = !issueId;
  let serverIssue = null;
  let statusPlan = null;

  if (!isNew) {
    console.log(chalk.dim(`Fetching #${issueId} from server…`));
    try {
      serverIssue = await client.getIssue(issueId);
    } catch (e) {
      console.error(chalk.red(`Cannot compare with Redmine: ${e.message}`));
      console.error(chalk.red('Submit stopped without changing the remote issue.'));
      process.exit(1);
    }
  }

  const projectId = meta.REDMINE_PROJECT;
  if (projectId) {
    const fieldUpdates = await promptMissingFields(client, projectId, meta, config);
    Object.assign(meta, fieldUpdates);
  }

  // Resolve names after prompts fill any gaps, so the confirmation covers the
  // exact payload that will be sent.
  const resolvedIds = resolveNames(meta, instanceCache, config.categories);
  if (!isNew) {
    checkUnresolvableChanges(meta, resolvedIds, serverIssue, instanceCache);
  }
  const payload = orgToPayload(meta, description, resolvedIds);
  if (!isNew && serverIssue.lock_version != null) {
    payload.lock_version = Number(serverIssue.lock_version);
  }

  if (isNew) {
    const answer = await ask(`Create new issue "${meta.TITLE}"? [y/N] `);
    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled');
      process.exit(0);
    }
  } else {
    const hasChanges = showIssueDiff(meta, description, serverIssue);
    if (!hasChanges) {
      console.log(chalk.dim('No changes — nothing to submit.'));
      process.exit(0);
    }

    statusPlan = planStatusChange({
      serverIssue,
      targetStatusName: meta.REDMINE_STATUS,
      statuses: instanceCache?.statuses,
      statusTransitions: config.statusTransitions,
    });
    if (statusPlan) {
      const trackerName = serverIssue.tracker?.name || 'unknown';
      if (statusPlan.configured) {
        console.log(chalk.yellow(
          `Status path (${trackerName}): ${statusPlan.path.join(' -> ')}`
        ));
      } else {
        console.warn(chalk.yellow(
          `No statusTransitions configuration found for tracker "${trackerName}".`
        ));
        console.warn(chalk.yellow(
          `Direct status change will be attempted: ${statusPlan.path.join(' -> ')}`
        ));
      }
    }

    const answer = await ask('Submit? [y/N] ');
    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled');
      process.exit(0);
    }
  }

  if (isNew) {
    await createIssue(client, config, filePath, meta, description, payload);
  } else {
    await updateIssue(
      client,
      config,
      filePath,
      meta,
      description,
      payload,
      issueId,
      options,
      serverIssue,
      statusPlan
    );
  }
}

// Find file by issue ID or exit with an error message.
function findById(issueId, config) {
  const matches = findFileById(config.localDir, issueId);
  if (matches.length === 0) {
    console.error(chalk.red(`No local file found for issue #${issueId}`));
    console.error(chalk.dim(`Fetch it first: orgmine fetch ${issueId}`));
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(chalk.red(`Multiple files found for issue #${issueId}:`));
    matches.forEach(f => console.error(`  ${f}`));
    process.exit(1);
  }
  return matches[0];
}

async function createIssue(client, config, filePath, meta, description, payload) {
  if (!payload.project_id && !meta.REDMINE_PROJECT) {
    console.error(chalk.red('#+REDMINE_PROJECT is required when creating a new issue'));
    process.exit(1);
  }

  // Fall back to project name as identifier if no numeric ID is set
  if (!payload.project_id && meta.REDMINE_PROJECT) {
    payload.project_id = meta.REDMINE_PROJECT;
  }

  let created;
  try {
    created = await client.createIssue(payload);
  } catch (e) {
    console.error(chalk.red(`Create failed: ${e.message}`));
    process.exit(1);
  }

  const newMeta = {
    ...meta,
    REDMINE_ID: String(created.id),
    REDMINE_STATUS: created.status?.name || meta.REDMINE_STATUS,
    REDMINE_STATUS_ID: String(created.status?.id || meta.REDMINE_STATUS_ID),
    REDMINE_LOCK_VERSION: String(created.lock_version ?? 0),
    REDMINE_CREATED_ON: created.created_on || '',
    REDMINE_UPDATED_ON: created.updated_on || '',
  };

  const newPath = issueFilePath(
    config.localDir,
    created.project?.name || meta.REDMINE_PROJECT || 'unknown',
    created.id,
    created.subject
  );

  writeOrgFile(newPath, newMeta, description);

  if (path.resolve(filePath) !== path.resolve(newPath)) {
    fs.unlinkSync(filePath);
    console.log(chalk.dim(`Draft moved to: ${newPath}`));
  }

  console.log(chalk.green(`✓ Issue created: #${created.id} ${created.subject}`));
  console.log(`  Local file: ${newPath}`);
}

async function updateIssue(
  client,
  config,
  filePath,
  meta,
  description,
  payload,
  issueId,
  options,
  serverIssue,
  statusPlan
) {
  try {
    await updateWithStatusWorkflow({
      client,
      issueId,
      payload,
      serverIssue,
      statuses: getInstanceCache(config.instanceName)?.statuses,
      statusTransitions: config.statusTransitions,
      statusPlan,
      force: options.force,
      onTransition: ({ from, to, step, total }) => {
        if (total > 1) {
          console.log(chalk.dim(`  Status ${step}/${total}: ${from} -> ${to}`));
        }
      },
    });
  } catch (e) {
    if (e instanceof ConflictError) {
      printConflictHelp(issueId);
      process.exit(1);
    }
    console.error(chalk.red(`Submit failed: ${e.message}`));
    process.exit(1);
  }

  // Refresh lock_version from the server, then do a single write that includes
  // both the user's field selections and the updated server metadata.
  let latest;
  try {
    latest = await client.getIssue(issueId);
  } catch (_) {
    console.warn(chalk.yellow('Warning: could not refresh lock_version — next submit may report a conflict'));
  }

  writeOrgFile(filePath, {
    ...meta,
    ...(latest ? {
      REDMINE_STATUS: latest.status?.name || meta.REDMINE_STATUS,
      REDMINE_LOCK_VERSION: String(latest.lock_version ?? ''),
      REDMINE_UPDATED_ON: latest.updated_on || '',
    } : {}),
  }, description);

  console.log(chalk.green(`✓ Issue #${issueId} updated`));
}

// Detect fields that the user changed locally but whose ID couldn't be resolved
// from the cache (so they would be silently dropped from the API payload).
function checkUnresolvableChanges(meta, resolvedIds, serverIssue, instanceCache) {
  const checks = [
    { local: meta.REDMINE_STATUS,      server: serverIssue?.status?.name,         id: resolvedIds.status_id,        label: 'status',   cacheKey: 'statuses' },
    { local: meta.REDMINE_PRIORITY,    server: serverIssue?.priority?.name,        id: resolvedIds.priority_id,      label: 'priority', cacheKey: 'priorities' },
    { local: meta.REDMINE_ASSIGNED_TO, server: serverIssue?.assigned_to?.name,     id: resolvedIds.assigned_to_id,   label: 'assignee', cacheKey: 'members' },
    { local: meta.REDMINE_VERSION,     server: serverIssue?.fixed_version?.name,   id: resolvedIds.fixed_version_id, label: 'version',  cacheKey: 'versions' },
    { local: meta.REDMINE_CATEGORY,    server: serverIssue?.category?.name,        id: resolvedIds.category_id,      label: 'category', cacheKey: null },
  ];

  const problems = [];
  for (const { local, server, id, label, cacheKey } of checks) {
    if (!local) continue;
    const changed = local !== (server || '');
    if (changed && id == null) {
      const hint = cacheKey
        ? (instanceCache?.[cacheKey]
            ? `"${local}" not found in cache — check spelling or run: orgmine refresh`
            : `no cached ${label} list — run: orgmine refresh`)
        : `"${local}" not found in config categories`;
      problems.push(`Cannot resolve ${label} "${local}": ${hint}`);
    }
  }

  if (problems.length > 0) {
    problems.forEach(p => console.error(chalk.red(`✗ ${p}`)));
    process.exit(1);
  }
}

function printConflictHelp(issueId) {
  console.error(chalk.red.bold(`\n⚠  Edit conflict: #${issueId}`));
  console.error(chalk.red('The issue was modified by someone else since your last fetch'));
  console.error('');
  console.error('Options:');
  console.error(`  1. Re-fetch (recommended): ${chalk.cyan(`orgmine fetch ${issueId}`)}`);
  console.error('     This shows remote/local differences and asks before overwriting');
  console.error(`  2. Force overwrite: ${chalk.cyan(`orgmine submit <file> --force`)}`);
  console.error(`     Your version wins; the other person's changes will be lost`);
}

module.exports = { submit };
