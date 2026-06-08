'use strict';

const chalk = require('chalk');
const { writeOrgFile, draftFilePath } = require('../lib/orgFile');

async function newIssue(config, options) {
  const { project, title } = options;
  const markup = config.markup || 'textile';

  const meta = {
    TITLE: title || 'New Issue Title',
    REDMINE_INSTANCE: config.instanceName,
    REDMINE_PROJECT: project || '',
    REDMINE_PROJECT_ID: '',
    REDMINE_STATUS: '',
    REDMINE_STATUS_ID: '',
    REDMINE_PRIORITY: '',
    REDMINE_PRIORITY_ID: '',
    REDMINE_ASSIGNED_TO: '',
    REDMINE_ASSIGNED_TO_ID: '',
    REDMINE_VERSION: options.targetVersion || '',
    REDMINE_VERSION_ID: '',
    REDMINE_MARKUP: markup,
    REDMINE_LOCK_VERSION: '',
    REDMINE_UPDATED_ON: '',
    REDMINE_CREATED_ON: '',
  };

  const description = [
    `Write the issue description here in ${markup} format.`,
    '',
    'Before submitting, make sure to fill in:',
    '- #+TITLE: issue title',
    '- #+REDMINE_PROJECT: project name or identifier',
    '- #+REDMINE_STATUS_ID: initial status ID (optional)',
    '- #+REDMINE_PRIORITY_ID: priority ID (optional)',
  ].join('\n');

  const filePath = draftFilePath(config.localDir);
  writeOrgFile(filePath, meta, description);

  console.log(chalk.green(`✓ Draft created: ${filePath}`));
  console.log(chalk.dim('When done editing, run: orgmine submit <file>'));

  return filePath;
}

module.exports = { newIssue };
