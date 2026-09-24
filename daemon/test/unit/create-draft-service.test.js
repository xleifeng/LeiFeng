'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { TaskRepository } = require('../../host/src/repositories/task-repository'); const { DraftRepository } = require('../../host/src/repositories/draft-repository'); const { PathService } = require('../../host/src/services/path-service'); const { CreateDraftService } = require('../../host/src/services/create-draft-service'); const { CreateTaskService } = require('../../host/src/services/create-task-service');

test('HTTP preflight follows redirects and falls back from HEAD to a one-byte range probe', async () => {
  const { probeUrl } = require('../../host/src/services/create-draft-service');
  const calls = [];
  const request = async (url, options) => {
    calls.push([url, options.method, options.headers || {}]);
    if (url.endsWith('/redirect')) return { status: 302, headers: { location: '/file' }, location: '/file' };
    if (options.method === 'HEAD') return { status: 405, headers: {} };
    return { status: 206, headers: { 'content-range': 'bytes 0-0/1234', 'content-disposition': "attachment; filename*=UTF-8''hello%20world.bin", 'accept-ranges': 'bytes' } };
  };
  const result = await probeUrl('http://fixture.test/redirect', 5000, request);
  assert.equal(result.reachable, true); assert.equal(result.totalBytes, 1234); assert.equal(result.suggestedName, 'hello world.bin'); assert.equal(result.acceptRanges, true); assert.match(result.finalUrl, /\/file$/);
  assert.deepEqual(calls.map(([url, method]) => [new URL(url).pathname, method]), [['/redirect', 'HEAD'], ['/file', 'HEAD'], ['/file', 'GET']]);
  assert.equal(calls[2][2].range, 'bytes=0-0');
});

test('create draft preflight is per-input and commit is idempotent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-draft-v2-')); const tasks = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); tasks.load();
  const drafts = new DraftRepository({ filePath: path.join(dir, 'drafts.json'), idFactory: (() => { let n = 0; return () => `draft-${++n}` })() }); drafts.load();
  const calls = []; const createTaskService = { commitDraft: async (draft) => { calls.push(draft); return 'task-1'; } };
  const service = new CreateDraftService({ drafts, tasks, pathService: new PathService({ defaultPath: dir }), sourceProbe: async () => ({ reachable: true, status: 200, suggestedName: 'fixture.bin', totalBytes: 10 }), createTaskService });
  const preflight = await service.preflight({ inputs: ['http://example.test/a', 'sftp://bad.test/a'], savePath: dir });
  assert.equal(preflight.results.filter((item) => item.ok).length, 1); const draft = preflight.results[0].draft; assert.equal(draft.displayName, 'fixture.bin');
  const first = await service.commit({ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: draft.revision }, idempotencyKey: 'same' }); const second = await service.commit({ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: draft.revision }, idempotencyKey: 'same' });
  assert.deepEqual(second, first); assert.equal(calls.length, 1);
});

test('duplicate drafts require an explicit resolution and magnet metadata commits as BT without leaking a seed path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-draft-duplicate-v2-')); const tasks = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); tasks.load();
  const seedSource = path.join(dir, 'source.torrent'); fs.writeFileSync(seedSource, Buffer.from('d4:infod4:name4:testee', 'ascii'));
  const { SeedStore } = require('../../host/src/repositories/seed-store'); const seedStore = new SeedStore({ rootDir: path.join(dir, 'seeds') }); const seedRef = seedStore.importFile(seedSource);
  const { sourceFingerprint } = require('../../host/src/repositories/task-repository'); const existing = tasks.create({ source: 'http://example.test/file', savePath: dir, displayName: 'file.bin', sourceFingerprint: sourceFingerprint('http', 'http://example.test/file'), lifecycle: 'queued' });
  const drafts = new DraftRepository({ filePath: path.join(dir, 'drafts.json'), idFactory: (() => { let n = 0; return () => `draft-${++n}` })() }); drafts.load();
  const calls = []; const createTaskService = { commitDraft: async (draft) => { calls.push(draft); return 'task-new'; } };
  const service = new CreateDraftService({ drafts, tasks, seedStore, pathService: new PathService({ defaultPath: dir }), parser: { parseInput: async () => ({ kind: 'http', normalizedSource: 'http://example.test/file', displayName: 'file.bin', totalBytes: 1, files: [] }) }, sourceProbe: async () => ({ reachable: true, status: 200, suggestedName: 'file.bin', totalBytes: 1 }), createTaskService });
  const preflight = await service.preflight({ inputs: ['http://example.test/file'], savePath: dir }); const draft = preflight.results[0].draft;
  assert.equal(draft.duplicate.taskId, existing.id);
  const unresolved = await service.commit({ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: draft.revision } });
  assert.equal(unresolved.results[0].error.code, 'DUPLICATE_TASK');
  const opened = await service.updateDraft({ draftId: draft.draftId, expectedRevision: draft.revision, duplicateResolution: 'open-existing' });
  const openedResult = await service.commit({ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: opened.revision } });
  assert.deepEqual(openedResult.results[0].taskIds, [existing.id]); assert.equal(calls.length, 0);

  const nativeDriver = { parseTaskInfo: async () => ({ infoId: 'info-1', fileLists: [{ realIndex: 0, fileName: 'file.bin', filePath: 'file.bin', fileSize: 1, fileOffset: 0 }] }), createTask: async () => 101, startTasks: async () => {}, deleteTasks: async () => {} };
  const magnetCreate = new CreateTaskService({ tasks, driver: nativeDriver, seedStore, runtimeDir: dir });
  const magnetService = new CreateDraftService({ drafts, tasks, seedStore, pathService: new PathService({ defaultPath: dir }), createTaskService: magnetCreate });
  const magnetDraft = drafts.create({ state: 'ready', kind: 'magnet', originalSource: 'magnet:?xt=urn:btih:abc', normalizedSource: 'magnet:?xt=urn:btih:abc', sourceFingerprint: 'magnet-fp', seedRef, displayName: 'magnet.bin', savePath: dir, files: [{ index: 0, relativePath: 'file.bin', displayName: 'file.bin', sizeBytes: 1, offsetBytes: 0, selected: true, parentPath: '' }], selectedFileIndices: [0], totalBytes: 1 });
  const committed = await magnetService.commit({ draftIds: [magnetDraft.draftId], expectedRevisions: { [magnetDraft.draftId]: magnetDraft.revision } });
  assert.equal(committed.results[0].ok, true); const task = tasks.get(committed.results[0].taskIds[0]); assert.equal(task.kind, 'magnet'); assert.match(task.seedRef, /^sha256:/); assert.equal(task.seedRef.includes(dir), false);
});

test('torrent draft strips an uploaded device absolute path and keeps portable relative names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-draft-path-v2-'));
  const torrent = path.join(dir, 'upload.torrent');
  fs.writeFileSync(torrent, Buffer.from('d4:infod4:name', 'ascii'));
  const tasks = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); tasks.load();
  const drafts = new DraftRepository({ filePath: path.join(dir, 'drafts.json') }); drafts.load();
  const service = new CreateDraftService({
    drafts,
    tasks,
    pathService: new PathService({ defaultPath: dir }),
    driver: {
      parseTaskInfo: async () => ({
        infoId: 'foreign-info',
        title: 'portable-download',
        fileLists: [
          { realIndex: 0, filePath: 'C:\\Users\\alice\\Downloads\\movie.mkv', fileName: 'movie.mkv', fileSize: 2, fileOffset: 0 },
          { realIndex: 1, filePath: 'folder\\episode.mkv', fileName: 'episode.mkv', fileSize: 3, fileOffset: 2 },
          { realIndex: 2, filePath: '/Users/alice/extra.bin', fileName: '', fileSize: 4, fileOffset: 5 },
          { realIndex: 3, filePath: '原生目录\\子目录\\', fileName: '视频.mp4', fileSize: 5, fileOffset: 9 },
        ],
      }),
    },
  });
  const draft = await service.createTorrentDraftFromFile(torrent, { originalName: 'upload.torrent', savePath: dir });
  assert.deepEqual(draft.files.map((file) => file.relativePath), ['movie.mkv', 'folder/episode.mkv', 'extra.bin', '原生目录/子目录/视频.mp4']);
  assert.equal(draft.files.every((file) => !file.relativePath.startsWith('/') && !file.relativePath.includes('..')), true);
});

test('torrent draft consumes the text normalized by the native driver boundary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-draft-encoding-v2-'));
  const name = Buffer.from('中文视频.mp4', 'utf8');
  const torrent = path.join(dir, 'encoding.torrent');
  fs.writeFileSync(torrent, Buffer.concat([Buffer.from(`d4:infod4:name${name.length}:`, 'ascii'), name, Buffer.from('ee', 'ascii')]));
  const tasks = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); tasks.load();
  const drafts = new DraftRepository({ filePath: path.join(dir, 'drafts.json') }); drafts.load();
  const service = new CreateDraftService({
    drafts,
    tasks,
    pathService: new PathService({ defaultPath: dir }),
    driver: { parseTaskInfo: async () => ({ infoId: 'encoding-info', title: '中文视频.mp4', fileLists: [{ realIndex: 0, fileName: '中文视频.mp4', filePath: '', fileSize: 5, fileOffset: 0 }] }) },
  });
  let draft = await service.createTorrentDraftFromFile(torrent, { originalName: 'encoding.torrent', savePath: dir });
  assert.equal(draft.displayName, '中文视频.mp4');
  assert.equal(draft.files[0].relativePath, '中文视频.mp4');
  draft = await service.updateDraft({ draftId: draft.draftId, expectedRevision: draft.revision, selectedFileIndices: [] });
  assert.deepEqual(draft.selectedFileIndices, []);
  assert.equal(draft.files[0].selected, false);
  const committed = await service.commit({ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: draft.revision } });
  assert.equal(committed.results[0].error.code, 'EMPTY_SELECTION');
});
