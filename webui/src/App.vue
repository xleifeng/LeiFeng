<script setup lang="ts">
import AppShell from './app/AppShell.vue'
import GlobalOverlayHost from './components/GlobalOverlayHost.vue'
import AppErrorBoundary from './components/common/AppErrorBoundary.vue'
import ConnectionSecretDialog from './components/connection/ConnectionSecretDialog.vue'
</script>

<template>
  <AppErrorBoundary>
    <AppShell />
    <GlobalOverlayHost />
    <ConnectionSecretDialog />
  </AppErrorBoundary>
</template>
