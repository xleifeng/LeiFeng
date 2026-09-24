<script setup lang="ts">
import { ref } from 'vue'
import { changePrivatePassword } from '../../api/native-download/private-space'

const emit = defineEmits<{ changed: []; close: [] }>()
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  if (!oldPassword.value) { error.value = '请输入当前密码'; return }
  if (newPassword.value.length < 6) { error.value = '新密码至少 6 个字符'; return }
  if (newPassword.value !== confirmPassword.value) { error.value = '两次输入的新密码不一致'; return }
  busy.value = true
  error.value = ''
  try {
    await changePrivatePassword(oldPassword.value, newPassword.value)
    emit('changed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '修改密码失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="change-password-grid">
    <h3>修改私人空间密码</h3>
    <label>当前密码<input v-model="oldPassword" type="password" autocomplete="current-password" /></label>
    <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" /></label>
    <label>确认新密码<input v-model="confirmPassword" type="password" autocomplete="new-password" @keyup.enter="submit" /></label>
    <p v-if="error" class="settings-error">{{ error }}</p>
    <div class="modal-actions"><button class="secondary-button" @click="emit('close')">取消</button><button class="primary-button" :disabled="busy" @click="submit">{{ busy ? '保存中…' : '确认修改' }}</button></div>
  </section>
</template>
