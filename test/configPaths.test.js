'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const configPathsModule = require.resolve('../src/lib/configPaths');
const configModule = require.resolve('../src/lib/config');
const cacheModule = require.resolve('../src/lib/cache');
const { resolveConfigDirectory } = require(configPathsModule);

function clearConfigModules() {
  delete require.cache[configModule];
  delete require.cache[cacheModule];
  delete require.cache[configPathsModule];
}

function restoreConfigDirectory(previousValue) {
  if (previousValue === undefined) {
    delete process.env.ORGMINE_CONFIG_DIR;
    return;
  }
  process.env.ORGMINE_CONFIG_DIR = previousValue;
}

test('uses ~/.config/orgmine when ORGMINE_CONFIG_DIR is not set', () => {
  assert.equal(
    resolveConfigDirectory({}, '/home/example'),
    path.join('/home/example', '.config', 'orgmine')
  );
});

test('config and cache use ORGMINE_CONFIG_DIR', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orgmine-config-test-'));
  const previousValue = process.env.ORGMINE_CONFIG_DIR;

  t.after(() => {
    restoreConfigDirectory(previousValue);
    clearConfigModules();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    default: 'test',
    instances: {
      test: {
        server: 'https://example.invalid',
        apiKey: 'test-key',
        localDir: '/tmp/orgmine-test-data',
      },
    },
  }), 'utf-8');

  process.env.ORGMINE_CONFIG_DIR = directory;
  clearConfigModules();

  const { CONFIG_PATH, loadConfig } = require(configModule);
  const { CACHE_PATH, getInstanceCache, setInstanceCache } = require(cacheModule);

  assert.equal(CONFIG_PATH, path.join(directory, 'config.json'));
  assert.equal(CACHE_PATH, path.join(directory, 'cache.json'));
  assert.equal(loadConfig().instanceName, 'test');

  setInstanceCache('test', { projects: [{ id: 1, name: 'Test' }] });
  assert.deepEqual(getInstanceCache('test').projects, [{ id: 1, name: 'Test' }]);
});
