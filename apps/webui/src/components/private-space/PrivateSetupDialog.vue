<script setup lang="ts">
import { ref } from 'vue'
import { setupPrivateSpace } from '../../api/native-download/private-space'
import { usePrivateSpaceStore } from '../../stores/private-space'
const emit = defineEmits<{ setup: []; close: [] }>()
const store = usePrivateSpaceStore(); const password = ref(''); const confirm = ref(''); const directory = ref(''); const error = ref(''); const busy = ref(false)
async function submit() { if (!password.value || password.value !== confirm.value) { error.value = '两次密码不一致'; return } busy.value = true; error.value = ''; try { await setupPrivateSpace(password.value, directory.value || undefined); await store.refresh(); emit('setup') } catch (cause) { error.value = cause instanceof Error ? cause.message : '私人空间设置失败' } finally { busy.value = false } }
</script>
<template><section class="private-action-panel"><h3>设置私人空间</h3><p>私人空间只加密 daemon 本地资料元数据；下载文件内容仍取决于磁盘是否使用加密文件系统。</p><label>密码<input v-model="password" type="password" autocomplete="new-password" /></label><label>确认密码<input v-model="confirm" type="password" autocomplete="new-password" /></label><label>独立下载目录（可选）<input v-model="directory" placeholder="默认使用 downloads/.private" /></label><p v-if="error" class="settings-error">{{ error }}</p><div class="modal-actions"><button class="secondary-button" @click="$emit('close')">取消</button><button class="primary-button" :disabled="busy || !password || !confirm" @click="submit">{{ busy ? '保存中…' : '启用私人空间' }}</button></div></section></template>
