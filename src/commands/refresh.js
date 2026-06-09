'use strict';

const chalk = require('chalk');
const { RedmineClient } = require('../lib/redmine');
const { setInstanceCache, CACHE_PATH } = require('../lib/cache');

async function refresh(config) {
  const client = new RedmineClient(config);

  // ── global data ───────────────────────────────────────────────────────────
  process.stdout.write(chalk.dim('Fetching statuses, priorities, projects…'));
  let statuses, priorities, projects;
  try {
    [statuses, priorities, projects] = await Promise.all([
      client.getIssueStatuses(),
      client.getPriorities(),
      client.getProjects(),
    ]);
  } catch (e) {
    process.stdout.write('\n');
    console.error(chalk.red(`Failed: ${e.message}`));
    process.exit(1);
  }
  process.stdout.write(` ${projects.length} project(s)\n`);

  // ── per-project: members + versions ──────────────────────────────────────
  const members = {};
  const versions = {};

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    process.stdout.write(`\r  [${i + 1}/${projects.length}] ${project.name.slice(0, 30).padEnd(30)}`);

    const [m, v] = await Promise.all([
      fetchSafe(() => client.getProjectMembers(project.id)),
      fetchSafe(() => client.getVersions(project.id)),
    ]);
    members[project.id] = m || [];
    versions[project.id] = v || [];
  }
  process.stdout.write('\r' + ' '.repeat(50) + '\r');

  // ── save ──────────────────────────────────────────────────────────────────
  setInstanceCache(config.instanceName, { statuses, priorities, projects, members, versions });

  console.log(chalk.green(`✓ Cache updated: ${config.instanceName}`));
  console.log(`  ${statuses.length} statuses, ${priorities.length} priorities, ${projects.length} projects`);
  console.log(chalk.dim(`  Saved to: ${CACHE_PATH}`));
}

async function fetchSafe(fn) {
  try {
    return await fn();
  } catch (_) {
    return null;
  }
}

module.exports = { refresh };
