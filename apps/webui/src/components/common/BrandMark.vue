<script setup lang="ts">
// Leifeng 品牌标：圆角方块内闪电形（自绘，非任何第三方商标）
withDefaults(defineProps<{ size?: number }>(), { size: 30 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" aria-hidden="true" class="brand-mark">
    <rect width="32" height="32" rx="9" fill="url(#lf-brand-grad)" />
    <path d="M17.6 5.5 9.8 17.4c-.32.5.06 1.15.66 1.15h4.42l-2.36 7.3c-.24.74.75 1.22 1.27.62l8.14-9.4c.4-.47.06-1.18-.6-1.18h-4.5l2.2-9.05c.16-.68-.67-1.1-1.13-.57z" fill="#fff" />
    <defs>
      <linearGradient id="lf-brand-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop stop-color="#4285f4" />
        <stop offset="1" stop-color="#0b57d0" />
      </linearGradient>
    </defs>
  </svg>
</template>
