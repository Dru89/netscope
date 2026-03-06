import { useMemo, useEffect, useRef } from 'react'
import type { HarEntry, SortState, SortField } from '../types/har'
import {
  getEntryName,
  getEntryDomain,
  getContentType,
  getTransferSize,
  formatBytes,
  formatTime,
  getStatusColor,
  getMethodColor,
  getContentTypeIcon,
  computeTimingOffsets,
} from '../utils/har'

interface RequestTableProps {
  entries: HarEntry[]
  allEntries: HarEntry[]
  selectedEntry: HarEntry | null
  onSelectEntry: (entry: HarEntry) => void
  sort: SortState
  onSortChange: (sort: SortState) => void
}

export function RequestTable({
  entries,
  allEntries,
  selectedEntry,
  onSelectEntry,
  sort,
  onSortChange,
}: RequestTableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevEntriesRef = useRef<HarEntry[]>(entries)

  // Scroll the selected entry into view only when the entries list changes
  // (e.g., when switching content-type filter tabs), not on selection change
  useEffect(() => {
    const entriesChanged = prevEntriesRef.current !== entries
    prevEntriesRef.current = entries

    if (!entriesChanged || !selectedEntry || !containerRef.current) return
    const selectedIndex = selectedEntry._index
    const isInList = entries.some((e) => e._index === selectedIndex)
    if (!isInList) return

    // Use requestAnimationFrame to ensure DOM has updated with new entries
    requestAnimationFrame(() => {
      const container = containerRef.current
      const row = container?.querySelector(
        `tr[data-entry-index="${selectedIndex}"]`
      ) as HTMLElement | null
      if (!row || !container) return

      // Calculate scroll position that centers the row in the container
      const rowTop = row.offsetTop
      const rowHeight = row.offsetHeight
      const containerHeight = container.clientHeight
      const targetScrollTop = rowTop - containerHeight / 2 + rowHeight / 2
      container.scrollTop = targetScrollTop
    })
  }, [entries, selectedEntry])

  // Compute waterfall boundaries
  const { minTime, maxTime } = useMemo(() => {
    if (allEntries.length === 0) return { minTime: 0, maxTime: 1 }
    let min = Infinity
    let max = -Infinity
    allEntries.forEach((entry) => {
      const start = new Date(entry.startedDateTime).getTime()
      const end = start + entry.time
      if (start < min) min = start
      if (end > max) max = end
    })
    return { minTime: min, maxTime: max }
  }, [allEntries])

  const totalDuration = maxTime - minTime || 1

  const handleSort = (field: SortField) => {
    if (sort.field === field) {
      onSortChange({
        field,
        direction: sort.direction === 'asc' ? 'desc' : 'asc',
      })
    } else {
      onSortChange({ field, direction: 'asc' })
    }
  }

  const renderSortArrow = (field: SortField) => {
    if (sort.field !== field) return null
    return (
      <span className="sort-arrow">
        {sort.direction === 'asc' ? '\u25B2' : '\u25BC'}
      </span>
    )
  }

  return (
    <div className="request-table-container" ref={containerRef}>
      <table className="request-table">
        <thead>
          <tr>
            <th
              className={`col-name ${sort.field === 'name' ? 'sorted' : ''}`}
              onClick={() => handleSort('name')}
            >
              Name {renderSortArrow('name')}
            </th>
            <th
              className={`col-method ${sort.field === 'method' ? 'sorted' : ''}`}
              onClick={() => handleSort('method')}
            >
              Method {renderSortArrow('method')}
            </th>
            <th
              className={`col-status ${sort.field === 'status' ? 'sorted' : ''}`}
              onClick={() => handleSort('status')}
            >
              Status {renderSortArrow('status')}
            </th>
            <th
              className={`col-type ${sort.field === 'type' ? 'sorted' : ''}`}
              onClick={() => handleSort('type')}
            >
              Type {renderSortArrow('type')}
            </th>
            <th
              className={`col-size ${sort.field === 'size' ? 'sorted' : ''}`}
              onClick={() => handleSort('size')}
            >
              Size {renderSortArrow('size')}
            </th>
            <th
              className={`col-time ${sort.field === 'time' ? 'sorted' : ''}`}
              onClick={() => handleSort('time')}
            >
              Time {renderSortArrow('time')}
            </th>
            <th
              className={`col-waterfall ${sort.field === 'waterfall' ? 'sorted' : ''}`}
              onClick={() => handleSort('waterfall')}
            >
              Waterfall {renderSortArrow('waterfall')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const name = getEntryName(entry)
            const domain = getEntryDomain(entry)
            const contentType = getContentType(entry)
            const transferSize = getTransferSize(entry)
            const isSelected = selectedEntry?._index === entry._index
            const isError =
              entry.response.status >= 400 || entry.response.status === 0
            const phases = computeTimingOffsets(entry)
            const startOffset =
              new Date(entry.startedDateTime).getTime() - minTime

            return (
              <tr
                key={entry._index ?? index}
                data-entry-index={entry._index}
                className={`row ${isSelected ? 'selected' : ''} ${isError ? 'error-row' : ''}`}
                onClick={() => onSelectEntry(entry)}
                title={entry.request.url}
              >
                <td className="col-name">
                  <div className="cell-name">
                    <span
                      className={`type-badge ${contentType}`}
                    >
                      {getContentTypeIcon(contentType)}
                    </span>
                    <span className="cell-name-text">
                      {name}
                      {domain && (
                        <span className="cell-name-domain"> - {domain}</span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="col-method">
                  <span
                    className="method-label"
                    style={{ color: getMethodColor(entry.request.method) }}
                  >
                    {entry.request.method}
                  </span>
                </td>
                <td className="col-status">
                  <span
                    className="status-code"
                    style={{
                      color: getStatusColor(entry.response.status),
                    }}
                  >
                    {entry.response.status || 'ERR'}
                  </span>
                </td>
                <td className="col-type">
                  <span className={`type-badge ${contentType}`}>
                    {contentType}
                  </span>
                </td>
                <td className="col-size">
                  <span className="size-cell">
                    {transferSize > 0 ? formatBytes(transferSize) : '-'}
                  </span>
                </td>
                <td className="col-time">
                  <span className="time-cell">{formatTime(entry.time)}</span>
                </td>
                <td className="col-waterfall">
                  <div className="waterfall-cell">
                    <div className="waterfall-bar-container">
                      {phases.map((phase, i) => {
                        const left =
                          ((startOffset + phase.start) / totalDuration) * 100
                        const width = (phase.duration / totalDuration) * 100
                        return (
                          <div
                            key={i}
                            className="waterfall-bar"
                            style={{
                              left: `${left}%`,
                              width: `${Math.max(width, 0.2)}%`,
                              background: phase.color,
                            }}
                            title={`${phase.name}: ${formatTime(phase.duration)}`}
                          />
                        )
                      })}
                    </div>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
