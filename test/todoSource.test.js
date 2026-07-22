'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createFailureDataset,
  createTodoDataset,
} = require('../src/lib/todoSource');

function config() {
  return {
    apiKey: 'never-serialize-this-key',
    instanceName: 'company/work',
    localDir: '/tmp/redmine-issues',
    server: 'https://user:password@redmine.example.test/base/',
  };
}

function issue(values = {}) {
  return {
    id: 197,
    subject: 'Implement JSON output',
    description: 'Expose the todo-source protocol.',
    project: { id: 3, name: 'LUI' },
    tracker: { id: 2, name: 'Feature' },
    status: { id: 1, name: 'Assigned' },
    priority: { id: 4, name: 'High' },
    author: { id: 9, name: 'Roger' },
    assigned_to: { id: 11, name: 'Alice' },
    start_date: '2026-07-20',
    due_date: '2026-07-31',
    created_on: '2026-07-20T08:00:00+08:00',
    updated_on: '2026-07-22T09:30:00+08:00',
    ...values,
  };
}

function statuses() {
  return [
    { id: 1, name: 'Assigned', is_closed: false },
    { id: 5, name: 'Resolved', is_closed: true },
    { id: 6, name: 'Rejected', is_closed: true },
  ];
}

test('maps a Redmine issue to the complete todo-source schema', () => {
  const dataset = createTodoDataset([issue()], statuses(), config(), {
    generatedAt: '2026-07-22T00:00:00Z',
  });

  assert.deepEqual(Object.keys(dataset), [
    'protocol', 'schemaVersion', 'generatedAt', 'items', 'sources',
  ]);
  assert.equal(dataset.protocol, 'todo-source');
  assert.equal(dataset.generatedAt, '2026-07-22T00:00:00.000Z');
  assert.deepEqual(dataset.sources[0], {
    source: 'redmine',
    instance: 'company/work',
    displayName: 'Redmine',
    status: 'ok',
    complete: true,
    itemCount: 1,
    warnings: [],
    error: null,
  });

  const item = dataset.items[0];
  assert.equal(item.id, 'redmine:company%2Fwork:197');
  assert.deepEqual(Object.keys(item), [
    'schemaVersion', 'id', 'source', 'content', 'status', 'schedule', 'assignees',
    'creator', 'dependencies', 'hierarchy', 'priority', 'tags', 'metadata',
  ]);
  assert.deepEqual(item.source, {
    kind: 'redmine',
    instance: 'company/work',
    displayName: 'Redmine',
    nativeId: '197',
    url: 'https://redmine.example.test/base/issues/197',
  });
  assert.deepEqual(item.status, {
    kind: 'open',
    label: 'Assigned',
    completedAt: null,
  });
  assert.deepEqual(item.schedule, {
    start: {
      kind: 'date', value: '2026-07-20', timeZone: null, raw: '2026-07-20',
    },
    startOrigin: 'source',
    end: null,
    due: {
      kind: 'date', value: '2026-07-31', timeZone: null, raw: '2026-07-31',
    },
    reminders: [],
  });
  assert.deepEqual(item.assignees[0], {
    id: '11', type: 'user', idType: 'redmine-user-id', displayName: 'Alice', role: 'assignee',
  });
  assert.deepEqual(item.creator, {
    id: '9', type: 'user', idType: 'redmine-user-id', displayName: 'Roger', role: 'creator',
  });
  assert.deepEqual(item.hierarchy, {
    parentId: null, path: ['Implement JSON output'], depth: 0, order: 0,
  });
  assert.equal(typeof item.metadata.redmine, 'object');
  assert.equal(Array.isArray(item.metadata.redmine), false);
  assert.equal(JSON.stringify(dataset).includes('never-serialize-this-key'), false);
  assert.equal(JSON.stringify(dataset).includes('password'), false);
});

test('uses status is_closed and honors includeDone', () => {
  const completed = issue({
    id: 198,
    status: { id: 5, name: 'Resolved' },
    closed_on: '2026-07-22T12:30:45+08:00',
  });
  const rejected = issue({
    id: 199,
    status: { id: 6, name: 'Rejected' },
    closed_on: '2026-07-22T13:30:45+08:00',
  });

  const hidden = createTodoDataset([completed, rejected], statuses(), config(), {
    generatedAt: '2026-07-22T00:00:00Z',
  });
  assert.deepEqual(hidden.items, []);
  assert.equal(hidden.sources[0].itemCount, 0);

  const shown = createTodoDataset([completed, rejected], statuses(), config(), {
    generatedAt: '2026-07-22T00:00:00Z',
    includeDone: true,
  });
  assert.deepEqual(shown.items.map(item => item.status.kind), ['done', 'cancelled']);
  assert.equal(shown.items[0].status.completedAt, '2026-07-22T04:30:45.000Z');
  assert.equal(shown.items[1].status.completedAt, '2026-07-22T05:30:45.000Z');
});

test('status definitions override an issue-local closed flag', () => {
  const dataset = createTodoDataset([issue({
    status: { id: 1, name: 'Assigned', is_closed: true },
  })], statuses(), config(), {
    generatedAt: '2026-07-22T00:00:00Z',
  });

  assert.equal(dataset.items[0].status.kind, 'open');
  assert.equal(dataset.items[0].metadata.redmine.status.isClosed, false);
});

test('keeps valid issues and marks a partial dataset incomplete', () => {
  const dataset = createTodoDataset([
    issue(),
    { subject: 'Missing ID' },
    issue({ id: 200, closed_on: 'not-an-instant' }),
  ], statuses(), config(), {
    generatedAt: '2026-07-22T00:00:00Z',
  });

  assert.equal(dataset.items.length, 1);
  assert.equal(dataset.sources[0].complete, false);
  assert.equal(dataset.sources[0].itemCount, 1);
  assert.match(dataset.sources[0].warnings[0], /Skipped invalid issue 2/);
  assert.match(dataset.sources[0].warnings[1], /issue\.closed_on must be a valid instant/);
});

test('creates an exact failed diagnostic dataset and redacts the API key', () => {
  const dataset = createFailureDataset(
    config(),
    new Error('API unavailable: never-serialize-this-key'),
    {
    generatedAt: '2026-07-22T00:00:00Z',
    },
  );

  assert.deepEqual(dataset.items, []);
  assert.deepEqual(dataset.sources[0], {
    source: 'redmine',
    instance: 'company/work',
    displayName: 'Redmine',
    status: 'failed',
    complete: false,
    itemCount: 0,
    warnings: [],
    error: 'API unavailable: [REDACTED]',
  });
  assert.equal(JSON.stringify(dataset).includes('never-serialize-this-key'), false);
});
