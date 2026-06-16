'use strict';

const { spawnSync } = require('child_process');

const DEFAULT_EDITOR = 'emacsclient -n';

/**
 * Resolve the editor command string, in priority order:
 *   config.editor > $ORGMINE_EDITOR > $VISUAL > $EDITOR > default (emacsclient -n)
 * The resolved string is split on whitespace into a program and its arguments;
 * the file path is appended as the final argument.
 */
function resolveEditorCommand(config) {
  return (
    config.editor ||
    process.env.ORGMINE_EDITOR ||
    process.env.VISUAL ||
    process.env.EDITOR ||
    DEFAULT_EDITOR
  );
}

/**
 * Open filePath in the user's editor.
 *
 * The mechanism is editor-agnostic: the command is split into a program and
 * arguments, the file path is appended, and the child inherits stdio. This
 * covers all three editor families:
 *   - running-instance clients (emacsclient -n, code, subl): return at once
 *   - terminal editors (vim, nano, emacs -nw): block until the editor closes
 *   - GUI launchers (emacs): spawn a new window
 *
 * @returns {boolean} true if the editor launched successfully
 */
function openInEditor(filePath, config) {
  const command = resolveEditorCommand(config);
  const parts = command.split(/\s+/).filter(Boolean);
  const program = parts[0];
  const args = [...parts.slice(1), filePath];

  const result = spawnSync(program, args, { stdio: 'inherit' });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        `Editor command not found: "${program}".\n` +
        `Set "editor" in your config, or the $ORGMINE_EDITOR / $EDITOR env var.`
      );
    }
    throw new Error(`Failed to launch editor "${command}": ${result.error.message}`);
  }

  if (result.status !== 0) {
    const hint = program === 'emacsclient'
      ? '\nIs the Emacs server running? Add (server-start) to your init, or run M-x server-start.'
      : '';
    throw new Error(`Editor "${command}" exited with code ${result.status}.${hint}`);
  }

  return true;
}

module.exports = { openInEditor, resolveEditorCommand, DEFAULT_EDITOR };
