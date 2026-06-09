'use strict';

const readline = require('readline');

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function askChoice(question, choices) {
  console.log(question);
  choices.forEach((c, i) => console.log(`  ${i + 1}) ${c}`));
  while (true) {
    const answer = await ask('> ');
    const byIndex = parseInt(answer, 10);
    if (byIndex >= 1 && byIndex <= choices.length) return choices[byIndex - 1];
    const byName = choices.find(c => c.toLowerCase() === answer.toLowerCase());
    if (byName) return byName;
    console.log(`Please enter a number (1-${choices.length}) or a name: ${choices.join(', ')}`);
  }
}

/**
 * Like askChoice but Enter skips the selection and returns null.
 * labelFn(item) returns the display string for each item.
 */
async function askChoiceOrSkip(question, choices, labelFn = String) {
  console.log(`${question} (Enter to skip)`);
  choices.forEach((c, i) => console.log(`  ${i + 1}) ${labelFn(c)}`));
  while (true) {
    const answer = await ask('> ');
    if (answer === '') return null;
    const byIndex = parseInt(answer, 10);
    if (byIndex >= 1 && byIndex <= choices.length) return choices[byIndex - 1];
    const byName = choices.find(c => labelFn(c).toLowerCase() === answer.toLowerCase());
    if (byName) return byName;
    console.log(`Please enter a number (1-${choices.length}), a name, or Enter to skip`);
  }
}

module.exports = { ask, askChoice, askChoiceOrSkip };
