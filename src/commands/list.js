'use strict';

const fs = require('fs');
const chalk = require('chalk');
const { RedmineClient } = require('../lib/redmine');
const { issueFilePath } = require('../lib/orgFile');
const { listTodo } = require('./listTodo');

const DEFAULT_STATUS_ORDER = [
  'new', 'confirmed', 'assigned', 'InProgress', 'resolved',
  'verified', 'deferred', 'closed', 'rejected', 'cancelled', 'reopened',
];

async function list(config, options) {
  if (options.json) {
    return listTodo(config, options);
  }

  const { version, project } = options;

  const client = new RedmineClient(config);

  const params = {};
  if (project) params.project_id = project;
  if (options.includeDone) params.status_id = '*';

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

  let issues;
  try {
    issues = await client.getIssues(params);
  } catch (e) {
    console.error(chalk.red(`Failed to fetch issues: ${e.message}`));
    process.exit(1);
  }

  if (issues.length === 0) {
    console.log(chalk.yellow('No issues found matching the given criteria'));
    return;
  }

  // Merge display options: config defaults, then CLI flags
  const displayOpts = resolveDisplayOptions(config, options);

  const groups = groupByStatus(issues, displayOpts);
  const statusOrder = config.statusOrder || DEFAULT_STATUS_ORDER;
  const sortedGroups = sortGroups(groups, statusOrder);

  const filterDesc = version ? `version = ${chalk.cyan(version)}` : 'all';
  const projectDesc = project ? `  project: ${chalk.cyan(project)}` : '';
  console.log(chalk.bold(`\nInstance: ${config.instanceName}${projectDesc}  filter: ${filterDesc}`));
  console.log(chalk.bold(`${issues.length} issue(s)\n`));

  for (const [status, group] of sortedGroups) {
    console.log(chalk.bold.blue(`── ${status} (${group.length}) ${'─'.repeat(Math.max(0, 50 - status.length))}`));

    for (const issue of group) {
      const line = formatIssueLine(config, issue, displayOpts);
      console.log(line);
    }
    console.log();
  }

  console.log(chalk.dim('★ = cached locally'));
}

// ── grouping ──────────────────────────────────────────────────────────────────

function groupByStatus(issues, displayOpts) {
  const groups = {};
  for (const issue of issues) {
    let status = issue.status?.name || 'Unknown';

    if (displayOpts.reopenedAsAssigned && isStatus(status, 'reopened')) {
      status = 'Assigned';
    }

    if (!groups[status]) groups[status] = [];
    groups[status].push(issue);
  }
  return groups;
}

function sortGroups(groups, statusOrder) {
  const order = statusOrder.map(s => s.toLowerCase());
  return Object.entries(groups).sort(([a], [b]) => {
    const ai = order.indexOf(a.toLowerCase());
    const bi = order.indexOf(b.toLowerCase());
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// ── formatting ────────────────────────────────────────────────────────────────

function formatIssueLine(config, issue, displayOpts) {
  const cached = isLocalCached(config, issue);
  const cachedMark = cached ? chalk.green(' ★') : '  ';
  const id = chalk.dim(`#${String(issue.id).padStart(5)}`);
  const title = issue.subject.slice(0, 45).padEnd(45);
  const priority = formatPriority(issue.priority?.name);
  const assignee = chalk.dim((issue.assigned_to?.name || '-').slice(0, 12).padEnd(12));

  const statusName = issue.status?.name || '';
  const shouldHighlight =
    (displayOpts.highlightRejected && isStatus(statusName, 'rejected')) ||
    (displayOpts.highlightReopened && isStatus(statusName, 'reopened'));

  const line = `  ${id}${cachedMark} ${title} ${priority} ${assignee}`;
  return shouldHighlight ? chalk.red(line) : line;
}

function isLocalCached(config, issue) {
  const filePath = issueFilePath(
    config.localDir,
    issue.project?.name || 'unknown',
    issue.id,
    issue.subject
  );
  return fs.existsSync(filePath);
}

function formatPriority(name) {
  if (!name) return '      ';
  const map = {
    Low: chalk.dim('Low   '),
    Normal: chalk.white('Normal'),
    High: chalk.yellow('High  '),
    Urgent: chalk.red('Urgent'),
    Immediate: chalk.red.bold('Immed.'),
  };
  return (map[name] || name.slice(0, 6).padEnd(6));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function isStatus(statusName, target) {
  return statusName.toLowerCase() === target.toLowerCase();
}

/**
 * Merge per-instance config defaults with CLI flag overrides.
 * CLI flags are tristate: true/false if explicitly passed, undefined if not.
 */
function resolveDisplayOptions(config, cliOptions) {
  return {
    highlightRejected: cliOptions.highlightRejected ?? config.highlightRejected ?? false,
    highlightReopened: cliOptions.highlightReopened ?? config.highlightReopened ?? false,
    reopenedAsAssigned: cliOptions.reopenedAsAssigned ?? config.reopenedAsAssigned ?? false,
  };
}

module.exports = { list };
