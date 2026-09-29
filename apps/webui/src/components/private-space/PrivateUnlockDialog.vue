<script setup lang="ts">
import { ref } from 'vue'
import { usePrivateSpaceStore } from '../../stores/private-space'
const emit = defineEmits<{ unlocked: []; close: [] }>()
const store = usePrivateSpaceStore(); const password = ref('')
async function submit() { if (await store.unlock(password.value)) { password.value = ''; emit('unlocked') } }
</script>
<template><section class="private-action-panel"><h3>解锁私人空间</h3><p>解锁令牌只保存在当前浏览器会话，15 分钟无操作后自动失效。</p><label>密码<mdui-text-field variant="outlined" type="password" :value="password" @input="password = ($event.target as HTMLInputElement).value" autocomplete="current-password" @keyup.enter="submit" ></mdui-text-field></label><p v-if="store.error" class="settings-error">{{ store.error }}</p><div class="modal-actions"><mdui-button variant="tonal" class="secondary-button" @click="$emit('close')">取消</mdui-button><mdui-button variant="filled" class="primary-button" :disabled="store.busy || !password" @click="submit">{{ store.busy ? '解锁中…' : '解锁' }}</mdui-button></div></section></template>
