import type { SummaryStats } from '../types/har'
import type { ThemeMode } from '../App'
import { formatBytes, formatTime } from '../utils/har'

interface SummaryBarProps {
  summary: SummaryStats
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

export function SummaryBar({ summary, themeMode, onThemeModeChange }: SummaryBarProps) {
  return (
    <div className="summary-bar">
      <div className="summary-item">
        <span className="summary-value">{summary.totalRequests}</span>
        <span>requests</span>
      </div>
      <div className="summary-separator" />
      <div className="summary-item">
        <span className="summary-value">
          {formatBytes(summary.totalTransferSize)}
        </span>
        <span>transferred</span>
      </div>
      <div className="summary-separator" />
      <div className="summary-item">
        <span className="summary-value">
          {formatBytes(summary.totalUncompressedSize)}
        </span>
        <span>resources</span>
      </div>
      <div className="summary-separator" />
      <div className="summary-item">
        <span className="summary-value">
          {formatTime(summary.totalTime)}
        </span>
        <span>total</span>
      </div>
      <div className="summary-separator" />
      {Object.entries(summary.requestsByType)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([type, count]) => (
          <div className="summary-item" key={type}>
            <span className="summary-value">{count}</span>
            <span>{type}</span>
          </div>
        ))}
      <div className="summary-theme-toggle">
        {THEME_OPTIONS.map(({ label, value }) => (
          <button
            key={value}
            className={`summary-theme-btn ${themeMode === value ? 'active' : ''}`}
            onClick={() => onThemeModeChange(value)}
            title={`${label} theme`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
