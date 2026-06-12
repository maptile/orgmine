'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeOrgFile, readOrgFile } = require('../src/lib/orgFile');
const { buildIssueDiff } = require('../src/lib/diff');
const { reviewRemoteOverwrite } = require('../src/lib/localOverwrite');

function remoteIssue(overrides = {}) {
  return {
    id: 42,
    subject: 'Remote title',
    description: 'Remote description',
    project: { name: 'Project' },
    status: { name: 'Assigned' },
    priority: { name: 'Normal' },
    tracker: { name: 'Feature' },
    ...overrides,
  };
}

function createLocalFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orgmine-test-'));
  const filePath = path.join(dir, '42-local.org');
  writeOrgFile(filePath, {
    TITLE: 'Local title',
    REDMINE_INSTANCE: 'work',
    REDMINE_ID: '42',
    REDMINE_PROJECT: 'Project',
    REDMINE_STATUS: 'New',
    REDMINE_PRIORITY: 'Normal',
    REDMINE_MARKUP: 'textile',
  }, 'Local description');
  return { dir, filePath };
}

test('remote-to-local diff displays local values before remote values', () => {
  const diff = buildIssueDiff({
    TITLE: 'Local title',
    REDMINE_STATUS: 'New',
  }, 'Local description', remoteIssue(), { target: 'local' });
  const title = diff.fieldRows.find(row => row.label === 'title');

  assert.equal(title.before, 'Local title');
  assert.equal(title.after, 'Remote title');
  assert.equal(diff.hasDescChanges, true);
});

test('submit diff keeps remote values before local values by default', () => {
  const diff = buildIssueDiff({
    TITLE: 'Local title',
    REDMINE_PROJECT: 'Project',
    REDMINE_STATUS: 'New',
  }, 'Local description', remoteIssue());
  const title = diff.fieldRows.find(row => row.label === 'title');

  assert.equal(title.before, 'Remote title');
  assert.equal(title.after, 'Local title');
});

test('declining an overwrite leaves the local file unchanged', async t => {
  const { dir, filePath } = createLocalFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = fs.readFileSync(filePath, 'utf-8');

  const result = await reviewRemoteOverwrite({
    filePath,
    issue: remoteIssue(),
    instanceName: 'work',
    markup: 'textile',
    askFn: async () => 'n',
  });

  assert.equal(result, 'kept');
  assert.equal(fs.readFileSync(filePath, 'utf-8'), before);
});

test('confirming an overwrite replaces the local editable content', async t => {
  const { dir, filePath } = createLocalFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = await reviewRemoteOverwrite({
    filePath,
    issue: remoteIssue(),
    instanceName: 'work',
    markup: 'textile',
    askFn: async () => 'y',
  });
  const saved = readOrgFile(filePath);

  assert.equal(result, 'updated');
  assert.equal(saved.meta.TITLE, 'Remote title');
  assert.equal(saved.meta.REDMINE_STATUS, 'Assigned');
  assert.equal(saved.description, 'Remote description');
});

test('identical content is not rewritten or prompted', async t => {
  const { dir, filePath } = createLocalFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const issue = remoteIssue({
    subject: 'Local title',
    description: 'Local description',
    status: { name: 'New' },
  });
  const before = fs.readFileSync(filePath, 'utf-8');
  let prompted = false;

  const result = await reviewRemoteOverwrite({
    filePath,
    issue,
    instanceName: 'work',
    markup: 'textile',
    askFn: async () => {
      prompted = true;
      return 'y';
    },
  });

  assert.equal(result, 'unchanged');
  assert.equal(prompted, false);
  assert.equal(fs.readFileSync(filePath, 'utf-8'), before);
});

test('force overwrites changed content without prompting', async t => {
  const { dir, filePath } = createLocalFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let prompted = false;

  const result = await reviewRemoteOverwrite({
    filePath,
    issue: remoteIssue(),
    instanceName: 'work',
    markup: 'textile',
    force: true,
    askFn: async () => {
      prompted = true;
      return 'n';
    },
  });

  assert.equal(result, 'updated');
  assert.equal(prompted, false);
  assert.equal(readOrgFile(filePath).meta.TITLE, 'Remote title');
});
