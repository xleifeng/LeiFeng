// Mirrors Thunder's thunder_helper.node length/alphanumeric gate.  The
// authoritative validation still happens in the Wine native helper; keeping
// this broad on the UI ensures native-accepted codes reach the daemon.
const TORRENT_HASH_PATTERN = /^(?:(?:urn:)?btih:)?(?:[a-z0-9]{40}|[a-z0-9]{32})$/i

export function isTorrentHashInput(value: string) {
  return TORRENT_HASH_PATTERN.test(value.trim())
}

export function isDownloadInput(value: string) {
  return downloadInputKind(value) !== null
}

export function downloadInputKind(value: string): 'http' | 'https' | 'ftp' | 'magnet' | 'ed2k' | 'thunder' | null {
  const input = value.trim()
  if (isTorrentHashInput(input) || /^magnet:/i.test(input)) return 'magnet'
  if (/^https:\/\//i.test(input)) return 'https'
  if (/^http:\/\//i.test(input)) return 'http'
  if (/^ftp:\/\//i.test(input)) return 'ftp'
  if (/^ed2k:/i.test(input)) return 'ed2k'
  if (/^thunder:\/\//i.test(input)) return 'thunder'
  return null
}
