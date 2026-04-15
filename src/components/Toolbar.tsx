import { useCallback } from "react";
import type { FilterState, ContentType } from "../types/har";
import type { FilterSuggestionData } from "../utils/filterSuggestions";
import { FilterInput } from "./FilterInput";

interface ToolbarProps {
  fileName: string;
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
  onOpenFile: () => void;
  totalEntries: number;
  filteredEntries: number;
  suggestionData: FilterSuggestionData;
  ref?: React.Ref<HTMLInputElement>;
}

const CONTENT_TYPE_FILTERS: { label: string; value: ContentType | null }[] = [
  { label: "All", value: null },
  { label: "XHR", value: "xhr" },
  { label: "JS", value: "script" },
  { label: "CSS", value: "stylesheet" },
  { label: "Img", value: "image" },
  { label: "Font", value: "font" },
  { label: "Doc", value: "document" },
  { label: "Media", value: "media" },
  { label: "Other", value: "other" },
];

export function Toolbar({
  fileName,
  filter,
  onFilterChange,
  onOpenFile,
  totalEntries,
  filteredEntries,
  suggestionData,
  ref,
}: ToolbarProps) {
  const hasFilter =
    filter.search || filter.contentType || filter.method || filter.statusCode;

  const handleSearchChange = useCallback(
    (value: string) => {
      onFilterChange({ ...filter, search: value });
    },
    [filter, onFilterChange],
  );

  return (
    <div className="toolbar">
      <button
        className="toolbar-open-btn"
        onClick={onOpenFile}
        title="Open HAR file"
      >
        Open
      </button>
      <span className="toolbar-file-name" title={fileName}>
        {fileName}
      </span>
      <span className="toolbar-count">
        {hasFilter
          ? `${filteredEntries} / ${totalEntries} requests`
          : `${totalEntries} requests`}
      </span>
      <div className="toolbar-search">
        <span className="toolbar-search-icon">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
          </svg>
        </span>
        <FilterInput
          ref={ref}
          value={filter.search}
          onChange={handleSearchChange}
          suggestionData={suggestionData}
          placeholder="Filter (e.g. domain:example.com method:GET)"
        />
      </div>
      <div className="toolbar-filters">
        {CONTENT_TYPE_FILTERS.map(({ label, value }) => (
          <button
            key={label}
            className={`toolbar-filter-btn ${
              filter.contentType === value ? "active" : ""
            }`}
            onClick={() =>
              onFilterChange({
                ...filter,
                contentType: filter.contentType === value ? null : value,
              })
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
