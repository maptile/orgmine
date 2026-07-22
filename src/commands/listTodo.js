'use strict';

const { RedmineClient } = require('../lib/redmine');
const { createFailureDataset, createTodoDataset } = require('../lib/todoSource');

function runtimeDate(value) {
  const candidate = typeof value === 'function' ? value() : (value || new Date());
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    throw new Error('The current time is invalid');
  }
  return date;
}

function writeDataset(stream, dataset) {
  stream.write(`${JSON.stringify(dataset, null, 2)}\n`);
}

async function resolveIssueParams(client, options) {
  const params = {};
  if (options.project) {
    params.project_id = options.project;
  }
  if (options.includeDone) {
    params.status_id = '*';
  }
  if (!options.version) {
    return params;
  }
  if (!options.project) {
    throw new Error('--project is required when filtering by --version');
  }
  const version = await client.resolveVersionName(options.project, options.version);
  params.fixed_version_id = version.id;
  return params;
}

async function loadStatusDefinitions(client) {
  try {
    return {
      statuses: await client.getIssueStatuses(),
      warnings: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      statuses: [],
      warnings: [`Unable to load Redmine status definitions: ${message}`],
    };
  }
}

async function collectTodoDataset(config, options, runtime, generatedAt) {
  const client = runtime.client || new RedmineClient(config);
  const params = await resolveIssueParams(client, options);
  const [issues, statusResult] = await Promise.all([
    client.getIssues(params),
    loadStatusDefinitions(client),
  ]);
  return createTodoDataset(issues, statusResult.statuses, config, {
    generatedAt,
    includeDone: options.includeDone === true,
    warnings: statusResult.warnings,
  });
}

async function listTodo(config, options, runtime = {}) {
  const stdout = runtime.stdout || process.stdout;
  const generatedAt = runtimeDate(runtime.now).toISOString();
  let dataset;
  let exitCode = 0;

  try {
    dataset = await collectTodoDataset(config, options, runtime, generatedAt);
  } catch (error) {
    dataset = createFailureDataset(config, error, { generatedAt });
    exitCode = 1;
  }

  writeDataset(stdout, dataset);
  return exitCode;
}

module.exports = { collectTodoDataset, listTodo, resolveIssueParams };
