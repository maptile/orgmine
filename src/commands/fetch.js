'use strict';

const chalk = require('chalk');
const { RedmineClient, NotFoundError } = require('../lib/redmine');
const { issueToOrg, writeOrgFile, issueFilePath, findFileById } = require('../lib/orgFile');
const { reviewRemoteOverwrite } = require('../lib/localOverwrite');

async function fetch(issueId, config) {
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

  const newFilePath = issueFilePath(
    config.localDir,
    issue.project?.name || 'unknown',
    issue.id,
    issue.subject
  );
  const matches = findFileById(config.localDir, issue.id);

  if (matches.length > 1) {
    console.error(chalk.red(`Multiple local files found for issue #${issue.id}:`));
    matches.forEach(file => console.error(`  ${file}`));
    console.error(chalk.red('Fetch stopped without changing any local file.'));
    process.exit(1);
  }

  const filePath = matches[0] || newFilePath;
  if (matches.length === 1) {
    const result = await reviewRemoteOverwrite({
      filePath,
      issue,
      instanceName: config.instanceName,
      markup: config.markup,
      beforeDiff: () => {
        console.log(chalk.yellow(`Local file differs from Redmine: ${filePath}`));
        console.log(chalk.dim('Changes below are local -> remote:'));
      },
    });

    if (result === 'unchanged') {
      console.log(chalk.dim(`Already up to date: ${filePath}`));
      return filePath;
    }
    if (result === 'kept') {
      console.log(chalk.yellow(`Local file kept unchanged: ${filePath}`));
      return filePath;
    }
  } else {
    const { meta, description } = issueToOrg(issue, config.instanceName, config.markup);
    writeOrgFile(filePath, meta, description);
  }

  console.log(chalk.green(`✓ Saved to: ${filePath}`));
  console.log(`  Title:    ${issue.subject}`);
  console.log(`  Status:   ${issue.status?.name}  Priority: ${issue.priority?.name}`);
  if (issue.assigned_to) console.log(`  Assignee: ${issue.assigned_to.name}`);

  return filePath;
}

module.exports = { fetch };
