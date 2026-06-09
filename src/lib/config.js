'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.config', 'orgmine', 'config.json');

function loadConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}\nPlease create it. See config.example.json for the format.`);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    throw new Error(`Failed to parse config file: ${e.message}`);
  }
}

function validateInstance(inst, name) {
  const required = ['server', 'apiKey', 'localDir'];
  for (const key of required) {
    if (!inst[key]) throw new Error(`Instance "${name}" is missing required field: ${key}`);
  }
}

/**
 * Load config for the specified instance, with optional CLI overrides.
 * If all required fields (server, apiKey, localDir) are supplied via overrides,
 * the config file is not required.
 * @param {string|null} instanceName  instance name from -i flag, null = use default
 * @param {object} overrides          CLI values that override the config file
 */
function loadConfig(instanceName, overrides = {}) {
  const defined = filterDefined(overrides);
  const required = ['server', 'apiKey', 'localDir'];
  const allProvidedViaCLI = required.every(k => defined[k]);

  if (allProvidedViaCLI) {
    const name = instanceName || 'default';
    const merged = { ...defined, instanceName: name };
    merged.localDir = expandHome(merged.localDir);
    return merged;
  }

  const file = loadConfigFile();

  if (!file.instances || typeof file.instances !== 'object') {
    throw new Error('Config file is missing the "instances" field');
  }

  const name = instanceName || file.default;
  if (!name) throw new Error('No instance specified and no "default" field in config');

  const inst = file.instances[name];
  if (!inst) throw new Error(`Instance "${name}" not found in config`);

  const merged = { ...inst, ...defined, instanceName: name };
  merged.localDir = expandHome(merged.localDir);

  validateInstance(merged, name);
  return merged;
}

/**
 * Return all instance names (for help/error messages).
 */
function listInstances() {
  const file = loadConfigFile();
  return Object.keys(file.instances || {});
}

function filterDefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null));
}

function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

module.exports = { loadConfig, listInstances, expandHome, CONFIG_PATH };
