'use strict';

const axios = require('axios');

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

class RedmineClient {
  constructor(config) {
    this.http = axios.create({
      baseURL: config.server.replace(/\/$/, ''),
      headers: {
        'X-Redmine-API-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  async getIssue(id) {
    const res = await this._get(`/issues/${id}.json`, { include: 'journals' });
    return res.data.issue;
  }

  async getIssues(params = {}) {
    // Redmine returns at most 100 per page; fetch all pages automatically
    const limit = 100;
    let offset = 0;
    const all = [];

    while (true) {
      const res = await this._get('/issues.json', { ...params, limit, offset });
      const { issues, total_count } = res.data;
      if (!issues || issues.length === 0) break;
      all.push(...issues);
      offset += issues.length;
      if (total_count !== undefined && offset >= total_count) break;
    }

    return all;
  }

  async createIssue(payload) {
    const res = await this._post('/issues.json', { issue: payload });
    return res.data.issue;
  }

  async updateIssue(id, payload) {
    // PUT returns 200 (newer Redmine) or 204 (older Redmine)
    await this._put(`/issues/${id}.json`, { issue: payload });
  }

  async getIssueStatuses() {
    const res = await this._get('/issue_statuses.json');
    return res.data.issue_statuses;
  }

  async getPriorities() {
    const res = await this._get('/enumerations/issue_priorities.json');
    return res.data.issue_priorities;
  }

  async getProjects() {
    const res = await this._get('/projects.json', { limit: 100 });
    return res.data.projects;
  }

  async getVersions(projectId) {
    const res = await this._get(`/projects/${projectId}/versions.json`);
    return res.data.versions;
  }

  async getProjectMembers(projectId) {
    const res = await this._get(`/projects/${projectId}/memberships.json`, { limit: 100 });
    return res.data.memberships
      .filter(m => m.user)
      .map(m => m.user);
  }

  async getIssueCategories(projectId) {
    const res = await this._get(`/projects/${projectId}/issue_categories.json`);
    return res.data.issue_categories;
  }

  async resolveVersionName(projectId, versionName) {
    const versions = await this.getVersions(projectId);
    const match = versions.find(v => v.name === versionName);
    if (!match) {
      const names = versions.map(v => v.name).join(', ');
      throw new Error(`Version "${versionName}" not found in project. Available: ${names}`);
    }
    return match;
  }

  // ── internal HTTP methods ─────────────────────────────────────

  async _get(path, params = {}) {
    try {
      return await this.http.get(path, { params });
    } catch (e) {
      this._handleError(e);
    }
  }

  async _post(path, data) {
    try {
      return await this.http.post(path, data);
    } catch (e) {
      this._handleError(e);
    }
  }

  async _put(path, data) {
    try {
      return await this.http.put(path, data);
    } catch (e) {
      this._handleError(e);
    }
  }

  _handleError(e) {
    if (!e.response) throw new Error(`Network error: ${e.message}`);

    const { status, data } = e.response;

    if (status === 404) throw new NotFoundError('Issue not found');
    if (status === 409) throw new ConflictError('Edit conflict: the issue has been modified by someone else');
    if (status === 401 || status === 403) throw new Error('Authentication failed — check your apiKey');
    if (status === 422) {
      const errs = data?.errors?.join(', ') || 'validation failed';
      throw new Error(`Redmine rejected the request: ${errs}`);
    }

    throw new Error(`Redmine returned ${status}: ${JSON.stringify(data)}`);
  }
}

module.exports = { RedmineClient, ConflictError, NotFoundError };
