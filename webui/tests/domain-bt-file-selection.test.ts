import { describe, expect, it } from 'vitest'
import { directoryState, fileTreeRows, toggleDirectory, visibleFileTreeRows } from '../src/domain/bt-file-selection'
import type { DraftFileV2 } from '../src/api/contracts/v2/create'

const files: DraftFileV2[] = [
  { index: 0, relativePath: 'folder/a.bin', displayName: 'a.bin', sizeBytes: 1, offsetBytes: 0, selected: true, parentPath: 'folder' },
  { index: 1, relativePath: 'folder/b.bin', displayName: 'b.bin', sizeBytes: 2, offsetBytes: 1, selected: true, parentPath: 'folder' },
  { index: 2, relativePath: 'root.bin', displayName: 'root.bin', sizeBytes: 3, offsetBytes: 3, selected: true, parentPath: '' },
]

describe('BT directory selection', () => {
  it('reports checked, indeterminate and unchecked states', () => {
    expect(directoryState(files, [0, 1], 'folder')).toBe('checked')
    expect(directoryState(files, [0], 'folder')).toBe('indeterminate')
    expect(directoryState(files, [], 'folder')).toBe('unchecked')
  })
  it('toggles a directory as one selection unit', () => {
    expect(toggleDirectory(files, [0], 'folder')).toEqual([0, 1])
    expect(toggleDirectory(files, [0, 1], 'folder')).toEqual([])
  })
  it('toggles the root as select-all and cancel-all', () => {
    expect(toggleDirectory(files, [], '')).toEqual([0, 1, 2])
    expect(toggleDirectory(files, [0, 1, 2], '')).toEqual([])
    expect(directoryState(files, [0], '')).toBe('indeterminate')
  })
  it('builds directories before their nested files instead of flattening paths', () => {
    const nested = [...files, { index: 3, relativePath: 'folder/sub/c.bin', displayName: 'c.bin', sizeBytes: 4, offsetBytes: 6, selected: true, parentPath: 'folder/sub' }]
    expect(fileTreeRows(nested).map((row) => row.kind === 'directory' ? `d:${row.depth}:${row.name}` : `f:${row.depth}:${row.name}`)).toEqual([
      'd:0:folder', 'd:1:sub', 'f:2:c.bin', 'f:1:a.bin', 'f:1:b.bin', 'f:0:root.bin',
    ])
  })
  it('hides every descendant of a collapsed directory but keeps its own row', () => {
    const nested = [...files, { index: 3, relativePath: 'folder/sub/c.bin', displayName: 'c.bin', sizeBytes: 4, offsetBytes: 6, selected: true, parentPath: 'folder/sub' }]
    const rows = fileTreeRows(nested)
    expect(visibleFileTreeRows(rows, ['folder']).map((row) => row.key)).toEqual(['dir:folder', 'file:2'])
    expect(visibleFileTreeRows(rows, ['folder/sub']).map((row) => row.key)).toEqual(['dir:folder', 'dir:folder/sub', 'file:0', 'file:1', 'file:2'])
  })
})
