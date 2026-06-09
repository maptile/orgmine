'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { CONFIG_PATH } = require('../lib/config');

const TEMPLATE = {
  default: 'work',
  instances: {
    work: {
      server: 'https://redmine.yourcompany.com',
      apiKey: 'your-api-key-here',
      localDir: '~/redmine-issues/work',
      markup: 'textile',
      statusOrder: [
        'new', 'confirmed', 'assigned', 'InProgress', 'resolved',
        'verified', 'deferred', 'closed', 'rejected', 'cancelled', 'reopened',
      ],
      highlightRejected: true,
      highlightReopened: true,
      reopenedAsAssigned: false,
    },
  },
};

function init() {
  if (fs.existsSync(CONFIG_PATH)) {
    console.error(chalk.red(`Config file already exists: ${CONFIG_PATH}`));
    console.error(chalk.dim('Remove it manually if you want to start over.'));
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(TEMPLATE, null, 2) + '\n', 'utf-8');

  console.log(chalk.green(`✓ Created: ${CONFIG_PATH}`));
  console.log(chalk.dim('Edit the file to set your server URL, API key, and local directory.'));
}

module.exports = { init };
