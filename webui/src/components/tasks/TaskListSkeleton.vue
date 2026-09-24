<template>
  <div class="task-skeleton-list" aria-label="正在加载任务" aria-busy="true">
    <div v-for="index in 7" :key="index" class="task-skeleton-row"><span class="skeleton skeleton-icon" /><div class="skeleton-copy"><span class="skeleton skeleton-line long" /><span class="skeleton skeleton-line short" /></div><span class="skeleton skeleton-progress" /></div>
  </div>
</template>
