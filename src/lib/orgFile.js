'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Ordered list of #+KEYWORD metadata keys written to org files
const META_KEYS = [
  'TITLE',
  'REDMINE_INSTANCE',
  'REDMINE_ID',
  'REDMINE_PROJECT',
  'REDMINE_PROJECT_ID',
  'REDMINE_STATUS',
  'REDMINE_STATUS_ID',
  'REDMINE_PRIORITY',
  'REDMINE_PRIORITY_ID',
  'REDMINE_ASSIGNED_TO',
  'REDMINE_ASSIGNED_TO_ID',
  'REDMINE_VERSION',
  'REDMINE_VERSION_ID',
  'REDMINE_MARKUP',
  'REDMINE_LOCK_VERSION',
  'REDMINE_UPDATED_ON',
  'REDMINE_CREATED_ON',
];

const META_RE = /^#\+([A-Z_]+):\s*(.*)$/;
const SRC_BEGIN_RE = /^#\+BEGIN_SRC\s+(\S+)/i;
const SRC_END_RE = /^#\+END_SRC\s*$/i;

/**
 * Read an org file and return { meta, description }.
 * description is the raw markup content extracted from inside the #+BEGIN_SRC block.
 */
function readOrgFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseOrg(content);
}

function parseOrg(content) {
  const lines = content.split('\n');
  const meta = {};
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(META_RE);
    if (m) {
      meta[m[1]] = m[2].trim();
      bodyStart = i + 1;
    } else if (lines[i].trim() === '') {
      if (Object.keys(meta).length > 0) {
        bodyStart = i + 1;
        break;
      }
    } else {
      break;
    }
  }

  const bodyLines = lines.slice(bodyStart);
  const description = extractSrcBlock(bodyLines);
  return { meta, description };
}

/**
 * Extract content from inside a #+BEGIN_SRC ... #+END_SRC block.
 * Falls back to the raw body if no src block is found (backward compat).
 */
function extractSrcBlock(lines) {
  const startIdx = lines.findIndex(l => SRC_BEGIN_RE.test(l));
  const endIdx = lines.findIndex(l => SRC_END_RE.test(l));

  if (startIdx !== -1 && endIdx > startIdx) {
    const inner = lines.slice(startIdx + 1, endIdx);
    return decodeSrcContent(inner);
  }

  return lines.join('\n').trim();
}

function decodeSrcContent(lines) {
  return lines
    .map(line => {
      const stripped = line.startsWith('  ') ? line.slice(2) : line;
      // ,* is the org-mode escape for * at column 0
      return stripped.startsWith(',*') ? stripped.slice(1) : stripped;
    })
    .join('\n')
    .trim();
}

function encodeSrcContent(description) {
  return description
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => {
      if (line === '') return '';
      return line.startsWith('*') ? '  ,' + line : '  ' + line;
    })
    .join('\n');
}

/**
 * Serialize { meta, description } back to org file content.
 * description is wrapped in a #+BEGIN_SRC block using the markup type from meta.
 */
function formatOrg(meta, description) {
  const metaLines = META_KEYS
    .filter(k => meta[k] != null && meta[k] !== '')
    .map(k => `#+${k}: ${meta[k]}`);

  const markup = meta.REDMINE_MARKUP || 'textile';
  const body = [
    `#+BEGIN_SRC ${markup}`,
    encodeSrcContent(description || ''),
    '#+END_SRC',
  ].join('\n');

  return [...metaLines, '', body].join('\n');
}

/**
 * Write meta + description to an org file, creating directories as needed.
 */
function writeOrgFile(filePath, meta, description) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, formatOrg(meta, description), 'utf-8');
}

/**
 * Convert a Redmine API issue object to { meta, description }.
 */
function issueToOrg(issue, instanceName, markup) {
  const meta = {
    TITLE: issue.subject,
    REDMINE_INSTANCE: instanceName,
    REDMINE_ID: String(issue.id),
    REDMINE_PROJECT: issue.project?.name || '',
    REDMINE_PROJECT_ID: String(issue.project?.id || ''),
    REDMINE_STATUS: issue.status?.name || '',
    REDMINE_STATUS_ID: String(issue.status?.id || ''),
    REDMINE_PRIORITY: issue.priority?.name || '',
    REDMINE_PRIORITY_ID: String(issue.priority?.id || ''),
    REDMINE_ASSIGNED_TO: issue.assigned_to?.name || '',
    REDMINE_ASSIGNED_TO_ID: String(issue.assigned_to?.id || ''),
    REDMINE_VERSION: issue.fixed_version?.name || '',
    REDMINE_VERSION_ID: String(issue.fixed_version?.id || ''),
    REDMINE_MARKUP: markup || 'textile',
    REDMINE_LOCK_VERSION: String(issue.lock_version ?? ''),
    REDMINE_UPDATED_ON: issue.updated_on || '',
    REDMINE_CREATED_ON: issue.created_on || '',
  };

  return { meta, description: issue.description || '' };
}

/**
 * Convert org file meta + description into a Redmine API payload for PUT/POST.
 */
function orgToPayload(meta, description) {
  const payload = {
    subject: meta.TITLE,
    description,
  };

  if (meta.REDMINE_STATUS_ID) payload.status_id = Number(meta.REDMINE_STATUS_ID);
  if (meta.REDMINE_PRIORITY_ID) payload.priority_id = Number(meta.REDMINE_PRIORITY_ID);
  if (meta.REDMINE_ASSIGNED_TO_ID) payload.assigned_to_id = Number(meta.REDMINE_ASSIGNED_TO_ID) || null;
  if (meta.REDMINE_PROJECT_ID) payload.project_id = Number(meta.REDMINE_PROJECT_ID);
  if (meta.REDMINE_VERSION_ID) payload.fixed_version_id = Number(meta.REDMINE_VERSION_ID);

  // lock_version enables conflict detection on the server side; omitted on new issues
  if (meta.REDMINE_LOCK_VERSION !== '' && meta.REDMINE_LOCK_VERSION != null) {
    payload.lock_version = Number(meta.REDMINE_LOCK_VERSION);
  }

  return payload;
}

/**
 * Build the local file path for a fetched issue: localDir/<project>/<id>-<slug>.org
 */
function issueFilePath(localDir, projectName, issueId, title) {
  const projectSlug = slugify(projectName);
  const titleSlug = slugify(title).slice(0, 40);
  const filename = `${issueId}-${titleSlug}.org`;
  return path.join(localDir, projectSlug, filename);
}

/**
 * Build the local file path for a new draft: localDir/_drafts/new-<timestamp>.org
 */
function draftFilePath(localDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(localDir, '_drafts', `new-${ts}.org`);
}

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  readOrgFile,
  writeOrgFile,
  issueToOrg,
  orgToPayload,
  issueFilePath,
  draftFilePath,
};
