'use strict';

const chalk = require('chalk');
const { RedmineClient, NotFoundError } = require('../lib/redmine');

async function fields(issueId, config) {
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

  const customFields = issue.custom_fields;
  if (!customFields || customFields.length === 0) {
    console.log(chalk.yellow(`Issue #${issueId} has no custom fields`));
    return;
  }

  console.log(chalk.bold(`\nCustom fields on issue #${issueId} — ${issue.subject}\n`));
  console.log(chalk.dim(`${'ID'.padEnd(6)} ${'Name'.padEnd(30)} Value`));
  console.log(chalk.dim('─'.repeat(70)));

  for (const cf of customFields) {
    const id = String(cf.id).padEnd(6);
    const name = (cf.name || '').slice(0, 30).padEnd(30);
    const value = cf.value ?? chalk.dim('(empty)');
    console.log(`${chalk.cyan(id)} ${name} ${value}`);
  }

  console.log('');
  console.log(chalk.dim('Note: version filtering uses the built-in "fixed_version" field — no config needed'));
}

module.exports = { fields };
