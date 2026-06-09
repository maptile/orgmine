'use strict';

const fs = require('fs');
const chalk = require('chalk');
const { RedmineClient } = require('../lib/redmine');
const { issueToOrg, writeOrgFile, issueFilePath } = require('../lib/orgFile');

async function sync(config, options) {
  const { project, version, force } = options;

  const client = new RedmineClient(config);

  const params = { status_id: '*' };
  if (project) params.project_id = project;

  if (version) {
    if (!project) {
      console.error(chalk.red('--project is required when filtering by --version'));
      process.exit(1);
    }
    let version;
    try {
      version = await client.resolveVersionName(project, version);
    } catch (e) {
      console.error(chalk.red(`Version lookup failed: ${e.message}`));
      process.exit(1);
    }
    params.fixed_version_id = version.id;
  }

  process.stdout.write(chalk.dim('Fetching issue list…'));
  let issues;
  try {
    issues = await client.getIssues(params);
  } catch (e) {
    process.stdout.write('\n');
    console.error(chalk.red(`Failed to fetch issues: ${e.message}`));
    process.exit(1);
  }
  process.stdout.write('\n');

  if (issues.length === 0) {
    console.log(chalk.yellow('No issues found'));
    return;
  }

  console.log(`${issues.length} issue(s) found\n`);

  let saved = 0;
  let skipped = 0;

  for (const issue of issues) {
    const { meta, description } = issueToOrg(issue, config.instanceName, config.markup);
    const filePath = issueFilePath(
      config.localDir,
      issue.project?.name || 'unknown',
      issue.id,
      issue.subject
    );

    if (!force && fs.existsSync(filePath)) {
      skipped++;
    } else {
      writeOrgFile(filePath, meta, description);
      saved++;
    }

    const total = saved + skipped;
    process.stdout.write(`\r  ${total}/${issues.length}  saved: ${saved}  skipped: ${skipped}`);
  }

  process.stdout.write('\n');
  console.log(chalk.green(`\n✓ Done — saved: ${saved}, skipped: ${skipped}`));
  if (skipped > 0) {
    console.log(chalk.dim('  Use --force to overwrite existing files'));
  }
}

module.exports = { sync };
