'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { listTodo } = require('../src/commands/listTodo');

function captureStream() {
  let output = '';
  return {
    stream: {
      write(chunk) {
        output += String(chunk);
      },
    },
    text() {
      return output;
    },
  };
}

function openIssue() {
  return {
    id: 197,
    subject: 'Ship v1.9.7',
    status: { id: 1, name: 'Assigned' },
    project: { id: 3, name: 'LUI' },
  };
}

function config() {
  return {
    apiKey: 'must-not-appear',
    instanceName: 'work',
    localDir: '/tmp/issues',
    server: 'https://redmine.example.test/',
  };
}

test('JSON list resolves the version and requests all statuses', async () => {
  const calls = [];
  const client = {
    async getIssues(params) {
      calls.push(['issues', params]);
      return [openIssue()];
    },
    async getIssueStatuses() {
      calls.push(['statuses']);
      return [{ id: 1, name: 'Assigned', is_closed: false }];
    },
    async resolveVersionName(project, version) {
      calls.push(['version', project, version]);
      return { id: 97, name: version };
    },
  };
  const capture = captureStream();

  const exitCode = await listTodo(config(), {
    includeDone: true,
    project: 'lui',
    version: 'v1.9.7',
  }, {
    client,
    now: new Date('2026-07-22T00:00:00.000Z'),
    stdout: capture.stream,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    ['version', 'lui', 'v1.9.7'],
    ['issues', { project_id: 'lui', status_id: '*', fixed_version_id: 97 }],
    ['statuses'],
  ]);
  const dataset = JSON.parse(capture.text());
  assert.equal(dataset.items.length, 1);
  assert.equal(dataset.items[0].id, 'redmine:work:197');
  assert.equal(capture.text().includes('must-not-appear'), false);
});

test('JSON list emits a valid failed dataset without human output', async () => {
  const client = {
    async getIssues() {
      throw new Error('API unavailable');
    },
    async getIssueStatuses() {
      return [];
    },
  };
  const capture = captureStream();

  const exitCode = await listTodo(config(), {}, {
    client,
    now: new Date('2026-07-22T00:00:00.000Z'),
    stdout: capture.stream,
  });

  assert.equal(exitCode, 1);
  const dataset = JSON.parse(capture.text());
  assert.deepEqual(dataset.items, []);
  assert.equal(dataset.sources[0].source, 'redmine');
  assert.equal(dataset.sources[0].status, 'failed');
  assert.equal(dataset.sources[0].error, 'API unavailable');
});

test('status lookup failure keeps issues and marks the dataset incomplete', async () => {
  const client = {
    async getIssues() {
      return [openIssue()];
    },
    async getIssueStatuses() {
      throw new Error('status endpoint unavailable: must-not-appear');
    },
  };
  const capture = captureStream();

  const exitCode = await listTodo(config(), {}, {
    client,
    now: new Date('2026-07-22T00:00:00.000Z'),
    stdout: capture.stream,
  });

  assert.equal(exitCode, 0);
  const dataset = JSON.parse(capture.text());
  assert.equal(dataset.items.length, 1);
  assert.equal(dataset.items[0].status.kind, 'open');
  assert.equal(dataset.sources[0].status, 'ok');
  assert.equal(dataset.sources[0].complete, false);
  assert.match(dataset.sources[0].warnings[0], /status endpoint unavailable/);
  assert.equal(JSON.stringify(dataset).includes('must-not-appear'), false);
});
