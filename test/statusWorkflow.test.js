'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findShortestPath,
  getTrackerWorkflow,
  planStatusChange,
  updateWithStatusWorkflow,
} = require('../src/lib/statusWorkflow');

const transitions = {
  Feature: {
    New: ['Confirmed'],
    Confirmed: ['Assigned'],
    Assigned: ['InProgress'],
    InProgress: ['Resolved'],
  },
  Defect: {
    New: ['Assigned'],
    Assigned: ['InProgress'],
    InProgress: ['Resolved'],
  },
};

const statuses = [
  { id: 1, name: 'New' },
  { id: 2, name: 'Confirmed' },
  { id: 3, name: 'Assigned' },
  { id: 4, name: 'InProgress' },
  { id: 5, name: 'Resolved' },
];

test('finds the shortest configured path case-insensitively', () => {
  const workflow = getTrackerWorkflow(transitions, 'feature');

  assert.deepEqual(
    findShortestPath(workflow, 'new', 'resolved'),
    ['new', 'Confirmed', 'Assigned', 'InProgress', 'resolved']
  );
});

test('matches singular config keys to plural Redmine tracker names', () => {
  assert.equal(
    getTrackerWorkflow(transitions, 'Features'),
    transitions.Feature
  );
  assert.equal(
    getTrackerWorkflow(transitions, 'Defects'),
    transitions.Defect
  );
});

test('returns null when the target is unreachable', () => {
  const workflow = getTrackerWorkflow(transitions, 'Defect');

  assert.equal(findShortestPath(workflow, 'Resolved', 'New'), null);
});

test('plans the complete configured path for display before submit', () => {
  const plan = planStatusChange({
    serverIssue: {
      status: { id: 1, name: 'New' },
      tracker: { id: 2, name: 'Features' },
    },
    targetStatusName: 'Assigned',
    statuses,
    statusTransitions: transitions,
  });

  assert.deepEqual(plan, {
    path: ['New', 'Confirmed', 'Assigned'],
    configured: true,
  });
});

test('plans a direct displayed path for an unconfigured tracker', () => {
  const plan = planStatusChange({
    serverIssue: {
      status: { id: 1, name: 'New' },
      tracker: { id: 9, name: 'Support' },
    },
    targetStatusName: 'Assigned',
    statuses,
    statusTransitions: transitions,
  });

  assert.deepEqual(plan, {
    path: ['New', 'Assigned'],
    configured: false,
  });
});

test('does not submit when a configured tracker has no path to the target', async () => {
  let updateCount = 0;
  const client = {
    async updateIssue() {
      updateCount++;
    },
  };

  await assert.rejects(
    updateWithStatusWorkflow({
      client,
      issueId: 42,
      payload: { status_id: 1 },
      serverIssue: {
        status: { id: 5, name: 'Resolved' },
        tracker: { id: 1, name: 'Defect' },
      },
      statuses,
      statusTransitions: transitions,
    }),
    /No configured status path/
  );
  assert.equal(updateCount, 0);
});

test('validates every configured status before the first update', async () => {
  let updateCount = 0;
  const client = {
    async updateIssue() {
      updateCount++;
    },
  };

  await assert.rejects(
    updateWithStatusWorkflow({
      client,
      issueId: 42,
      payload: { status_id: 5 },
      serverIssue: {
        status: { id: 1, name: 'New' },
        tracker: { id: 2, name: 'Feature' },
      },
      statuses: statuses.filter(status => status.name !== 'InProgress'),
      statusTransitions: transitions,
    }),
    /Status "InProgress".*not found/
  );
  assert.equal(updateCount, 0);
});

test('submits intermediate statuses before the complete final payload', async () => {
  const updates = [];
  let lockVersion = 7;
  const client = {
    async updateIssue(id, payload) {
      updates.push({ id, payload });
      lockVersion++;
    },
    async getIssue() {
      return { lock_version: lockVersion };
    },
  };

  await updateWithStatusWorkflow({
    client,
    issueId: 42,
    payload: {
      subject: 'Updated title',
      description: 'Updated description',
      status_id: 5,
      lock_version: 7,
    },
    serverIssue: {
      status: { id: 1, name: 'New' },
      tracker: { id: 2, name: 'Features' },
    },
    statuses,
    statusTransitions: transitions,
  });

  assert.deepEqual(updates, [
    { id: 42, payload: { status_id: 2, lock_version: 7 } },
    { id: 42, payload: { status_id: 3, lock_version: 8 } },
    { id: 42, payload: { status_id: 4, lock_version: 9 } },
    {
      id: 42,
      payload: {
        subject: 'Updated title',
        description: 'Updated description',
        status_id: 5,
        lock_version: 10,
      },
    },
  ]);
});

test('keeps the original single update when tracker workflow is not configured', async () => {
  const updates = [];
  const client = {
    async updateIssue(id, payload) {
      updates.push({ id, payload });
    },
  };

  await updateWithStatusWorkflow({
    client,
    issueId: 42,
    payload: { status_id: 5, lock_version: 7 },
    serverIssue: {
      status: { id: 1, name: 'New' },
      tracker: { id: 9, name: 'Support' },
    },
    statuses,
    statusTransitions: transitions,
  });

  assert.deepEqual(updates, [
    { id: 42, payload: { status_id: 5, lock_version: 7 } },
  ]);
});

test('drops a stale lock version when an old server does not return a new one', async () => {
  const updates = [];
  const client = {
    async updateIssue(id, payload) {
      updates.push({ id, payload });
    },
    async getIssue() {
      return {};
    },
  };

  await updateWithStatusWorkflow({
    client,
    issueId: 42,
    payload: { status_id: 3, lock_version: 7 },
    serverIssue: {
      status: { id: 1, name: 'New' },
      tracker: { id: 2, name: 'Feature' },
    },
    statuses,
    statusTransitions: transitions,
  });

  assert.deepEqual(updates, [
    { id: 42, payload: { status_id: 2, lock_version: 7 } },
    { id: 42, payload: { status_id: 3 } },
  ]);
});
