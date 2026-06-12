'use strict';

const { readOrgFile, writeOrgFile, issueToOrg } = require('./orgFile');
const { buildIssueDiff, showIssueDiff } = require('./diff');
const { ask } = require('./prompt');

async function reviewRemoteOverwrite({
  filePath,
  issue,
  instanceName,
  markup,
  force = false,
  askFn = ask,
  beforeDiff,
}) {
  const local = readOrgFile(filePath);
  const diff = buildIssueDiff(local.meta, local.description, issue, { target: 'local' });

  if (!diff.hasFieldChanges && !diff.hasDescChanges) {
    return 'unchanged';
  }

  beforeDiff?.();
  showIssueDiff(local.meta, local.description, issue, { target: 'local' });

  if (!force) {
    const answer = await askFn(`Overwrite local file for issue #${issue.id}? [y/N] `);
    if (answer.toLowerCase() !== 'y') return 'kept';
  }

  const remote = issueToOrg(issue, instanceName, local.meta.REDMINE_MARKUP || markup);
  writeOrgFile(filePath, remote.meta, remote.description);
  return 'updated';
}

module.exports = { reviewRemoteOverwrite };
