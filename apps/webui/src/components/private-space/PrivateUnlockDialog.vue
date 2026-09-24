<script setup lang="ts">
import { ref } from 'vue'
import { usePrivateSpaceStore } from '../../stores/private-space'
const emit = defineEmits<{ unlocked: []; close: [] }>()
const store = usePrivateSpaceStore(); const password = ref('')
async function submit() { if (await store.unlock(password.value)) { password.value = ''; emit('unlocked') } }
</script>
<template><section class="private-action-panel"><h3>解锁私人空间</h3><p>解锁令牌只保存在当前浏览器会话，15 分钟无操作后自动失效。</p><label>密码<input v-model="password" type="password" autocomplete="current-password" @keyup.enter="submit" /></label><p v-if="store.error" class="settings-error">{{ store.error }}</p><div class="modal-actions"><button class="secondary-button" @click="$emit('close')">取消</button><button class="primary-button" :disabled="store.busy || !password" @click="submit">{{ store.busy ? '解锁中…' : '解锁' }}</button></div></section></template>
