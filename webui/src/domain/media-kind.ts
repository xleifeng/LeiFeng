export type PreviewKind = 'video' | 'audio' | 'image' | 'text' | 'download-only'

export function mediaKind(name: string): PreviewKind {
  const extension = String(name || '').toLowerCase().split('.').pop() || ''
  if (['mp4', 'webm', 'mkv', 'mov', 'm4v'].includes(extension)) return 'video'
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(extension)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension)) return 'image'
  if (['txt', 'log', 'json', 'srt', 'vtt'].includes(extension)) return 'text'
  return 'download-only'
}
