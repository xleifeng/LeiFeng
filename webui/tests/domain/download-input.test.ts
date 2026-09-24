import { describe, expect, it } from 'vitest'
import { downloadInputKind, isDownloadInput, isTorrentHashInput } from '../../src/domain/download-input'

describe('download input recognition', () => {
  it('recognizes hexadecimal and Base32 torrent hashes', () => {
    expect(isTorrentHashInput('520d33dad5cc0f9e535cf376052a8fdce0319299')).toBe(true)
    expect(isTorrentHashInput('4H6BICTDSE2X7IOPBDO3OATU7HAF5OEL')).toBe(true)
    expect(isTorrentHashInput('Z'.repeat(40))).toBe(true)
    expect(isTorrentHashInput('urn:btih:520d33dad5cc0f9e535cf376052a8fdce0319299')).toBe(true)
    expect(isTorrentHashInput('520d33dad5cc0f9e535cf376052a8fdce03192')).toBe(false)
  })

  it('keeps ordinary search text out of the download shortcut', () => {
    expect(isDownloadInput('ubuntu 24.04')).toBe(false)
    expect(isDownloadInput('magnet:?xt=urn:btih:ABC')).toBe(true)
    expect(isDownloadInput('ftp://fixture.test/archive.zip')).toBe(true)
  })

  it('preserves the supported source protocol for the link library', () => {
    expect(downloadInputKind('https://fixture.test/file')).toBe('https')
    expect(downloadInputKind('ftp://fixture.test/file')).toBe('ftp')
    expect(downloadInputKind('ed2k://|file|fixture|1|hash|/')).toBe('ed2k')
    expect(downloadInputKind('thunder://fixture')).toBe('thunder')
    expect(downloadInputKind('not a link')).toBeNull()
  })
})
