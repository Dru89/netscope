import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'
import type { FilterSuggestionData, Suggestion } from '../utils/filterSuggestions'
import { getFilterSuggestions, applySuggestion } from '../utils/filterSuggestions'

interface FilterInputProps {
  value: string
  onChange: (value: string) => void
  suggestionData: FilterSuggestionData
  placeholder?: string
}

/**
 * A text input with autocomplete dropdown for filter suggestions.
 * Exposes a ref to the underlying <input> element for external focus control.
 */
export const FilterInput = forwardRef<HTMLInputElement, FilterInputProps>(
  function FilterInput({ value, onChange, suggestionData, placeholder }, ref) {
    const inputRef = useRef<HTMLInputElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const [suggestions, setSuggestions] = useState<Suggestion[]>([])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [isOpen, setIsOpen] = useState(false)

    // Expose the input element to parent via ref
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

    const updateSuggestions = useCallback(() => {
      const input = inputRef.current
      if (!input) return
      const cursor = input.selectionStart ?? value.length
      const newSuggestions = getFilterSuggestions(value, cursor, suggestionData)
      setSuggestions(newSuggestions)
      setSelectedIndex(0)
      setIsOpen(newSuggestions.length > 0)
    }, [value, suggestionData])

    // Update suggestions when the value or suggestion data changes
    useEffect(() => {
      // Only update if the input is focused
      if (document.activeElement === inputRef.current) {
        updateSuggestions()
      }
    }, [value, suggestionData, updateSuggestions])

    const acceptSuggestion = useCallback(
      (suggestion: Suggestion) => {
        const { newInput, newCursor } = applySuggestion(value, suggestion)
        onChange(newInput)
        setIsOpen(false)
        // Restore cursor position after React re-renders
        requestAnimationFrame(() => {
          const input = inputRef.current
          if (input) {
            input.setSelectionRange(newCursor, newCursor)
            input.focus()
          }
        })
      },
      [value, onChange]
    )

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (!isOpen || suggestions.length === 0) return

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            setSelectedIndex((i) =>
              i < suggestions.length - 1 ? i + 1 : 0
            )
            break
          case 'ArrowUp':
            e.preventDefault()
            setSelectedIndex((i) =>
              i > 0 ? i - 1 : suggestions.length - 1
            )
            break
          case 'Enter':
          case 'Tab':
            e.preventDefault()
            acceptSuggestion(suggestions[selectedIndex])
            break
          case 'Escape':
            e.preventDefault()
            e.nativeEvent.stopImmediatePropagation() // Prevent global handler from also firing
            setIsOpen(false)
            break
        }
      },
      [isOpen, suggestions, selectedIndex, acceptSuggestion]
    )

    const handleFocus = useCallback(() => {
      updateSuggestions()
    }, [updateSuggestions])

    const handleBlur = useCallback((e: React.FocusEvent) => {
      // Delay close so click on dropdown item can fire first
      const related = e.relatedTarget as HTMLElement | null
      if (related && dropdownRef.current?.contains(related)) return
      setTimeout(() => setIsOpen(false), 150)
    }, [])

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value)
      },
      [onChange]
    )

    // Scroll the selected suggestion into view
    useEffect(() => {
      if (!isOpen || !dropdownRef.current) return
      const selected = dropdownRef.current.querySelector(
        '.filter-suggestion-item.selected'
      )
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex, isOpen])

    return (
      <>
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          autoComplete="off"
        />
        {isOpen && suggestions.length > 0 && (
          <div className="filter-suggestions-dropdown" ref={dropdownRef}>
            {suggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.label}-${index}`}
                className={`filter-suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault() // Prevent blur
                  acceptSuggestion(suggestion)
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="filter-suggestion-label">
                  {suggestion.label}
                </span>
                {suggestion.description && (
                  <span className="filter-suggestion-description">
                    {suggestion.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </>
    )
  }
)
