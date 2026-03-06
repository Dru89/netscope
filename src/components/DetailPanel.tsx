import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import type { HarEntry } from '../types/har'
import {
  formatBytes,
  formatTime,
  formatTimestamp,
  getStatusColor,
  getMethodColor,
  getContentType,
  getTransferSize,
  getResourceSize,
  computeTimingOffsets,
  prettyPrintJson,
  detectLanguage,
  isFromCache,
} from '../utils/har'

interface DetailPanelProps {
  entry: HarEntry
  onClose: () => void
}

type DetailTab = 'headers' | 'payload' | 'response' | 'timing' | 'cookies' | 'source'

export function DetailPanel({ entry, onClose }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('headers')

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'headers', label: 'Headers' },
    { id: 'payload', label: 'Payload' },
    { id: 'response', label: 'Response' },
    { id: 'timing', label: 'Timing' },
    { id: 'cookies', label: 'Cookies' },
    { id: 'source', label: 'Source' },
  ]

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="detail-header-info">
          <span
            className="method-label"
            style={{ color: getMethodColor(entry.request.method) }}
          >
            {entry.request.method}
          </span>
          <span
            className="status-code"
            style={{ color: getStatusColor(entry.response.status) }}
          >
            {entry.response.status} {entry.response.statusText}
            {isFromCache(entry) && (
              <span className="cache-indicator"> (from disk cache)</span>
            )}
          </span>
          <span className="detail-url" title={entry.request.url}>
            {entry.request.url}
          </span>
        </div>
        <button className="detail-close-btn" onClick={onClose} title="Close">
          &times;
        </button>
      </div>

      <div className="detail-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`detail-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={`detail-content ${activeTab === 'source' ? 'detail-content-source' : ''}`}>
        {activeTab === 'headers' && <HeadersTab entry={entry} />}
        {activeTab === 'payload' && <PayloadTab entry={entry} />}
        {activeTab === 'response' && <ResponseTab entry={entry} />}
        {activeTab === 'timing' && <TimingTab entry={entry} />}
        {activeTab === 'cookies' && <CookiesTab entry={entry} />}
        {activeTab === 'source' && <SourceTab entry={entry} />}
      </div>
    </div>
  )
}

function HeadersTab({ entry }: { entry: HarEntry }) {
  return (
    <div>
      {/* General info */}
      <div className="detail-section">
        <div className="detail-section-title">General</div>
        <table className="detail-table">
          <tbody>
            <tr>
              <td>Request URL</td>
              <td>{entry.request.url}</td>
            </tr>
            <tr>
              <td>Request Method</td>
              <td>{entry.request.method}</td>
            </tr>
            <tr>
              <td>Status Code</td>
              <td>
                <span style={{ color: getStatusColor(entry.response.status) }}>
                  {entry.response.status} {entry.response.statusText}
                </span>
                {isFromCache(entry) && (
                  <span className="cache-indicator"> (from disk cache)</span>
                )}
              </td>
            </tr>
            <tr>
              <td>HTTP Version</td>
              <td>{entry.request.httpVersion}</td>
            </tr>
            {entry.serverIPAddress && (
              <tr>
                <td>Remote Address</td>
                <td>{entry.serverIPAddress}</td>
              </tr>
            )}
            <tr>
              <td>Started</td>
              <td>{formatTimestamp(entry.startedDateTime)}</td>
            </tr>
            <tr>
              <td>Duration</td>
              <td>{formatTime(entry.time)}</td>
            </tr>
            <tr>
              <td>Content Type</td>
              <td>{getContentType(entry)}</td>
            </tr>
            <tr>
              <td>Transfer Size</td>
              <td>{formatBytes(getTransferSize(entry))}</td>
            </tr>
            <tr>
              <td>Resource Size</td>
              <td>{formatBytes(getResourceSize(entry))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Response Headers */}
      {entry.response.headers.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">
            Response Headers ({entry.response.headers.length})
          </div>
          <table className="detail-table">
            <tbody>
              {entry.response.headers.map((header, i) => (
                <tr key={i}>
                  <td>{header.name}</td>
                  <td>{header.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Request Headers */}
      {entry.request.headers.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">
            Request Headers ({entry.request.headers.length})
          </div>
          <table className="detail-table">
            <tbody>
              {entry.request.headers.map((header, i) => (
                <tr key={i}>
                  <td>{header.name}</td>
                  <td>{header.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PayloadTab({ entry }: { entry: HarEntry }) {
  const queryParams = entry.request.queryString
  const postData = entry.request.postData

  return (
    <div>
      {queryParams.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">
            Query String Parameters ({queryParams.length})
          </div>
          <table className="detail-table">
            <tbody>
              {queryParams.map((param, i) => (
                <tr key={i}>
                  <td>{param.name}</td>
                  <td>{param.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {postData && (
        <div className="detail-section">
          <div className="detail-section-title">Request Body</div>
          {postData.mimeType && (
            <p
              style={{
                fontSize: 11,
                color: 'var(--color-text-tertiary)',
                marginBottom: 8,
              }}
            >
              Content-Type: {postData.mimeType}
            </p>
          )}
          {postData.params && postData.params.length > 0 ? (
            <table className="detail-table">
              <tbody>
                {postData.params.map((param, i) => (
                  <tr key={i}>
                    <td>{param.name}</td>
                    <td>{param.value || param.fileName || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : postData.text ? (
            <div className="code-preview">
              {postData.mimeType?.includes('json')
                ? prettyPrintJson(postData.text)
                : postData.text}
            </div>
          ) : (
            <div className="no-content">No request body</div>
          )}
        </div>
      )}

      {!postData && queryParams.length === 0 && (
        <div className="no-content">No payload data for this request</div>
      )}
    </div>
  )
}

function ResponseTab({ entry }: { entry: HarEntry }) {
  const content = entry.response.content
  const mimeType = content.mimeType || ''
  const text = content.text || ''
  const language = detectLanguage(mimeType)

  // Check if it's an image
  if (mimeType.startsWith('image/')) {
    if (content.encoding === 'base64' && text) {
      return (
        <div className="detail-section">
          <div className="detail-section-title">Response Body</div>
          <img
            className="image-preview"
            src={`data:${mimeType};base64,${text}`}
            alt="Response"
          />
        </div>
      )
    }
    return (
      <div className="detail-section">
        <div className="detail-section-title">Response Body</div>
        <div className="no-content">
          Image response ({formatBytes(content.size)})
        </div>
      </div>
    )
  }

  if (!text) {
    return (
      <div className="detail-section">
        <div className="detail-section-title">Response Body</div>
        <div className="no-content">
          {content.size > 0
            ? `Response body not captured (${formatBytes(content.size)})`
            : 'No response body'}
        </div>
      </div>
    )
  }

  const displayText = language === 'json' ? prettyPrintJson(text) : text

  return (
    <div className="detail-section">
      <div className="detail-section-title">
        Response Body ({formatBytes(content.size)})
      </div>
      <div className="code-preview">{displayText}</div>
    </div>
  )
}

function TimingTab({ entry }: { entry: HarEntry }) {
  const phases = computeTimingOffsets(entry)
  const totalTime = entry.time

  return (
    <div>
      <div className="detail-section">
        <div className="detail-section-title">Request Timing</div>
        <div className="timing-breakdown">
          {phases.map((phase, i) => (
            <div className="timing-row" key={i}>
              <div
                className="timing-color"
                style={{ background: phase.color }}
              />
              <span className="timing-label">{phase.name}</span>
              <div className="timing-bar-bg">
                <div
                  className="timing-bar-fill"
                  style={{
                    width: `${totalTime > 0 ? (phase.duration / totalTime) * 100 : 0}%`,
                    background: phase.color,
                  }}
                />
              </div>
              <span className="timing-value">
                {formatTime(phase.duration)}
              </span>
            </div>
          ))}
          <div className="timing-total">
            <span>Total</span>
            <span className="mono">{formatTime(totalTime)}</span>
          </div>
        </div>
      </div>

      {/* Raw timing data */}
      <div className="detail-section">
        <div className="detail-section-title">Raw Timing Data</div>
        <table className="detail-table">
          <tbody>
            {Object.entries(entry.timings).map(([key, value]) => {
              if (key === 'comment') return null
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>
                    {typeof value === 'number' && value >= 0
                      ? formatTime(value)
                      : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CookiesTab({ entry }: { entry: HarEntry }) {
  const requestCookies = entry.request.cookies
  const responseCookies = entry.response.cookies

  if (requestCookies.length === 0 && responseCookies.length === 0) {
    return <div className="no-content">No cookies for this request</div>
  }

  return (
    <div>
      {requestCookies.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">
            Request Cookies ({requestCookies.length})
          </div>
          <table className="detail-table">
            <tbody>
              {requestCookies.map((cookie, i) => (
                <tr key={i}>
                  <td>{cookie.name}</td>
                  <td>{cookie.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {responseCookies.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">
            Response Cookies ({responseCookies.length})
          </div>
          <table className="detail-table">
            <tbody>
              {responseCookies.map((cookie, i) => (
                <tr key={i}>
                  <td>{cookie.name}</td>
                  <td>
                    {cookie.value}
                    {cookie.domain && (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        {' '}
                        (Domain: {cookie.domain})
                      </span>
                    )}
                    {cookie.path && (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        {' '}
                        (Path: {cookie.path})
                      </span>
                    )}
                    {cookie.httpOnly && (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        {' '}
                        HttpOnly
                      </span>
                    )}
                    {cookie.secure && (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        {' '}
                        Secure
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SourceTab({ entry }: { entry: HarEntry }) {
  // Strip internal computed fields to show clean HAR JSON
  const source = useMemo(() => {
    const { _index, _url, ...clean } = entry
    return JSON.stringify(clean, null, 2)
  }, [entry])

  const [searchQuery, setSearchQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const contentRef = useRef<HTMLPreElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchVisible, setSearchVisible] = useState(false)

  const findMatches = useCallback(
    (query: string) => {
      if (!query) return []
      const matches: number[] = []
      const lower = source.toLowerCase()
      const q = query.toLowerCase()
      let pos = 0
      while (pos < lower.length) {
        const idx = lower.indexOf(q, pos)
        if (idx === -1) break
        matches.push(idx)
        pos = idx + 1
      }
      return matches
    },
    [source]
  )

  // Build highlighted content with matches wrapped in <mark> elements
  const highlightedContent = useMemo(() => {
    if (!searchQuery) return source
    const matches = findMatches(searchQuery)
    if (matches.length === 0) return source

    const parts: string[] = []
    let lastEnd = 0
    matches.forEach((matchPos, i) => {
      // Escape HTML in the text between matches
      parts.push(escapeHtml(source.substring(lastEnd, matchPos)))
      const matchText = source.substring(matchPos, matchPos + searchQuery.length)
      const cls = i === matchIndex ? 'source-match active' : 'source-match'
      parts.push(`<mark class="${cls}">${escapeHtml(matchText)}</mark>`)
      lastEnd = matchPos + searchQuery.length
    })
    parts.push(escapeHtml(source.substring(lastEnd)))
    return parts.join('')
  }, [source, searchQuery, matchIndex, findMatches])

  const scrollToCurrentMatch = useCallback(() => {
    if (!contentRef.current) return
    const activeMatch = contentRef.current.querySelector('mark.active')
    if (activeMatch) {
      activeMatch.scrollIntoView({ block: 'center' })
    }
  }, [])

  // Scroll to active match when it changes
  useEffect(() => {
    if (searchQuery && matchCount > 0) {
      // Wait for DOM to update with new highlights
      requestAnimationFrame(scrollToCurrentMatch)
    }
  }, [matchIndex, highlightedContent, scrollToCurrentMatch, searchQuery, matchCount])

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query)
      const matches = findMatches(query)
      setMatchCount(matches.length)
      setMatchIndex(0)
    },
    [findMatches]
  )

  const handleNextMatch = useCallback(() => {
    if (matchCount === 0) return
    setMatchIndex((prev) => (prev + 1) % matchCount)
  }, [matchCount])

  const handlePrevMatch = useCallback(() => {
    if (matchCount === 0) return
    setMatchIndex((prev) => (prev - 1 + matchCount) % matchCount)
  }, [matchCount])

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          handlePrevMatch()
        } else {
          handleNextMatch()
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault()
        if (e.shiftKey) {
          handlePrevMatch()
        } else {
          handleNextMatch()
        }
      }
      if (e.key === 'Escape') {
        setSearchVisible(false)
      }
    },
    [handleNextMatch, handlePrevMatch]
  )

  // Handle Cmd+F / Cmd+G on the source content
  const handleContentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchVisible(true)
        requestAnimationFrame(() => {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        })
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'g' && searchVisible) {
        e.preventDefault()
        if (e.shiftKey) {
          handlePrevMatch()
        } else {
          handleNextMatch()
        }
      }
    },
    [searchVisible, handleNextMatch, handlePrevMatch]
  )

  // Focus search input when it becomes visible
  useEffect(() => {
    if (searchVisible) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus()
      })
    }
  }, [searchVisible])

  // Auto-focus content when Source tab mounts so Cmd+F works immediately
  useEffect(() => {
    requestAnimationFrame(() => {
      contentRef.current?.focus()
    })
  }, [])

  const handleCopy = () => {
    navigator.clipboard.writeText(source)
  }

  return (
    <div className="source-tab">
      <div className="detail-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>HAR Entry Source</span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            className="source-copy-btn"
            onClick={() => {
              setSearchVisible(!searchVisible)
              if (!searchVisible) {
                requestAnimationFrame(() => {
                  searchInputRef.current?.focus()
                })
              }
            }}
            title="Search (Cmd+F)"
          >
            Search
          </button>
          <button className="source-copy-btn" onClick={handleCopy}>
            Copy
          </button>
        </div>
      </div>
      {searchVisible && (
        <div className="source-search-bar">
          <input
            ref={searchInputRef}
            type="text"
            className="source-search-input"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {searchQuery && (
            <span className="source-search-count">
              {matchCount > 0
                ? `${matchIndex + 1} of ${matchCount}`
                : 'No results'}
            </span>
          )}
          <button
            className="source-search-nav-btn"
            onClick={handlePrevMatch}
            disabled={matchCount === 0}
            title="Previous match (Shift+Enter)"
          >
            &#x25B2;
          </button>
          <button
            className="source-search-nav-btn"
            onClick={handleNextMatch}
            disabled={matchCount === 0}
            title="Next match (Enter)"
          >
            &#x25BC;
          </button>
          <button
            className="source-search-nav-btn"
            onClick={() => setSearchVisible(false)}
            title="Close search"
          >
            &times;
          </button>
        </div>
      )}
      <pre
        ref={contentRef}
        className="source-content"
        tabIndex={0}
        onKeyDown={handleContentKeyDown}
        dangerouslySetInnerHTML={{ __html: highlightedContent }}
      />
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
