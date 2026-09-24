<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { getDownloadLimitWindow, setDownloadLimitWindow } from '../../api/native-download/schedules'
import { useDownloadPolicyFormStore } from '../../stores/download-policy-form'
import { useOverlayStore } from '../../stores/overlay'

const form = useDownloadPolicyFormStore()
const overlay = useOverlayStore()
const downloadEnabled = ref(false)
const uploadEnabled = ref(false)
const downloadKbps = ref(1024)
const uploadKbps = ref(1024)
const scheduleVisible = ref(false)
const startHour = ref(0)
const startMinute = ref(0)
const endHour = ref(23)
const endMinute = ref(59)
const errorMessage = ref('')
const hours = Array.from({ length: 24 }, (_, index) => index)
const minutes = Array.from({ length: 60 }, (_, index) => index)

const sliderValue = computed({
  get: () => Math.max(0, Math.min(100, Math.round((Math.log10(Math.max(60, downloadKbps.value)) - Math.log10(60)) / (Math.log10(51200) - Math.log10(60)) * 100))),
  set: (value: number) => { downloadKbps.value = Math.max(60, Math.round(60 * ((51200 / 60) ** (value / 100)))) },
})

function hydrate() {
  const policy = form.draft
  if (!policy) return
  downloadEnabled.value = policy.globalDownloadLimit !== null
  uploadEnabled.value = policy.globalUploadLimit !== null
  downloadKbps.value = Math.max(1, Math.round((policy.globalDownloadLimit ?? 1024 * 1024) / 1024))
  uploadKbps.value = Math.max(1, Math.round((policy.globalUploadLimit ?? 1024 * 1024) / 1024))
}

function splitTime(value: string, fallbackHour: number, fallbackMinute: number) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? [Number(match[1]), Number(match[2])] : [fallbackHour, fallbackMinute]
}
function localTime(hour: number, minute: number) { return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }

onMounted(async () => {
  if (!form.draft) await form.load()
  hydrate()
  try {
    const window = await getDownloadLimitWindow()
    scheduleVisible.value = window.enabled
    ;[startHour.value, startMinute.value] = splitTime(window.startLocalTime, 0, 0)
    ;[endHour.value, endMinute.value] = splitTime(window.endLocalTime, 23, 59)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '读取限速时间段失败'
  }
})
watch(() => form.draft, hydrate)

function backToSettings() { overlay.open({ type: 'settings' }) }
async function confirm() {
  if (!form.draft) return
  errorMessage.value = ''
  const startLocalTime = localTime(startHour.value, startMinute.value)
  const endLocalTime = localTime(endHour.value, endMinute.value)
  if (scheduleVisible.value && startLocalTime === endLocalTime) {
    errorMessage.value = '开始和结束时间不能相同'
    return
  }
  form.patch({
    globalDownloadLimit: downloadEnabled.value ? Math.max(0, Math.round(downloadKbps.value * 1024)) : null,
    globalUploadLimit: uploadEnabled.value ? Math.max(0, Math.round(uploadKbps.value * 1024)) : null,
  })
  try {
    await form.save()
    const window = await setDownloadLimitWindow({ enabled: scheduleVisible.value, startLocalTime, endLocalTime, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })
    if (window.runtime && !window.runtime.applied) throw new Error(`限速时间段已保存，但当前未能应用：${window.runtime.problem?.message || '下载引擎不可用'}`)
    backToSettings()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存限速设置失败'
  }
}
</script>

<template>
  <div class="subdialog-canvas">
    <section class="limit-speed-window" role="dialog" aria-modal="true" aria-label="限速设置">
      <h1>限速设置</h1>
      <button class="subdialog-close" aria-label="关闭限速设置" @click="backToSettings"><X :size="16" :stroke-width="1.6" /></button>

      <label class="limit-enable-row"><input v-model="downloadEnabled" type="checkbox" />最大下载速度</label>
      <div class="limit-download-controls" :class="{ disabled: !downloadEnabled }">
        <div class="limit-range-shell" :style="{ '--limit-progress': `${sliderValue}%` }"><input v-model.number="sliderValue" type="range" min="0" max="100" :disabled="!downloadEnabled" aria-label="最大下载速度滑块" /></div>
        <div class="limit-scale"><span>60KB</span><span>500KB</span><span>1MB</span><span>5MB</span><span>50MB</span></div>
        <label class="limit-number-field"><input v-model.number="downloadKbps" type="number" min="1" :disabled="!downloadEnabled" /><span>KB/s</span></label>
      </div>

      <label class="limit-schedule-row"><input v-model="scheduleVisible" type="checkbox" />限速下载时间段</label>
      <div class="limit-schedule-controls" :class="{ disabled: !scheduleVisible }" :aria-disabled="!scheduleVisible">
        <div><span>开始限速时间</span><select v-model.number="startHour" :disabled="!scheduleVisible" aria-label="开始限速小时"><option v-for="hour in hours" :key="hour" :value="hour">{{ hour }}</option></select><i>时</i><select v-model.number="startMinute" :disabled="!scheduleVisible" aria-label="开始限速分钟"><option v-for="minute in minutes" :key="minute" :value="minute">{{ minute }}</option></select><i>分</i></div>
        <div><span>结束限速时间</span><select v-model.number="endHour" :disabled="!scheduleVisible" aria-label="结束限速小时"><option v-for="hour in hours" :key="hour" :value="hour">{{ hour }}</option></select><i>时</i><select v-model.number="endMinute" :disabled="!scheduleVisible" aria-label="结束限速分钟"><option v-for="minute in minutes" :key="minute" :value="minute">{{ minute }}</option></select><i>分</i></div>
      </div>

      <label class="limit-upload-row"><input v-model="uploadEnabled" type="checkbox" />最大上传速度</label>
      <div v-if="uploadEnabled" class="limit-upload-controls"><input v-model.number="uploadKbps" type="number" min="1" /><span>KB/s</span></div>

      <p v-if="errorMessage" class="subdialog-error">{{ errorMessage }}</p>
      <footer class="subdialog-actions">
        <button @click="backToSettings">取消</button>
        <button class="confirm" :disabled="form.saving" @click="confirm">{{ form.saving ? '保存中…' : '确认' }}</button>
      </footer>
    </section>
  </div>
</template>
