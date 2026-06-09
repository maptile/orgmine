'use strict';

const fs = require('fs');
const chalk = require('chalk');
const { readOrgFile, writeOrgFile, draftFilePath } = require('../lib/orgFile');
const { expandHome } = require('../lib/config');
const { ask, askChoice } = require('../lib/prompt');
const { RedmineClient } = require('../lib/redmine');
const { promptMissingFields } = require('../lib/fieldSelector');

const ISSUE_TYPES = ['defect', 'feature'];

async function newIssue(config, options) {
  const project = options.project || await ask('Project (name or identifier): ');
  if (!project) {
    console.error(chalk.red('Project is required'));
    process.exit(1);
  }

  const type = await askChoice('Issue type:', ISSUE_TYPES);
  const markup = config.markup || 'textile';

  const template = loadTemplate(config, type);

  const meta = {
    ...(template ? template.meta : {}),
    // always override fields that must be fresh for a new draft
    TITLE: options.title || template?.meta.TITLE || 'New Issue Title',
    REDMINE_INSTANCE: config.instanceName,
    REDMINE_PROJECT: project,
    REDMINE_PROJECT_ID: '',
    REDMINE_ID: '',
    REDMINE_LOCK_VERSION: '',
    REDMINE_UPDATED_ON: '',
    REDMINE_CREATED_ON: '',
    REDMINE_MARKUP: markup,
  };

  // CLI --target-version overrides the template value
  if (options.targetVersion) {
    meta.REDMINE_VERSION = options.targetVersion;
    meta.REDMINE_VERSION_ID = '';
  }

  const client = new RedmineClient(config);
  const fieldUpdates = await promptMissingFields(client, project, meta, config);
  Object.assign(meta, fieldUpdates);

  const description = template ? template.description : defaultDescription(markup);
  const filePath = draftFilePath(config.localDir);
  writeOrgFile(filePath, meta, description);

  console.log(chalk.green(`✓ Draft created: ${filePath}`));
  console.log(chalk.dim(`  type: ${type}  project: ${project}`));
  console.log(chalk.dim('When done editing, run: orgmine submit <file>'));

  return filePath;
}

function loadTemplate(config, type) {
  const templatePath = config.templates?.[type];
  if (!templatePath) return null;

  const expanded = expandHome(templatePath);
  if (!fs.existsSync(expanded)) {
    console.warn(chalk.yellow(`Warning: template file not found: ${expanded}`));
    return null;
  }

  return readOrgFile(expanded);
}

function defaultDescription(markup) {
  return [
    `Write the issue description here in ${markup} format.`,
    '',
    'Before submitting, make sure to fill in:',
    '- #+TITLE: issue title',
    '- #+REDMINE_STATUS_ID: initial status ID (optional)',
    '- #+REDMINE_PRIORITY_ID: priority ID (optional)',
  ].join('\n');
}

module.exports = { newIssue };
