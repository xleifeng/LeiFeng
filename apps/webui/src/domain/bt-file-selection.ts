import type { DraftFileV2 } from '../api/contracts/v2/create'

export type SelectionState = 'checked' | 'unchecked' | 'indeterminate'
export type BtFileTreeRow =
  | { kind: 'directory'; key: string; path: string; name: string; depth: number }
  | { kind: 'file'; key: string; file: DraftFileV2; name: string; depth: number }

export function filesUnder(files: DraftFileV2[], parentPath: string) {
  const prefix = parentPath ? `${parentPath}/` : ''
  return files.filter((file) => file.relativePath === parentPath || file.relativePath.startsWith(prefix))
}

export function directoryState(files: DraftFileV2[], selectedIndices: number[], parentPath: string): SelectionState {
  const children = filesUnder(files, parentPath)
  if (!children.length) return 'unchecked'
  const selected = new Set(selectedIndices)
  const count = children.filter((file) => selected.has(file.index)).length
  return count === 0 ? 'unchecked' : count === children.length ? 'checked' : 'indeterminate'
}

export function toggleDirectory(files: DraftFileV2[], selectedIndices: number[], parentPath: string): number[] {
  const children = filesUnder(files, parentPath)
  const selected = new Set(selectedIndices)
  const state = directoryState(files, selectedIndices, parentPath)
  for (const file of children) if (state === 'checked') selected.delete(file.index); else selected.add(file.index)
  return [...selected].sort((a, b) => a - b)
}

export function directoryPaths(files: DraftFileV2[]) {
  return [...new Set(files.map((file) => file.parentPath).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function fileTreeRows(files: DraftFileV2[]): BtFileTreeRow[] {
  type DirectoryNode = { path: string; name: string; directories: Map<string, DirectoryNode>; files: DraftFileV2[] }
  const root: DirectoryNode = { path: '', name: '', directories: new Map(), files: [] }
  for (const file of files) {
    const parts = file.relativePath.split('/').filter(Boolean)
    const filename = parts.pop() || file.displayName
    let node = root
    for (const part of parts) {
      const childPath = node.path ? `${node.path}/${part}` : part
      if (!node.directories.has(part)) node.directories.set(part, { path: childPath, name: part, directories: new Map(), files: [] })
      node = node.directories.get(part)!
    }
    node.files.push({ ...file, displayName: filename })
  }
  const rows: BtFileTreeRow[] = []
  const append = (node: DirectoryNode, depth: number) => {
    const directories = [...node.directories.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    for (const directory of directories) {
      rows.push({ kind: 'directory', key: `dir:${directory.path}`, path: directory.path, name: directory.name, depth })
      append(directory, depth + 1)
    }
    for (const file of node.files) rows.push({ kind: 'file', key: `file:${file.index}`, file, name: file.displayName, depth })
  }
  append(root, 0)
  return rows
}

export function visibleFileTreeRows(rows: BtFileTreeRow[], collapsedPaths: Iterable<string>) {
  const collapsed = new Set(collapsedPaths)
  const hasCollapsedAncestor = (path: string) => {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      if (collapsed.has(current)) return true
    }
    return false
  }
  return rows.filter((row) => hasCollapsedAncestor(row.kind === 'directory' ? row.path : row.file.relativePath) === false)
}
