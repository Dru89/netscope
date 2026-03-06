import type { Har, HarEntry, ContentType, SummaryStats } from '../types/har'

export function parseHar(content: string): Har {
  const parsed = JSON.parse(content)
  if (!parsed.log || !parsed.log.entries) {
    throw new Error('Invalid HAR file: missing log.entries')
  }
  // Add computed index to each entry
  parsed.log.entries.forEach((entry: HarEntry, i: number) => {
    entry._index = i
    try {
      entry._url = new URL(entry.request.url)
    } catch {
      entry._url = null
    }
  })
  return parsed as Har
}

export function getContentType(entry: HarEntry): ContentType {
  const mimeType = entry.response.content.mimeType?.toLowerCase() || ''
  const url = entry.request.url.toLowerCase()

  if (mimeType.includes('html')) return 'document'
  if (mimeType.includes('css')) return 'stylesheet'
  if (mimeType.includes('javascript') || mimeType.includes('ecmascript'))
    return 'script'
  if (mimeType.includes('image') || mimeType.includes('svg')) return 'image'
  if (
    mimeType.includes('font') ||
    mimeType.includes('woff') ||
    mimeType.includes('ttf') ||
    mimeType.includes('otf')
  )
    return 'font'
  if (mimeType.includes('json') || mimeType.includes('xml')) return 'xhr'
  if (mimeType.includes('video') || mimeType.includes('audio')) return 'media'
  if (mimeType.includes('manifest')) return 'manifest'
  if (url.includes('.woff') || url.includes('.ttf') || url.includes('.otf'))
    return 'font'
  if (
    url.includes('.png') ||
    url.includes('.jpg') ||
    url.includes('.gif') ||
    url.includes('.svg') ||
    url.includes('.ico') ||
    url.includes('.webp')
  )
    return 'image'

  return 'other'
}

export function getEntryName(entry: HarEntry): string {
  if (entry._url) {
    const pathname = entry._url.pathname
    const parts = pathname.split('/')
    return parts[parts.length - 1] || entry._url.hostname + pathname
  }
  return entry.request.url
}

export function getEntryDomain(entry: HarEntry): string {
  if (entry._url) {
    return entry._url.hostname
  }
  return ''
}

export function getTransferSize(entry: HarEntry): number {
  // bodySize is the transfer size (compressed)
  const headersSize = Math.max(entry.response.headersSize, 0)
  const bodySize = Math.max(entry.response.bodySize, 0)
  return headersSize + bodySize
}

export function getResourceSize(entry: HarEntry): number {
  return entry.response.content.size || 0
}

export function isFromCache(entry: HarEntry): boolean {
  // Chrome records _transferSize: 0 when the response was served from disk cache
  if (
    entry.response._transferSize === 0 &&
    entry.response.status > 0 &&
    (entry.response.content.size > 0 || entry.response.bodySize === 0)
  ) {
    return true
  }
  // Also check if bodySize is 0 or negative with content present (common in
  // HAR files from various sources)
  if (
    entry.response.bodySize <= 0 &&
    entry.response.headersSize <= 0 &&
    entry.response.status === 304
  ) {
    return true
  }
  return false
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 0) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function formatTime(ms: number): string {
  if (ms < 0) return '-'
  if (ms < 1) return '< 1 ms'
  if (ms < 1000) return Math.round(ms) + ' ms'
  if (ms < 60000) return (ms / 1000).toFixed(2) + ' s'
  return (ms / 60000).toFixed(1) + ' min'
}

export function formatTimestamp(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    } as Intl.DateTimeFormatOptions)
  } catch {
    return dateString
  }
}

export function getStatusColor(status: number): string {
  if (status === 0) return 'var(--color-status-error)'
  if (status < 300) return 'var(--color-status-success)'
  if (status < 400) return 'var(--color-status-redirect)'
  if (status < 500) return 'var(--color-status-client-error)'
  return 'var(--color-status-server-error)'
}

export function getMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'var(--color-method-get)'
    case 'POST':
      return 'var(--color-method-post)'
    case 'PUT':
      return 'var(--color-method-put)'
    case 'DELETE':
      return 'var(--color-method-delete)'
    case 'PATCH':
      return 'var(--color-method-patch)'
    default:
      return 'var(--color-text-secondary)'
  }
}

export function computeTimingOffsets(entry: HarEntry) {
  const timings = entry.timings
  const phases: { name: string; start: number; duration: number; color: string }[] = []
  let offset = 0

  if (timings.blocked && timings.blocked > 0) {
    const queueing = timings._blocked_queueing
    if (queueing != null && queueing > 0) {
      // Chrome-specific: split into Queueing + Stalled
      phases.push({
        name: 'Queueing',
        start: offset,
        duration: queueing,
        color: 'var(--color-timing-queueing)',
      })
      offset += queueing
      const stalled = timings.blocked - queueing
      if (stalled > 0) {
        phases.push({
          name: 'Stalled',
          start: offset,
          duration: stalled,
          color: 'var(--color-timing-blocked)',
        })
        offset += stalled
      }
    } else {
      phases.push({
        name: 'Blocked',
        start: offset,
        duration: timings.blocked,
        color: 'var(--color-timing-blocked)',
      })
      offset += timings.blocked
    }
  }

  if (timings.dns && timings.dns > 0) {
    phases.push({
      name: 'DNS',
      start: offset,
      duration: timings.dns,
      color: 'var(--color-timing-dns)',
    })
    offset += timings.dns
  }

  if (timings.connect && timings.connect > 0) {
    // SSL is a subset of connect
    if (timings.ssl && timings.ssl > 0) {
      const tcpOnly = timings.connect - timings.ssl
      if (tcpOnly > 0) {
        phases.push({
          name: 'Connect',
          start: offset,
          duration: tcpOnly,
          color: 'var(--color-timing-connect)',
        })
        offset += tcpOnly
      }
      phases.push({
        name: 'TLS',
        start: offset,
        duration: timings.ssl,
        color: 'var(--color-timing-ssl)',
      })
      offset += timings.ssl
    } else {
      phases.push({
        name: 'Connect',
        start: offset,
        duration: timings.connect,
        color: 'var(--color-timing-connect)',
      })
      offset += timings.connect
    }
  }

  if (timings.send > 0) {
    phases.push({
      name: 'Send',
      start: offset,
      duration: timings.send,
      color: 'var(--color-timing-send)',
    })
    offset += timings.send
  }

  if (timings.wait > 0) {
    phases.push({
      name: 'Wait (TTFB)',
      start: offset,
      duration: timings.wait,
      color: 'var(--color-timing-wait)',
    })
    offset += timings.wait
  }

  if (timings.receive > 0) {
    phases.push({
      name: 'Receive',
      start: offset,
      duration: timings.receive,
      color: 'var(--color-timing-receive)',
    })
    offset += timings.receive
  }

  return phases
}

export function computeSummary(entries: HarEntry[]): SummaryStats {
  const requestsByType: Record<string, number> = {}
  const requestsByStatus: Record<string, number> = {}
  let totalTransferSize = 0
  let totalUncompressedSize = 0

  let minStart = Infinity
  let maxEnd = -Infinity

  entries.forEach((entry) => {
    const type = getContentType(entry)
    requestsByType[type] = (requestsByType[type] || 0) + 1

    const statusBucket = entry.response.status === 0 ? 'error' : `${Math.floor(entry.response.status / 100)}xx`
    requestsByStatus[statusBucket] = (requestsByStatus[statusBucket] || 0) + 1

    totalTransferSize += getTransferSize(entry)
    totalUncompressedSize += getResourceSize(entry)

    const startTime = new Date(entry.startedDateTime).getTime()
    const endTime = startTime + entry.time
    if (startTime < minStart) minStart = startTime
    if (endTime > maxEnd) maxEnd = endTime
  })

  return {
    totalRequests: entries.length,
    totalTransferSize,
    totalUncompressedSize,
    totalTime: maxEnd > minStart ? maxEnd - minStart : 0,
    requestsByType,
    requestsByStatus,
  }
}

export function getContentTypeIcon(type: ContentType): string {
  switch (type) {
    case 'document':
      return 'doc'
    case 'stylesheet':
      return 'css'
    case 'script':
      return 'js'
    case 'image':
      return 'img'
    case 'font':
      return 'font'
    case 'xhr':
      return 'xhr'
    case 'fetch':
      return 'fetch'
    case 'media':
      return 'media'
    case 'websocket':
      return 'ws'
    case 'manifest':
      return 'manifest'
    default:
      return 'other'
  }
}

export function prettyPrintJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function detectLanguage(
  mimeType: string
): 'json' | 'html' | 'css' | 'javascript' | 'xml' | 'text' {
  const mime = mimeType.toLowerCase()
  if (mime.includes('json')) return 'json'
  if (mime.includes('html')) return 'html'
  if (mime.includes('css')) return 'css'
  if (mime.includes('javascript') || mime.includes('ecmascript'))
    return 'javascript'
  if (mime.includes('xml') || mime.includes('svg')) return 'xml'
  return 'text'
}
