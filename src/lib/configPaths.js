'use strict';

const os = require('os');
const path = require('path');

function resolveConfigDirectory(environment = process.env, homeDirectory = os.homedir()) {
  return environment.ORGMINE_CONFIG_DIR || path.join(homeDirectory, '.config', 'orgmine');
}

const CONFIG_DIRECTORY = resolveConfigDirectory();
const CONFIG_PATH = path.join(CONFIG_DIRECTORY, 'config.json');
const CACHE_PATH = path.join(CONFIG_DIRECTORY, 'cache.json');

module.exports = {
  resolveConfigDirectory,
  CONFIG_DIRECTORY,
  CONFIG_PATH,
  CACHE_PATH,
};
