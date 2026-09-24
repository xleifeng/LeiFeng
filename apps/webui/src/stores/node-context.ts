import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { RemoteNode } from '../api/contracts/v2/remote'
import { queryRemoteNodes } from '../api/native-download/remote'

export const useNodeContextStore = defineStore('node-context', () => {
  const selectedNodeId = ref('local')
  const nodes = ref<RemoteNode[]>([])
  const loading = ref(false)
  const availableNodes = computed(() => [{ id: 'local', name: '本机', state: 'online' as const }, ...nodes.value])
  async function refresh() { loading.value = true; try { nodes.value = await queryRemoteNodes() } finally { loading.value = false } }
  function setSelectedNode(value: string) { selectedNodeId.value = value }
  return { selectedNodeId, nodes, availableNodes, loading, refresh, setSelectedNode }
})
