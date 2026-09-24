import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { useInfiniteQuery, useQueryClient } from '@tanstack/vue-query'
import { queryTasks } from '../api/native-download/tasks'
import type { TaskListItemV2, TaskQueryRequestV2 } from '../api/contracts/v2/tasks'

export interface TaskQueryOptions {
  view: Ref<TaskQueryRequestV2['view']>
  search: Ref<string>
  sort: Ref<NonNullable<TaskQueryRequestV2['sort']>>
  groupBy: Ref<NonNullable<TaskQueryRequestV2['groupBy']>>
}

export function useTaskQuery({ view, search, sort, groupBy }: TaskQueryOptions) {
  const visible = ref(typeof document === 'undefined' ? true : !document.hidden)
  const queryClient = useQueryClient()
  const onVisibility = () => { visible.value = !document.hidden; if (visible.value) queryClient.invalidateQueries({ queryKey: ['v2-task-query'] }) }
  onMounted(() => document.addEventListener('visibilitychange', onVisibility))
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibility))

  const normalizedSearch = computed(() => search.value.trim())
  const queryKey = computed(() => ['v2-task-query', view.value, normalizedSearch.value, sort.value, groupBy.value])
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => queryTasks({
      view: view.value,
      search: normalizedSearch.value || undefined,
      sort: sort.value,
      groupBy: groupBy.value,
      limit: 100,
      ...(pageParam ? { cursor: pageParam } : {}),
    }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchInterval: () => {
      if (!visible.value) return false
      if (view.value === 'downloading') return 1000
      return 3000
    },
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const items = computed<TaskListItemV2[]>(() => {
    const seen = new Set<string>()
    const result: TaskListItemV2[] = []
    for (const page of query.data.value?.pages || []) {
      for (const item of page.items) {
        if (seen.has(item.taskId)) continue
        seen.add(item.taskId)
        result.push(item)
      }
    }
    return result
  })
  const counts = computed(() => query.data.value?.pages[0]?.counts || null)
  const offline = computed(() => query.isError.value && items.value.length > 0)
  const loadMore = () => {
    if (query.hasNextPage.value && !query.isFetchingNextPage.value) return query.fetchNextPage()
    return Promise.resolve()
  }
  const refresh = () => query.refetch()

  return { ...query, queryKey, items, counts, offline, visible, loadMore, refresh }
}
