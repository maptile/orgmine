'use strict';

const chalk = require('chalk');
const { RedmineClient, NotFoundError } = require('../lib/redmine');
const { issueToOrg, writeOrgFile, issueFilePath } = require('../lib/orgFile');

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

  const { meta, description } = issueToOrg(issue, config.instanceName, config.markup);
  const filePath = issueFilePath(
    config.localDir,
    issue.project?.name || 'unknown',
    issue.id,
    issue.subject
  );

  writeOrgFile(filePath, meta, description);

  console.log(chalk.green(`✓ Saved to: ${filePath}`));
  console.log(`  Title:    ${issue.subject}`);
  console.log(`  Status:   ${issue.status?.name}  Priority: ${issue.priority?.name}`);
  if (issue.assigned_to) console.log(`  Assignee: ${issue.assigned_to.name}`);

  return filePath;
}

module.exports = { fetch };
