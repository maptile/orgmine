'use strict';

const chalk = require('chalk');
const { RedmineClient } = require('../lib/redmine');
const { issueToOrg, writeOrgFile, issueFilePath, findFileById } = require('../lib/orgFile');
const { reviewRemoteOverwrite } = require('../lib/localOverwrite');

async function fetchAll(config, options) {
  const { project, version, force } = options;

  const client = new RedmineClient(config);

  const params = { status_id: '*' };
  if (project) params.project_id = project;

  if (version) {
    if (!project) {
      console.error(chalk.red('--project is required when filtering by --version'));
      process.exit(1);
    }
    let versionObj;
    try {
      versionObj = await client.resolveVersionName(project, version);
    } catch (e) {
      console.error(chalk.red(`Version lookup failed: ${e.message}`));
      process.exit(1);
    }
    params.fixed_version_id = versionObj.id;
  }

  process.stdout.write(chalk.cyan('Fetching issue list…'));
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
  let unchanged = 0;
  let kept = 0;
  let failed = 0;

  for (let index = 0; index < issues.length; index++) {
    const listIssue = issues[index];
    const progress = formatProgress(index + 1, issues.length, listIssue);
    console.log(chalk.cyan(`${progress} Checking local file`));

    const newFilePath = issueFilePath(
      config.localDir,
      listIssue.project?.name || 'unknown',
      listIssue.id,
      listIssue.subject
    );
    const matches = findFileById(config.localDir, listIssue.id);

    if (matches.length > 1) {
      console.error(chalk.red(`Multiple local files found for issue #${listIssue.id}:`));
      matches.forEach(file => console.error(`  ${file}`));
      console.error(chalk.red('  Skipped without changing any of them.'));
      failed++;
      continue;
    }

    const existingPath = matches[0] || null;
    if (!existingPath) {
      console.log(chalk.cyan(`${progress} Saving new local file`));
      const { meta, description } = issueToOrg(listIssue, config.instanceName, config.markup);
      writeOrgFile(newFilePath, meta, description);
      saved++;
      continue;
    }

    let issue;
    try {
      console.log(chalk.cyan(`${progress} Fetching complete remote issue`));
      issue = await client.getIssue(listIssue.id);
    } catch (e) {
      console.error(chalk.red(`Could not fetch complete issue #${listIssue.id}: ${e.message}`));
      console.error(chalk.red(`  Local file kept unchanged: ${existingPath}`));
      failed++;
      continue;
    }

    console.log(chalk.cyan(`${progress} Comparing local and remote content`));
    const result = await reviewRemoteOverwrite({
      filePath: existingPath,
      issue,
      instanceName: config.instanceName,
      markup: config.markup,
      force,
      beforeDiff: () => {
        console.log(chalk.yellow(`${progress} Review required: local file differs`));
        console.log(`  ${existingPath}`);
        console.log(chalk.dim('Changes below are local -> remote:'));
      },
    });

    if (result === 'updated') saved++;
    else if (result === 'unchanged') unchanged++;
    else kept++;
  }

  console.log(chalk.green(
    `\n✓ Done — saved: ${saved}, unchanged: ${unchanged}, kept: ${kept}, failed: ${failed}`
  ));
}

function formatProgress(current, total, issue) {
  const percent = Math.floor((current / total) * 100);
  const subject = shorten(issue.subject || '', 50);
  return `[${current}/${total} ${String(percent).padStart(3)}%] #${issue.id} ${subject}`;
}

function shorten(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

module.exports = { fetchAll };
