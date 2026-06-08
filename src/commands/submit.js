'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { RedmineClient, ConflictError } = require('../lib/redmine');
const { readOrgFile, writeOrgFile, orgToPayload, issueFilePath } = require('../lib/orgFile');
const { loadConfig } = require('../lib/config');

async function submit(filePath, cmdConfig, options) {
  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`File not found: ${filePath}`));
    process.exit(1);
  }

  const { meta, description } = readOrgFile(filePath);

  // Prefer the instance from CLI flag; fall back to the one stored in the file
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

  const client = new RedmineClient(config);
  const issueId = meta.REDMINE_ID;
  const isNew = !issueId;

  const payload = orgToPayload(meta, description);

  if (isNew) {
    await createIssue(client, config, filePath, meta, description, payload);
  } else {
    await updateIssue(client, config, filePath, meta, description, payload, issueId, options);
  }
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

async function updateIssue(client, config, filePath, meta, description, payload, issueId, options) {
  // --force: drop lock_version so Redmine skips conflict detection
  let actualPayload = payload;
  if (options.force) {
    const { lock_version: _, ...rest } = payload;
    actualPayload = rest;
  }

  try {
    await client.updateIssue(issueId, actualPayload);
  } catch (e) {
    if (e instanceof ConflictError) {
      printConflictHelp(issueId);
      process.exit(1);
    }
    console.error(chalk.red(`Submit failed: ${e.message}`));
    process.exit(1);
  }

  // Refresh lock_version from the server so the next submit won't conflict.
  // Only the network call is non-fatal; a write failure is a real error.
  let latest;
  try {
    latest = await client.getIssue(issueId);
  } catch (_) {
    console.warn(chalk.yellow('Warning: could not refresh lock_version — next submit may report a conflict'));
    latest = null;
  }
  if (latest) {
    const updatedMeta = {
      ...meta,
      REDMINE_LOCK_VERSION: String(latest.lock_version ?? ''),
      REDMINE_UPDATED_ON: latest.updated_on || '',
    };
    writeOrgFile(filePath, updatedMeta, description);
  }

  console.log(chalk.green(`✓ Issue #${issueId} updated`));
}

function printConflictHelp(issueId) {
  console.error(chalk.red.bold(`\n⚠  Edit conflict: #${issueId}`));
  console.error(chalk.red('The issue was modified by someone else since your last fetch'));
  console.error('');
  console.error('Options:');
  console.error(`  1. Re-fetch (recommended): ${chalk.cyan(`orgmine fetch ${issueId}`)}`);
  console.error(`     This overwrites your local file — back up your changes first`);
  console.error(`  2. Force overwrite: ${chalk.cyan(`orgmine submit <file> --force`)}`);
  console.error(`     Your version wins; the other person's changes will be lost`);
}

module.exports = { submit };
