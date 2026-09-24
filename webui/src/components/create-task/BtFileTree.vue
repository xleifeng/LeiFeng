<script setup lang="ts">
import type { CreateDraftV2 } from '../../api/contracts/v2/create'
import { computed, ref } from 'vue'
import { directoryState, fileTreeRows, toggleDirectory, visibleFileTreeRows } from '../../domain/bt-file-selection'
const props = defineProps<{ draft: CreateDraftV2 }>()
const emit = defineEmits<{ toggle: [indices: number[]] }>()
function toggle(index: number) { const selected = new Set(props.draft.selectedFileIndices); if (selected.has(index)) selected.delete(index); else selected.add(index); emit('toggle', [...selected]) }
const collapsedPaths = ref(new Set<string>())
const allRows = computed(() => fileTreeRows(props.draft.files))
const rows = computed(() => visibleFileTreeRows(allRows.value, collapsedPaths.value))
const selectedBytes = computed(() => props.draft.files.filter((file) => props.draft.selectedFileIndices.includes(file.index)).reduce((sum, file) => sum + file.sizeBytes, 0))
function state(parentPath: string) { return directoryState(props.draft.files, props.draft.selectedFileIndices, parentPath) }
function toggleFolder(parentPath: string) { emit('toggle', toggleDirectory(props.draft.files, props.draft.selectedFileIndices, parentPath)) }
function isCollapsed(path: string) { return collapsedPaths.value.has(path) }
function toggleCollapsed(path: string) { const next = new Set(collapsedPaths.value); if (next.has(path)) next.delete(path); else next.add(path); collapsedPaths.value = next }
</script>
<template><section v-if="['bt', 'magnet'].includes(draft.kind) && draft.files.length" class="bt-file-tree"><div class="bt-tree-title"><label class="bt-select-all"><input type="checkbox" :checked="state('') === 'checked'" :indeterminate="state('') === 'indeterminate'" @change="toggleFolder('')" /><span>{{ state('') === 'checked' ? '取消全选' : '全选' }}</span></label><span>已选择 {{ draft.selectedFileIndices.length }} / {{ draft.files.length }}</span><small>已选 {{ (selectedBytes / 1024 / 1024).toFixed(1) }} MB</small></div><div class="bt-tree-rows"><div v-for="row in rows" :key="row.key" class="bt-file-row" :class="{ 'bt-directory-row': row.kind === 'directory' }" :style="{ '--bt-depth': row.depth }"><template v-if="row.kind === 'directory'"><input type="checkbox" :checked="state(row.path) === 'checked'" :indeterminate="state(row.path) === 'indeterminate'" :aria-label="`选择目录 ${row.name}`" @change="toggleFolder(row.path)" /><button class="bt-folder-toggle" type="button" :aria-expanded="!isCollapsed(row.path)" @click="toggleCollapsed(row.path)"><span class="bt-tree-icon" :class="{ collapsed: isCollapsed(row.path) }" aria-hidden="true">▾</span><span class="bt-folder-icon" aria-hidden="true">📁</span><span class="bt-folder-label">{{ row.name }}</span></button></template><template v-else><input type="checkbox" :checked="draft.selectedFileIndices.includes(row.file.index)" :aria-label="`选择文件 ${row.name}`" @change="toggle(row.file.index)" /><span class="bt-file-name"><span class="bt-file-indent" aria-hidden="true" />{{ row.name }}</span><small>{{ (row.file.sizeBytes / 1024 / 1024).toFixed(1) }} MB</small></template></div></div></section></template>
