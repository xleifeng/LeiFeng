import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCreateTaskStore } from '../../src/stores/create-task'
import type { CreateDraftV2 } from '../../src/api/contracts/v2/create'

vi.mock('../../src/api/native-download/create', () => ({
  preflightCreate: vi.fn(),
  commitCreateDrafts: vi.fn(),
  cancelCreateDrafts: vi.fn(),
  updateCreateDraft: vi.fn(),
}))
import { preflightCreate, commitCreateDrafts } from '../../src/api/native-download/create'

const draft: CreateDraftV2 = { draftId: 'draft-ui-1', revision: 1, state: 'ready', kind: 'http', originalSource: 'http://x/file', normalizedSource: 'http://x/file', displayName: 'file.bin', savePath: '/downloads', totalBytes: 10, files: [], selectedFileIndices: [], duplicate: null, metadata: { state: 'none' }, failure: null, expiresAt: Date.now() + 10000, createdAt: 1, updatedAt: 1 }

describe('create task store', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.mocked(preflightCreate).mockReset(); vi.mocked(commitCreateDrafts).mockReset() })
  it('moves link input through preflight and commit with draft revisions', async () => {
    vi.mocked(preflightCreate).mockResolvedValue({ results: [{ ok: true, draft }] })
    vi.mocked(commitCreateDrafts).mockResolvedValue({ operationId: 'op', results: [{ draftId: draft.draftId, ok: true, taskIds: ['task-1'] }] })
    const store = useCreateTaskStore(); store.openForLinks('http://x/file')
    await store.preflightLinks(); expect(store.step).toBe('options'); expect(store.drafts[0].draftId).toBe(draft.draftId)
    await store.commit(); expect(commitCreateDrafts).toHaveBeenCalledWith([draft.draftId], { [draft.draftId]: draft.revision }, undefined, undefined); expect(store.step).toBe('result'); expect(store.commitResults[0].taskIds).toEqual(['task-1'])
  })
  it('keeps per-link preflight errors while allowing valid links to continue', async () => {
    vi.mocked(preflightCreate).mockResolvedValue({ results: [{ ok: false, error: { code: 'UNSUPPORTED_PROTOCOL', message: '不支持' } }, { ok: true, draft }] })
    const store = useCreateTaskStore(); store.openForLinks('ftp://bad\nhttp://x/file'); await store.preflightLinks()
    expect(store.step).toBe('options'); expect(store.preflightErrors[0].code).toBe('UNSUPPORTED_PROTOCOL'); expect(store.drafts).toHaveLength(1)
  })
})
