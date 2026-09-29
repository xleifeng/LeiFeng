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

// mdui 控件事件适配：value 统一为字符串读出
function controlValue(event: Event) { return String((event.target as HTMLInputElement).value) }
function onSliderInput(event: Event) { sliderValue.value = Number(controlValue(event)) }
function onDownloadInput(event: Event) { const value = Number(controlValue(event)); if (Number.isFinite(value)) downloadKbps.value = Math.max(1, value) }
function onUploadInput(event: Event) { const value = Number(controlValue(event)); if (Number.isFinite(value)) uploadKbps.value = Math.max(1, value) }

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
  <mdui-dialog open close-on-overlay-click close-on-esc role="dialog" aria-modal="true" aria-label="限速设置" class="limit-speed-dialog" @closed="backToSettings">
    <div slot="headline" class="modal-shell-headline">
      <span class="modal-shell-title">限速设置</span>
      <mdui-button-icon aria-label="关闭限速设置" @click="backToSettings"><X :size="16" :stroke-width="1.6" /></mdui-button-icon>
    </div>

    <label class="limit-enable-row"><mdui-checkbox :checked="downloadEnabled" @change="downloadEnabled = $event.target.checked"></mdui-checkbox>最大下载速度</label>
    <div class="limit-download-controls" :class="{ disabled: !downloadEnabled }">
      <mdui-slider class="limit-slider" :min="0" :max="100" :value="sliderValue" :disabled="!downloadEnabled" aria-label="最大下载速度滑块" @input="onSliderInput"></mdui-slider>
      <div class="limit-scale"><span style="left: 0">60KB</span><span style="left: 31.4%">500KB</span><span style="left: 42%">1MB</span><span style="left: 65.9%">5MB</span><span style="left: 100%">50MB</span></div>
      <label class="limit-number-field"><mdui-text-field type="number" variant="outlined" min="1" :disabled="!downloadEnabled" :value="String(downloadKbps)" @input="onDownloadInput"></mdui-text-field><span>KB/s</span></label>
    </div>

    <label class="limit-schedule-row"><mdui-checkbox :checked="scheduleVisible" @change="scheduleVisible = $event.target.checked"></mdui-checkbox>限速下载时间段</label>
    <div class="limit-schedule-controls" :class="{ disabled: !scheduleVisible }" :aria-disabled="!scheduleVisible">
      <div><span>开始限速时间</span><mdui-select variant="outlined" :disabled="!scheduleVisible" :value="String(startHour)" aria-label="开始限速小时" @change="startHour = Number(controlValue($event))"><mdui-menu-item v-for="hour in hours" :key="hour" :value="String(hour)">{{ hour }}</mdui-menu-item></mdui-select><i>时</i><mdui-select variant="outlined" :disabled="!scheduleVisible" :value="String(startMinute)" aria-label="开始限速分钟" @change="startMinute = Number(controlValue($event))"><mdui-menu-item v-for="minute in minutes" :key="minute" :value="String(minute)">{{ minute }}</mdui-menu-item></mdui-select><i>分</i></div>
      <div><span>结束限速时间</span><mdui-select variant="outlined" :disabled="!scheduleVisible" :value="String(endHour)" aria-label="结束限速小时" @change="endHour = Number(controlValue($event))"><mdui-menu-item v-for="hour in hours" :key="hour" :value="String(hour)">{{ hour }}</mdui-menu-item></mdui-select><i>时</i><mdui-select variant="outlined" :disabled="!scheduleVisible" :value="String(endMinute)" aria-label="结束限速分钟" @change="endMinute = Number(controlValue($event))"><mdui-menu-item v-for="minute in minutes" :key="minute" :value="String(minute)">{{ minute }}</mdui-menu-item></mdui-select><i>分</i></div>
    </div>

    <label class="limit-upload-row"><mdui-checkbox :checked="uploadEnabled" @change="uploadEnabled = $event.target.checked"></mdui-checkbox>最大上传速度</label>
    <div v-if="uploadEnabled" class="limit-upload-controls"><mdui-text-field type="number" variant="outlined" min="1" :value="String(uploadKbps)" @input="onUploadInput"></mdui-text-field><span>KB/s</span></div>

    <p v-if="errorMessage" class="subdialog-error">{{ errorMessage }}</p>
    <div slot="action" class="modal-shell-footer">
      <mdui-button variant="tonal" class="secondary-button" @click="backToSettings">取消</mdui-button>
      <mdui-button variant="filled" class="primary-button" :disabled="form.saving" @click="confirm">{{ form.saving ? '保存中…' : '确认' }}</mdui-button>
    </div>
  </mdui-dialog>
</template>
