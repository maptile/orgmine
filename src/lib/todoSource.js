'use strict';

const PROTOCOL = 'todo-source';
const SCHEMA_VERSION = 1;
const DISPLAY_NAME = 'Redmine';
const CANCELLED_STATUS_NAMES = new Set(['cancelled', 'canceled', 'rejected']);
const DONE_STATUS_NAMES = new Set(['closed', 'resolved', 'verified']);
const OPEN_STATUS_NAMES = new Set([
  'new', 'confirmed', 'assigned', 'inprogress', 'in progress', 'reopened', 'deferred',
]);

function optionalString(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function requiredString(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return text;
}

function requiredId(value, field) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new Error(`${field} must be a non-empty string or number`);
  }
  return String(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value) {
  return typeof value === 'boolean' ? value : null;
}

function canonicalInstant(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid instant`);
  }
  return parsed.toISOString();
}

function generatedAtInstant(value) {
  const parsed = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('generatedAt must be a valid instant');
  }
  return parsed.toISOString();
}

function validDateValue(value) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

function dateTemporal(value, field) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = String(value);
  if (!validDateValue(date)) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  return {
    kind: 'date',
    value: date,
    timeZone: null,
    raw: date,
  };
}

function canonicalId(instance, nativeId) {
  return `redmine:${encodeURIComponent(instance)}:${encodeURIComponent(nativeId)}`;
}

function reference(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return {
    id: value.id === null || value.id === undefined ? null : String(value.id),
    name: optionalString(value.name),
  };
}

function actor(value, role) {
  if (!value || typeof value !== 'object' || value.id === null || value.id === undefined) {
    return null;
  }
  return {
    id: requiredId(value.id, `${role}.id`),
    type: 'user',
    idType: 'redmine-user-id',
    displayName: optionalString(value.name),
    role,
  };
}

function issueUrl(server, nativeId) {
  if (typeof server !== 'string' || server.trim() === '') {
    return null;
  }
  try {
    const url = new URL(server);
    url.username = '';
    url.password = '';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/issues/${encodeURIComponent(nativeId)}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function statusDefinitionMap(statuses) {
  const definitions = new Map();
  if (!Array.isArray(statuses)) {
    return definitions;
  }
  statuses.forEach(status => {
    if (status && status.id !== null && status.id !== undefined) {
      definitions.set(String(status.id), status);
    }
  });
  return definitions;
}

function closedFlag(issue, definitions) {
  const nativeStatus = issue?.status;
  const definition = nativeStatus?.id === null || nativeStatus?.id === undefined
    ? null
    : definitions.get(String(nativeStatus.id));
  if (typeof definition?.is_closed === 'boolean') {
    return definition.is_closed;
  }
  return typeof nativeStatus?.is_closed === 'boolean' ? nativeStatus.is_closed : null;
}

function fallbackStatusKind(name) {
  if (CANCELLED_STATUS_NAMES.has(name)) {
    return 'cancelled';
  }
  if (DONE_STATUS_NAMES.has(name)) {
    return 'done';
  }
  if (OPEN_STATUS_NAMES.has(name)) {
    return 'open';
  }
  return 'unknown';
}

function statusKind(issue, definitions) {
  const name = optionalString(issue?.status?.name)?.trim().toLowerCase() || '';
  const closed = closedFlag(issue, definitions);
  if (closed === false) {
    return 'open';
  }
  if (closed === true) {
    return CANCELLED_STATUS_NAMES.has(name) ? 'cancelled' : 'done';
  }
  return fallbackStatusKind(name);
}

function todoStatus(issue, definitions) {
  const kind = statusKind(issue, definitions);
  return {
    kind,
    label: optionalString(issue?.status?.name),
    completedAt: ['done', 'cancelled'].includes(kind)
      ? canonicalInstant(issue.closed_on, 'issue.closed_on')
      : null,
  };
}

function customFields(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(field => ({
    id: field?.id === null || field?.id === undefined ? null : String(field.id),
    name: optionalString(field?.name),
    value: field?.value ?? null,
  }));
}

function relations(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(relation => ({
    id: relation?.id === null || relation?.id === undefined ? null : String(relation.id),
    issueId: relation?.issue_id === null || relation?.issue_id === undefined
      ? null
      : String(relation.issue_id),
    issueToId: relation?.issue_to_id === null || relation?.issue_to_id === undefined
      ? null
      : String(relation.issue_to_id),
    type: optionalString(relation?.relation_type),
    delay: finiteNumber(relation?.delay),
  }));
}

function statusMetadata(issue, definitions) {
  const native = reference(issue.status) || { id: null, name: null };
  return {
    ...native,
    isClosed: closedFlag(issue, definitions),
  };
}

function issueMetadata(issue, definitions) {
  return {
    redmine: {
      project: reference(issue.project),
      tracker: reference(issue.tracker),
      status: statusMetadata(issue, definitions),
      priority: reference(issue.priority),
      category: reference(issue.category),
      fixedVersion: reference(issue.fixed_version),
      parent: reference(issue.parent),
      doneRatio: finiteNumber(issue.done_ratio),
      estimatedHours: finiteNumber(issue.estimated_hours),
      totalEstimatedHours: finiteNumber(issue.total_estimated_hours),
      spentHours: finiteNumber(issue.spent_hours),
      totalSpentHours: finiteNumber(issue.total_spent_hours),
      isPrivate: booleanValue(issue.is_private),
      createdAt: canonicalInstant(issue.created_on, 'issue.created_on'),
      updatedAt: canonicalInstant(issue.updated_on, 'issue.updated_on'),
      closedAt: canonicalInstant(issue.closed_on, 'issue.closed_on'),
      customFields: customFields(issue.custom_fields),
      relations: relations(issue.relations),
    },
  };
}

function normalizeIssue(issue, order, config, definitions) {
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
    throw new Error('issue must be an object');
  }
  const instance = requiredString(config.instanceName, 'config.instanceName');
  const nativeId = requiredId(issue.id, 'issue.id');
  const title = typeof issue.subject === 'string' && issue.subject.trim() !== ''
    ? issue.subject.trim()
    : '(Untitled)';
  const start = dateTemporal(issue.start_date, 'issue.start_date');
  const parentNativeId = issue.parent?.id === null || issue.parent?.id === undefined
    ? null
    : requiredId(issue.parent.id, 'issue.parent.id');

  return {
    schemaVersion: SCHEMA_VERSION,
    id: canonicalId(instance, nativeId),
    source: {
      kind: 'redmine',
      instance,
      displayName: DISPLAY_NAME,
      nativeId,
      url: issueUrl(config.server, nativeId),
    },
    content: {
      title,
      description: optionalString(issue.description),
    },
    status: todoStatus(issue, definitions),
    schedule: {
      start,
      startOrigin: start ? 'source' : null,
      end: null,
      due: dateTemporal(issue.due_date, 'issue.due_date'),
      reminders: [],
    },
    assignees: [actor(issue.assigned_to, 'assignee')].filter(Boolean),
    creator: actor(issue.author, 'creator'),
    dependencies: [],
    hierarchy: {
      parentId: parentNativeId ? canonicalId(instance, parentNativeId) : null,
      path: [title],
      depth: parentNativeId ? null : 0,
      order,
    },
    priority: optionalString(issue.priority?.name),
    tags: [],
    metadata: issueMetadata(issue, definitions),
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function redactValue(message, value) {
  if (typeof value !== 'string' || value === '') {
    return message;
  }
  return message.split(value).join('[REDACTED]');
}

function safeErrorMessage(error, config) {
  return redactValue(errorMessage(error), config?.apiKey);
}

function sourceDiagnostic(instance, values = {}) {
  return {
    source: 'redmine',
    instance,
    displayName: DISPLAY_NAME,
    status: values.status || 'ok',
    complete: values.complete === true,
    itemCount: values.itemCount || 0,
    warnings: values.warnings || [],
    error: values.error || null,
  };
}

function createTodoDataset(issues, statuses, config, options = {}) {
  if (!Array.isArray(issues)) {
    throw new Error('Redmine issues response must be an array');
  }
  const instance = requiredString(config.instanceName, 'config.instanceName');
  const definitions = statusDefinitionMap(statuses);
  const warnings = Array.isArray(options.warnings)
    ? options.warnings.map(warning => safeErrorMessage(warning, config))
    : [];
  const includeDone = options.includeDone === true;
  const items = [];

  issues.forEach((issue, order) => {
    try {
      const item = normalizeIssue(issue, order, config, definitions);
      if (includeDone || !['done', 'cancelled'].includes(item.status.kind)) {
        items.push(item);
      }
    } catch (error) {
      warnings.push(`Skipped invalid issue ${order + 1}: ${safeErrorMessage(error, config)}`);
    }
  });

  return {
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAtInstant(options.generatedAt),
    items,
    sources: [sourceDiagnostic(instance, {
      complete: warnings.length === 0,
      itemCount: items.length,
      warnings,
    })],
  };
}

function createFailureDataset(config, error, options = {}) {
  const instance = typeof config?.instanceName === 'string' && config.instanceName.trim() !== ''
    ? config.instanceName.trim()
    : 'default';
  return {
    protocol: PROTOCOL,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAtInstant(options.generatedAt),
    items: [],
    sources: [sourceDiagnostic(instance, {
      complete: false,
      error: safeErrorMessage(error, config) || 'Redmine source failed',
      status: 'failed',
    })],
  };
}

module.exports = {
  PROTOCOL,
  SCHEMA_VERSION,
  createFailureDataset,
  createTodoDataset,
  normalizeIssue,
};
