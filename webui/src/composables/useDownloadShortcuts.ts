import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { TaskCommand, TaskListItemV2 } from '../api/contracts/v2/tasks'

interface ShortcutHandlers {
  selected: Ref<TaskListItemV2[]>
  visibleIds: Ref<string[]>
  focused: Ref<TaskListItemV2 | null>
  onNewTask: () => void
  onSearch: () => void
  onSelectAll: () => void
  onCopy: () => void
  onToggle: () => void
  onOpen: () => void
  onCommand: (command: TaskCommand) => void
  onDetails: () => void
  onEscape: () => void
  onRename: () => void
}

function isEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable)
}

export function useDownloadShortcuts(handlers: ShortcutHandlers) {
  function onKeydown(event: KeyboardEvent) {
    if (isEditable(event.target)) {
      if (event.key === 'Escape') handlers.onEscape()
      return
    }
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && event.key.toLowerCase() === 'n') { event.preventDefault(); handlers.onNewTask(); return }
    if (modifier && event.key.toLowerCase() === 'f') { event.preventDefault(); handlers.onSearch(); return }
    if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); handlers.onSelectAll(); return }
    if (modifier && event.key.toLowerCase() === 'c') { handlers.onCopy(); return }
    if (modifier && event.key.toLowerCase() === 'i') { event.preventDefault(); handlers.onDetails(); return }
    if (event.key === ' ') { event.preventDefault(); handlers.onToggle(); return }
    if (event.key === 'Enter') { event.preventDefault(); handlers.onOpen(); return }
    if (event.key === 'Delete') { event.preventDefault(); handlers.onCommand(event.shiftKey ? 'delete-permanently' : 'recycle'); return }
    if (event.key === 'F2') { event.preventDefault(); handlers.onRename(); return }
    if (event.key === 'Escape') { event.preventDefault(); handlers.onEscape() }
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
