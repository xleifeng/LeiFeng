'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TaskRepository } = require('../../host/src/repositories/task-repository'); const { DraftRepository } = require('../../host/src/repositories/draft-repository'); const { TaskRegistry } = require('../../host/src/registry'); const { SettingsRepository } = require('../../host/src/repositories/settings-repository');
const { TaskService } = require('../../host/src/services/task-service'); const { TaskQueryService } = require('../../host/src/services/task-query-service'); const { CreateTaskService } = require('../../host/src/services/create-task-service'); const { CreateDraftService } = require('../../host/src/services/create-draft-service'); const { PathService } = require('../../host/src/services/path-service'); const { SettingsService } = require('../../host/src/services/settings-service'); const { BootstrapService } = require('../../host/src/services/bootstrap-service');
const { createThunderUiV2Methods } = require('../../host/src/rpc/thunder-ui-v2-methods'); const { createMethodHandler } = require('../../host/src/methods');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-rpc-test-')); const repository = new TaskRepository({ filePath: path.join(dir, 'data', 'tasks.json') }); repository.load(); const settings = new SettingsRepository({ filePath: path.join(dir, 'data', 'settings.json'), defaults: { downloadDir: dir } }); settings.load();
  let id = 100; const driver = { sdkReady: true, bootedAt: Date.now(), restarts: 0, isHealthy: () => true, enginePid: () => 1, getQueueCount: async () => 0, getDhtNodeCount: async () => 0, getChannelSwitches: async () => ({}), createTask: async () => ++id, startTasks: async () => {}, stopTasks: async () => {}, deleteTasks: async () => {}, setGlobalLimits: async () => ({ ok: true }), parseTaskInfo: async () => ({}), resolveThunderUrl: async () => ({ resolvedUrl: 'http://x', taskType: 1 }) };
  const drafts = new DraftRepository({ filePath: path.join(dir, 'data', 'drafts.json') }); drafts.load();
  const auth = { getStatus: async () => ({ account: { valid: false } }) }; const vip = { disableTask: async () => {} }; const taskService = new TaskService({ tasks: repository, driver, vip }); const query = new TaskQueryService({ tasks: repository }); const create = new CreateTaskService({ tasks: repository, driver, settings, runtimeDir: dir, httpProbe: async () => 10 }); const createDraft = new CreateDraftService({ drafts, tasks: repository, pathService: new PathService({ defaultPath: dir }), parser: { parseInput: async (value) => ({ kind: 'http', normalizedSource: value, displayName: 'file.bin', totalBytes: 10, files: [] }) }, sourceProbe: async () => ({ status: 200, reachable: true, suggestedName: 'file.bin', totalBytes: 10, acceptRanges: true }), createTaskService: create }); const policy = new SettingsService({ settings, driver }); const bootstrap = new BootstrapService({ repository, settings, driver, auth, config: { version: 'test', rpcSecret: 'secret', host: '127.0.0.1' } }); const methods = createThunderUiV2Methods({ taskService, taskQueryService: query, createTaskService: create, createDraftService: createDraft, settingsService: policy, bootstrapService: bootstrap });
  return { repository, handler: createMethodHandler({ registry: TaskRegistry.fromRepository(repository), driver, auth, vip, config: { downloadDir: dir, runtimeDir: dir, version: 'test', rpcSecret: 'secret' }, v2Methods: methods }) };
}

test('V2 RPC requires header secret and uses draft create/query/command without aria2 handlers', async () => {
  const { repository, handler } = setup();
  await assert.rejects(handler('thunder.ui.v2.tasks.query', [{}], {}), (error) => error.code === 1);
  await assert.rejects(handler('thunder.ui.v2.tasks.create', [{ items: [{ kind: 'uri', value: 'http://x/file.bin' }], options: {} }], { bearerToken: 'secret' }), (error) => error.code === -32601);
  const preflight = await handler('thunder.ui.v2.create.preflight', [{ inputs: [{ kind: 'link', value: 'http://x/file.bin' }], savePath: path.dirname(repository.filePath) }], { bearerToken: 'secret' });
  assert.equal(preflight.results[0].ok, true);
  const draft = preflight.results[0].draft;
  const created = await handler('thunder.ui.v2.create.commit', [{ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: draft.revision }, idempotencyKey: 'rpc-create' }], { bearerToken: 'secret' });
  assert.equal(created.results[0].ok, true);
  const query = await handler('thunder.ui.v2.tasks.query', [{}], { bearerToken: 'secret' });
  const taskId = query.items[0].taskId;
  const command = await handler('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'pause', idempotencyKey: 'one' }], { bearerToken: 'secret' });
  assert.equal(command.results[0].ok, true); assert.equal((await handler('thunder.ui.v2.tasks.get', [{ taskId }], { bearerToken: 'secret' })).lifecycle, 'paused'); assert.equal(repository.list()[0].id, taskId);
});
