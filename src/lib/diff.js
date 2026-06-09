'use strict';

const chalk = require('chalk');

const CONTEXT_LINES = 2;

/**
 * Display a before/after summary of what will change on the server.
 * serverIssue is the raw Redmine API issue object.
 */
function showIssueDiff(meta, description, serverIssue) {
  const fieldRows = buildFieldDiff(meta, serverIssue);
  const descDiff  = buildDescDiff(description, serverIssue.description || '');

  const hasFieldChanges = fieldRows.some(r => r.changed);
  const hasDescChanges  = descDiff.length > 0;

  if (!hasFieldChanges && !hasDescChanges) {
    return false;
  }

  if (hasFieldChanges) {
    console.log(chalk.bold('Fields:'));
    for (const { label, server, local, changed } of fieldRows) {
      const tag = label.padEnd(10);
      if (changed) {
        console.log(`  ${tag}  ${chalk.red(server || '(empty)')}  →  ${chalk.green(local || '(empty)')}`);
      } else {
        console.log(chalk.dim(`  ${tag}  ${local || '(empty)'}`));
      }
    }
  }

  if (hasDescChanges) {
    console.log(chalk.bold('\nDescription:'));
    for (const line of descDiff) console.log(line);
  }

  console.log('');
  return true;
}

// ── field comparison ──────────────────────────────────────────────────────────

function buildFieldDiff(meta, issue) {
  const rows = [
    { label: 'title',    local: meta.REDMINE_STATUS,      server: issue.subject },
    { label: 'status',   local: meta.REDMINE_STATUS,      server: issue.status?.name        || '' },
    { label: 'priority', local: meta.REDMINE_PRIORITY,    server: issue.priority?.name      || '' },
    { label: 'assignee', local: meta.REDMINE_ASSIGNED_TO, server: issue.assigned_to?.name   || '' },
    { label: 'version',  local: meta.REDMINE_VERSION,     server: issue.fixed_version?.name || '' },
    { label: 'category', local: meta.REDMINE_CATEGORY,    server: issue.category?.name      || '' },
  ];

  // Fix title row
  rows[0] = { label: 'title', local: meta.TITLE, server: issue.subject };

  return rows.map(r => ({ ...r, changed: (r.local || '') !== (r.server || '') }));
}

// ── description diff ──────────────────────────────────────────────────────────

function buildDescDiff(localDesc, serverDesc) {
  const localLines  = normalizeDesc(localDesc).split('\n');
  const serverLines = normalizeDesc(serverDesc).split('\n');

  if (localLines.join('\n') === serverLines.join('\n')) return [];

  const hunks = lcs(serverLines, localLines);
  return renderContextDiff(hunks);
}

function normalizeDesc(str) {
  return (str || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

// LCS-based line diff — returns [{op: '='|'-'|'+', line}]
function lcs(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ op: '=', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ op: '+', line: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ op: '-', line: oldLines[i - 1] });
      i--;
    }
  }
  return result;
}

// Render hunks with CONTEXT_LINES of context; collapse unchanged runs
function renderContextDiff(hunks) {
  const changedIdx = new Set(
    hunks.map((h, i) => (h.op !== '=' ? i : -1)).filter(i => i >= 0)
  );

  const visible = new Set();
  for (const ci of changedIdx) {
    for (let k = ci - CONTEXT_LINES; k <= ci + CONTEXT_LINES; k++) {
      if (k >= 0 && k < hunks.length) visible.add(k);
    }
  }

  const lines = [];
  let skipping = false;
  for (let i = 0; i < hunks.length; i++) {
    if (!visible.has(i)) {
      if (!skipping) { lines.push(chalk.dim('  …')); skipping = true; }
      continue;
    }
    skipping = false;
    const { op, line } = hunks[i];
    if (op === '+') lines.push(chalk.green(`+ ${line}`));
    else if (op === '-') lines.push(chalk.red(`- ${line}`));
    else lines.push(chalk.dim(`  ${line}`));
  }
  return lines;
}

module.exports = { showIssueDiff };
