import { useState, useEffect, useCallback } from 'react'
import type { Har, HarEntry, FilterState, SortState } from './types/har'
import { parseHar, getContentType, getEntryName, getTransferSize, computeSummary } from './utils/har'
import { Toolbar } from './components/Toolbar'
import { RequestTable } from './components/RequestTable'
import { DetailPanel } from './components/DetailPanel'
import { SummaryBar } from './components/SummaryBar'
import { WelcomeScreen } from './components/WelcomeScreen'
import './styles/app.css'

export type ThemeMode = 'system' | 'light' | 'dark'

function App() {
  const [har, setHar] = useState<Har | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [selectedEntry, setSelectedEntry] = useState<HarEntry | null>(null)
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterState>({
    search: '',
    method: null,
    statusCode: null,
    contentType: null,
  })
  const [sort, setSort] = useState<SortState>({
    field: 'waterfall',
    direction: 'asc',
  })
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('themeMode') as ThemeMode) || 'system'
  })

  // Apply theme mode on mount and when it changes
  useEffect(() => {
    localStorage.setItem('themeMode', themeMode)
    if (window.electronAPI) {
      window.electronAPI.setThemeMode(themeMode)
    }
  }, [themeMode])

  const loadHarContent = useCallback((content: string, name: string) => {
    try {
      const parsed = parseHar(content)
      setHar(parsed)
      setFileName(name)
      setSelectedEntry(null)
      setDetailPanelOpen(false)
      setError(null)
      setFilter({ search: '', method: null, statusCode: null, contentType: null })
    } catch (err) {
      setError(
        `Failed to parse HAR file: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }, [])

  // Listen for files opened from Electron (Finder double-click, menu open, etc.)
  useEffect(() => {
    if (!window.electronAPI) return
    const cleanup = window.electronAPI.onHarFileOpened((data) => {
      loadHarContent(data.content, data.fileName)
    })
    return cleanup
  }, [loadHarContent])

  // Handle file open dialog
  const handleOpenFile = useCallback(async () => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.openFileDialog()
    if (result) {
      loadHarContent(result.content, result.fileName)
    }
  }, [loadHarContent])

  // Handle drag and drop
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const files = e.dataTransfer.files
      if (files.length > 0) {
        const file = files[0]
        if (window.electronAPI) {
          // In Electron, read file via main process using the path
          const filePath = (file as any).path
          if (filePath) {
            const result = await window.electronAPI.readHarFile(filePath)
            if (result) {
              loadHarContent(result.content, result.fileName)
            }
          }
        } else {
          // Fallback: read file directly via FileReader (for dev in browser)
          const reader = new FileReader()
          reader.onload = (event) => {
            if (event.target?.result) {
              loadHarContent(event.target.result as string, file.name)
            }
          }
          reader.readAsText(file)
        }
      }
    },
    [loadHarContent]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // Select an entry and open the detail panel
  const handleSelectEntry = useCallback((entry: HarEntry) => {
    setSelectedEntry(entry)
    setDetailPanelOpen(true)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setDetailPanelOpen(false)
  }, [])

  // Filter and sort entries
  const filteredEntries = har
    ? har.log.entries.filter((entry) => {
        if (filter.search) {
          const searchLower = filter.search.toLowerCase()
          const urlMatch = entry.request.url
            .toLowerCase()
            .includes(searchLower)
          const nameMatch = getEntryName(entry)
            .toLowerCase()
            .includes(searchLower)
          if (!urlMatch && !nameMatch) return false
        }
        if (filter.method && entry.request.method !== filter.method)
          return false
        if (filter.statusCode) {
          const status = entry.response.status.toString()
          if (filter.statusCode.endsWith('xx')) {
            if (!status.startsWith(filter.statusCode[0])) return false
          } else {
            if (status !== filter.statusCode) return false
          }
        }
        if (filter.contentType && getContentType(entry) !== filter.contentType)
          return false
        return true
      })
    : []

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    const dir = sort.direction === 'asc' ? 1 : -1
    switch (sort.field) {
      case 'name':
        return dir * getEntryName(a).localeCompare(getEntryName(b))
      case 'method':
        return dir * a.request.method.localeCompare(b.request.method)
      case 'status':
        return dir * (a.response.status - b.response.status)
      case 'type':
        return dir * getContentType(a).localeCompare(getContentType(b))
      case 'size':
        return dir * (getTransferSize(a) - getTransferSize(b))
      case 'time':
        return dir * (a.time - b.time)
      case 'waterfall':
        return (
          dir *
          (new Date(a.startedDateTime).getTime() -
            new Date(b.startedDateTime).getTime())
        )
      default:
        return 0
    }
  })

  const summary = har ? computeSummary(har.log.entries) : null

  return (
    <div
      className="app"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="titlebar-drag-region" />
      {!har ? (
        <WelcomeScreen onOpenFile={handleOpenFile} error={error} />
      ) : (
        <div className="app-content">
          <Toolbar
            fileName={fileName}
            filter={filter}
            onFilterChange={setFilter}
            onOpenFile={handleOpenFile}
            totalEntries={har.log.entries.length}
            filteredEntries={sortedEntries.length}
          />
          <div className="app-main">
            <div className={`request-list-pane ${detailPanelOpen ? 'with-detail' : ''}`}>
              <RequestTable
                entries={sortedEntries}
                allEntries={har.log.entries}
                selectedEntry={selectedEntry}
                onSelectEntry={handleSelectEntry}
                sort={sort}
                onSortChange={setSort}
              />
            </div>
            {detailPanelOpen && selectedEntry && (
              <div className="detail-pane">
                <DetailPanel
                  entry={selectedEntry}
                  onClose={handleCloseDetail}
                />
              </div>
            )}
          </div>
          {summary && (
            <SummaryBar
              summary={summary}
              themeMode={themeMode}
              onThemeModeChange={setThemeMode}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default App
