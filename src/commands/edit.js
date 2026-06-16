'use strict';

const chalk = require('chalk');
const { RedmineClient, NotFoundError } = require('../lib/redmine');
const {
  issueToOrg, writeOrgFile, readOrgFile, issueFilePath, findFileById,
} = require('../lib/orgFile');
const { buildIssueDiff, showIssueDiff } = require('../lib/diff');
const { openInEditor } = require('../lib/editor');

/**
 * Fetch an issue, then open its local org file in the editor.
 * The editor only opens when the fetch succeeds and the local file is in sync
 * with Redmine: a fresh local file is written if none exists, an unchanged file
 * is opened as-is, and a conflicting file (local differs from remote) aborts
 * with guidance instead of opening.
 */
async function edit(issueId, config) {
  const client = new RedmineClient(config);

  let issue;
  try {
    issue = await client.getIssue(issueId);
  } catch (e) {
    if (e instanceof NotFoundError) {
      console.error(chalk.red(`Issue #${issueId} not found`));
    } else {
      console.error(chalk.red(`Fetch failed: ${e.message}`));
    }
    process.exit(1);
  }

  const matches = findFileById(config.localDir, issue.id);
  if (matches.length > 1) {
    console.error(chalk.red(`Multiple local files found for issue #${issue.id}:`));
    matches.forEach(file => console.error(`  ${file}`));
    console.error(chalk.red('Edit stopped without changing any local file.'));
    process.exit(1);
  }

  let filePath;
  if (matches.length === 1) {
    filePath = matches[0];
    const local = readOrgFile(filePath);
    const diff = buildIssueDiff(local.meta, local.description, issue, { target: 'local' });

    if (diff.hasFieldChanges || diff.hasDescChanges) {
      console.error(chalk.yellow(`Local file differs from Redmine: ${filePath}`));
      console.log(chalk.dim('Changes below are local -> remote:'));
      showIssueDiff(local.meta, local.description, issue, { target: 'local' });
      console.error(chalk.red('\nConflict: the local file is out of sync, so it was not opened.'));
      console.error(chalk.dim(`Resolve it first: 'orgmine fetch ${issue.id}' to take remote, or 'orgmine submit ${issue.id}' to push local.`));
      process.exit(1);
    }
    console.log(chalk.dim(`Already up to date: ${filePath}`));
  } else {
    filePath = issueFilePath(
      config.localDir,
      issue.project?.name || 'unknown',
      issue.id,
      issue.subject
    );
    const { meta, description } = issueToOrg(issue, config.instanceName, config.markup);
    writeOrgFile(filePath, meta, description);
    console.log(chalk.green(`✓ Saved to: ${filePath}`));
  }

  openInEditor(filePath, config);
  console.log(chalk.green(`✓ Opened in editor: ${filePath}`));
  return filePath;
}

module.exports = { edit };
