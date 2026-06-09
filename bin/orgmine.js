#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const chalk = require('chalk');
const { loadConfig } = require('../src/lib/config');
const { list } = require('../src/commands/list');
const { fetch } = require('../src/commands/fetch');
const { newIssue } = require('../src/commands/new');
const { submit } = require('../src/commands/submit');
const { fields } = require('../src/commands/fields');
const { init } = require('../src/commands/init');
const { sync } = require('../src/commands/sync');
const { refresh } = require('../src/commands/refresh');

program
  .name('orgmine')
  .description('Local-first Redmine issue manager with org-mode support')
  .version('0.1.0')
  .option('-i, --instance <name>', 'Redmine instance to use (defaults to "default" in config)')
  .option('--server <url>', 'Redmine server URL (config file not required if all three are set)')
  .option('--api-key <key>', 'Redmine API key')
  .option('--local-dir <path>', 'Local directory for org files');

// ── list ────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List issues grouped by status')
  .option('-p, --project <id_or_name>', 'Filter by project')
  .option('-v, --target-version <version>', 'Filter by version name')
  .option('--highlight-rejected', 'Highlight rejected issues in red (overrides config)')
  .option('--no-highlight-rejected', 'Do not highlight rejected issues (overrides config)')
  .option('--highlight-reopened', 'Highlight reopened issues in red (overrides config)')
  .option('--no-highlight-reopened', 'Do not highlight reopened issues (overrides config)')
  .option('--reopen-as-assigned', 'Group reopened issues under Assigned (overrides config)')
  .option('--no-reopen-as-assigned', 'Keep reopened as its own group (overrides config)')
  .action(async (options) => {
    const config = getConfig(program);
    await list(config, options);
  });

// ── fetch ────────────────────────────────────────────────────────────────────
program
  .command('fetch <id>')
  .description('Fetch an issue from Redmine and save it as a local org file')
  .action(async (id) => {
    const config = getConfig(program);
    await fetch(id, config);
  });

// ── new ──────────────────────────────────────────────────────────────────────
program
  .command('new')
  .description('Create a new issue draft locally')
  .option('-p, --project <name>', 'Project name or identifier')
  .option('-t, --title <title>', 'Issue title')
  .option('-v, --target-version <version>', 'TargetVersion value')
  .action(async (options) => {
    const config = getConfig(program);
    await newIssue(config, options);
  });

// ── submit ───────────────────────────────────────────────────────────────────
program
  .command('submit <file-or-id>')
  .description('Submit to Redmine: pass a file path (direct) or an issue ID (finds the file and asks for confirmation)')
  .option('--force', 'Force submit even on conflict (overwrites remote changes)')
  .action(async (fileOrId, options) => {
    const config = getConfig(program);
    await submit(fileOrId, config, options);
  });

// ── sync ─────────────────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Download all issues from Redmine to local org files')
  .option('-p, --project <id_or_name>', 'Filter by project')
  .option('-v, --target-version <version>', 'Filter by version name (requires --project)')
  .option('--force', 'Overwrite existing local files')
  .action(async (options) => {
    const config = getConfig(program);
    await sync(config, options);
  });

// ── refresh ───────────────────────────────────────────────────────────────────
program
  .command('refresh')
  .description('Fetch statuses and priorities from Redmine and save to local cache')
  .action(async () => {
    const config = getConfig(program);
    await refresh(config);
  });

// ── init ─────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Create the config file at ~/.config/orgmine/config.json (errors if it already exists)')
  .action(() => {
    init();
  });

// ── fields ───────────────────────────────────────────────────────────────────
program
  .command('fields <id>')
  .description('List all custom fields on an issue (useful for finding targetVersionCfId)')
  .action(async (id) => {
    const config = getConfig(program);
    await fields(id, config);
  });

// ── global error handler ─────────────────────────────────────────────────────
program.configureOutput({
  outputError: (str, write) => write(chalk.red(str)),
});

program.parseAsync(process.argv).catch((e) => {
  console.error(chalk.red(`Error: ${e.message}`));
  process.exit(1);
});

// ── helpers ───────────────────────────────────────────────────────────────────
function getConfig(prog) {
  const opts = prog.opts();
  try {
    return loadConfig(opts.instance, {
      server: opts.server,
      apiKey: opts.apiKey,
      localDir: opts.localDir,
    });
  } catch (e) {
    console.error(chalk.red(`Config error: ${e.message}`));
    process.exit(1);
  }
}
