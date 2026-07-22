#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const chalk = require('chalk');
const { loadConfig } = require('../src/lib/config');
const { list } = require('../src/commands/list');
const { fetch } = require('../src/commands/fetch');
const { edit } = require('../src/commands/edit');
const { newIssue } = require('../src/commands/new');
const { submit } = require('../src/commands/submit');
const { fields } = require('../src/commands/fields');
const { init } = require('../src/commands/init');
const { fetchAll } = require('../src/commands/fetchAll');
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
  .option('-v, --version <name>', 'Filter by version name')
  .option('--json', 'Output the todo-source JSON protocol')
  .option('--include-done', 'Include completed and cancelled issues')
  .option('--highlight-rejected', 'Highlight rejected issues in red (overrides config)')
  .option('--no-highlight-rejected', 'Do not highlight rejected issues (overrides config)')
  .option('--highlight-reopened', 'Highlight reopened issues in red (overrides config)')
  .option('--no-highlight-reopened', 'Do not highlight reopened issues (overrides config)')
  .option('--reopen-as-assigned', 'Group reopened issues under Assigned (overrides config)')
  .option('--no-reopen-as-assigned', 'Keep reopened as its own group (overrides config)')
  .action(async (options) => {
    const config = getConfig(program);
    const exitCode = await list(config, options);
    if (Number.isInteger(exitCode) && exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });

// ── fetch ────────────────────────────────────────────────────────────────────
program
  .command('fetch <id>')
  .description('Fetch an issue from Redmine and save it as a local org file')
  .action(async (id) => {
    const config = getConfig(program);
    await fetch(id, config);
  });

// ── edit ─────────────────────────────────────────────────────────────────────
program
  .command('edit <id>')
  .description('Fetch an issue, then open its local org file in your editor (no-conflict only)')
  .action(async (id) => {
    const config = getConfig(program);
    await edit(id, config);
  });

// ── new ──────────────────────────────────────────────────────────────────────
program
  .command('new')
  .description('Create a new issue draft locally')
  .option('-p, --project <name>', 'Project name or identifier')
  .option('-t, --title <title>', 'Issue title')
  .option('-v, --version <name>', 'Version name')
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

// ── fetch-all ────────────────────────────────────────────────────────────────
program
  .command('fetch-all')
  .description('Download all issues from Redmine to local org files')
  .option('-p, --project <id_or_name>', 'Filter by project')
  .option('-v, --version <name>', 'Filter by version name (requires --project)')
  .option('--force', 'Show differences and accept all remote overwrites without prompting')
  .action(async (options) => {
    const config = getConfig(program);
    await fetchAll(config, options);
  });

// ── refresh ───────────────────────────────────────────────────────────────────
program
  .command('refresh')
  .description('Fetch statuses, priorities, projects, members and versions from Redmine and save to local cache')
  .action(async () => {
    const config = getConfig(program);
    await refresh(config);
  });

// ── init ─────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Create the config file (uses ORGMINE_CONFIG_DIR when set)')
  .action(() => {
    init();
  });

// ── fields ───────────────────────────────────────────────────────────────────
program
  .command('fields <id>')
  .description('List all custom fields on an issue')
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
