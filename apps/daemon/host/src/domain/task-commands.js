'use strict';

const TASK_COMMANDS = Object.freeze([
  'start', 'pause', 'remove-record', 'recycle', 'recover', 'delete-permanently', 'redownload',
  'rename', 'move', 'set-speed-limit', 'update-bt-selection', 'set-bt-scheduler',
  'open', 'show-in-folder', 'copy-info',
]);

const TASK_COMMAND_SET = new Set(TASK_COMMANDS);

function isTaskCommand(value) { return TASK_COMMAND_SET.has(String(value || '')); }

module.exports = { TASK_COMMANDS, TASK_COMMAND_SET, isTaskCommand };
