'use strict';

function getTrackerWorkflow(statusTransitions, trackerName) {
  if (!statusTransitions || !trackerName) return null;

  const trackerKey = Object.keys(statusTransitions).find(
    key => normalizeTrackerName(key) === normalizeTrackerName(trackerName)
  );
  return trackerKey ? statusTransitions[trackerKey] : null;
}

function findShortestPath(workflow, fromStatus, toStatus) {
  if (!workflow || !fromStatus || !toStatus) return null;
  if (sameName(fromStatus, toStatus)) return [fromStatus];

  const queue = [[fromStatus]];
  const visited = new Set([normalize(fromStatus)]);

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const currentKey = findKey(workflow, current);
    const nextStatuses = currentKey ? workflow[currentKey] : [];

    if (!Array.isArray(nextStatuses)) continue;

    for (const next of nextStatuses) {
      if (typeof next !== 'string' || !next.trim()) continue;

      const nextPath = [...path, next];
      if (sameName(next, toStatus)) {
        nextPath[nextPath.length - 1] = toStatus;
        return nextPath;
      }

      const normalized = normalize(next);
      if (!visited.has(normalized)) {
        visited.add(normalized);
        queue.push(nextPath);
      }
    }
  }

  return null;
}

function planStatusChange({
  serverIssue,
  targetStatusName,
  statuses,
  statusTransitions,
}) {
  const currentStatus = serverIssue?.status;
  if (
    !currentStatus?.name ||
    !targetStatusName ||
    sameName(currentStatus.name, targetStatusName)
  ) {
    return null;
  }

  const trackerName = serverIssue?.tracker?.name;
  const workflow = getTrackerWorkflow(statusTransitions, trackerName);
  const path = workflow
    ? findShortestPath(workflow, currentStatus.name, targetStatusName)
    : [currentStatus.name, targetStatusName];

  if (!path) {
    throw new Error(
      `No configured status path for tracker "${trackerName}": ` +
      `${currentStatus.name} -> ${targetStatusName}`
    );
  }

  if (workflow) {
    validatePathStatuses(path, statuses);
  }

  return { path, configured: Boolean(workflow) };
}

async function updateWithStatusWorkflow({
  client,
  issueId,
  payload,
  serverIssue,
  statuses,
  statusTransitions,
  statusPlan,
  force = false,
  onTransition,
}) {
  const targetStatusId = payload.status_id;
  const currentStatus = serverIssue?.status;
  const targetStatus = findStatusById(statuses, targetStatusId);
  const workflow = getTrackerWorkflow(statusTransitions, serverIssue?.tracker?.name);

  if (
    targetStatusId == null ||
    !currentStatus ||
    Number(currentStatus.id) === Number(targetStatusId) ||
    !targetStatus ||
    !workflow
  ) {
    await client.updateIssue(issueId, preparePayload(payload, payload.lock_version, force));
    return;
  }

  const plan = statusPlan || planStatusChange({
    serverIssue,
    targetStatusName: targetStatus.name,
    statuses,
    statusTransitions,
  });
  if (!plan) {
    await client.updateIssue(issueId, preparePayload(payload, payload.lock_version, force));
    return;
  }
  const path = plan.path;

  let lockVersion = payload.lock_version;
  const transitions = path.slice(1).map(statusName => {
    const status = findStatusByName(statuses, statusName);
    if (!status) {
      throw new Error(
        `Status "${statusName}" from statusTransitions was not found in the lookup cache. ` +
        'Run: orgmine refresh'
      );
    }
    return { name: statusName, status };
  });

  for (let index = 0; index < transitions.length; index++) {
    const { name: statusName, status } = transitions[index];
    const isFinal = index === transitions.length - 1;
    const stepPayload = isFinal
      ? { ...payload, status_id: status.id }
      : { status_id: status.id };

    await client.updateIssue(
      issueId,
      preparePayload(stepPayload, lockVersion, force)
    );
    onTransition?.({
      from: path[index],
      to: statusName,
      step: index + 1,
      total: transitions.length,
    });

    if (!isFinal) {
      const latest = await client.getIssue(issueId);
      lockVersion = latest.lock_version ?? null;
    }
  }
}

function validatePathStatuses(path, statuses) {
  for (const statusName of path.slice(1)) {
    if (!findStatusByName(statuses, statusName)) {
      throw new Error(
        `Status "${statusName}" from statusTransitions was not found in the lookup cache. ` +
        'Run: orgmine refresh'
      );
    }
  }
}

function preparePayload(payload, lockVersion, force) {
  const prepared = { ...payload };

  if (force) {
    delete prepared.lock_version;
  } else if (lockVersion === null) {
    delete prepared.lock_version;
  } else if (lockVersion !== undefined) {
    prepared.lock_version = lockVersion;
  }

  return prepared;
}

function findStatusById(statuses, id) {
  if (id == null || !Array.isArray(statuses)) return null;
  return statuses.find(status => Number(status.id) === Number(id)) || null;
}

function findStatusByName(statuses, name) {
  if (!Array.isArray(statuses)) return null;
  return statuses.find(status => sameName(status.name, name)) || null;
}

function findKey(object, name) {
  return Object.keys(object).find(key => sameName(key, name));
}

function sameName(left, right) {
  return normalize(left) === normalize(right);
}

function normalize(value) {
  return String(value).trim().toLowerCase();
}

function normalizeTrackerName(value) {
  const normalized = normalize(value);
  if (normalized.endsWith('ies')) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('s') && !normalized.endsWith('ss')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

module.exports = {
  findShortestPath,
  getTrackerWorkflow,
  planStatusChange,
  updateWithStatusWorkflow,
};
