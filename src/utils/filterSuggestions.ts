import type { HarEntry } from '../types/har'

/**
 * Precomputed unique values from HAR entries, used to populate
 * autocomplete suggestions. Compute once and pass around.
 */
export interface FilterSuggestionData {
  domains: string[]
  methods: string[]
  statusCodes: string[]
  mimeTypes: string[]
  schemes: string[]
  responseHeaders: string[]
}

/**
 * A filter type descriptor for autocomplete key suggestions.
 */
interface FilterTypeInfo {
  key: string
  description: string
  hasValues: boolean
}

const FILTER_TYPE_INFO: FilterTypeInfo[] = [
  { key: 'domain', description: 'Request domain', hasValues: true },
  { key: 'method', description: 'HTTP method', hasValues: true },
  { key: 'status-code', description: 'HTTP status code', hasValues: true },
  { key: 'mime-type', description: 'Response MIME type', hasValues: true },
  { key: 'larger-than', description: 'Min transfer size (e.g. 1k, 1M)', hasValues: false },
  { key: 'scheme', description: 'URL scheme', hasValues: true },
  { key: 'has-response-header', description: 'Response header name', hasValues: true },
  { key: 'url', description: 'URL substring', hasValues: false },
]

/**
 * A single autocomplete suggestion.
 */
export interface Suggestion {
  /** The text to display in the dropdown */
  label: string
  /** Optional secondary text (e.g., description for filter types) */
  description?: string
  /** The text to insert when this suggestion is accepted */
  insertText: string
  /** The start index in the input string where the replacement begins */
  replaceStart: number
  /** The end index in the input string where the replacement ends */
  replaceEnd: number
}

/**
 * Extract unique filter values from HAR entries for autocomplete suggestions.
 */
export function extractSuggestionData(entries: HarEntry[]): FilterSuggestionData {
  const domains = new Set<string>()
  const methods = new Set<string>()
  const statusCodes = new Set<string>()
  const mimeTypes = new Set<string>()
  const schemes = new Set<string>()
  const responseHeaders = new Set<string>()

  for (const entry of entries) {
    // Domain
    if (entry._url?.hostname) {
      domains.add(entry._url.hostname)
    }

    // Method
    methods.add(entry.request.method)

    // Status code
    if (entry.response.status > 0) {
      statusCodes.add(entry.response.status.toString())
    }

    // MIME type
    const mime = entry.response.content.mimeType
    if (mime) {
      mimeTypes.add(mime.split(';')[0].trim())
    }

    // Scheme
    if (entry._url?.protocol) {
      schemes.add(entry._url.protocol.replace(':', ''))
    }

    // Response headers
    for (const h of entry.response.headers) {
      responseHeaders.add(h.name.toLowerCase())
    }
  }

  return {
    domains: [...domains].sort(),
    methods: [...methods].sort(),
    statusCodes: [...statusCodes].sort(),
    mimeTypes: [...mimeTypes].sort(),
    schemes: [...schemes].sort(),
    responseHeaders: [...responseHeaders].sort(),
  }
}

/**
 * Identify the token at the cursor position and determine what kind of
 * suggestion to provide. Returns the token boundaries and context.
 */
export interface CursorContext {
  /** The kind of suggestion to show */
  kind: 'key' | 'value'
  /** For 'value' kind, which filter type the value is for */
  filterType?: string
  /** The partial text the user has typed for this token so far */
  partial: string
  /** Start index of the current token in the input string */
  tokenStart: number
  /** End index of the current token (usually the cursor position) */
  tokenEnd: number
  /** Whether this token has a negation prefix */
  negated: boolean
}

/**
 * Analyze the input string and cursor position to determine what the user
 * is currently typing and what suggestions to offer.
 */
export function getCursorContext(input: string, cursor: number): CursorContext {
  // Find the start of the current token by scanning backwards from cursor.
  // Tokens are separated by unquoted spaces. We need to be aware of quotes
  // because values like domain:"my site.com" contain spaces.
  let tokenStart = 0

  // Scan forward from the start to find which token the cursor is in.
  // This is more reliable than scanning backwards for quote tracking.
  let i = 0
  while (i < cursor) {
    // Skip whitespace — marks start of next token
    if (input[i] === ' ') {
      i++
      if (i <= cursor) tokenStart = i
      continue
    }

    // Skip past a full token
    const tokenEnd = findTokenEnd(input, i)
    if (cursor <= tokenEnd) {
      // Cursor is inside this token
      tokenStart = i
      break
    }
    i = tokenEnd
  }

  const tokenText = input.slice(tokenStart, cursor)

  // Check for negation prefix
  let negated = false
  let effective = tokenText
  if (effective.startsWith('-') && effective.length > 1) {
    negated = true
    effective = effective.slice(1)
  }

  // Check if there's a colon — this determines key vs. value context
  const colonIdx = effective.indexOf(':')
  if (colonIdx >= 0) {
    const key = effective.slice(0, colonIdx).toLowerCase()
    const valuePartial = effective.slice(colonIdx + 1)
    // Strip leading quote from partial if present
    const cleanPartial =
      valuePartial.startsWith('"') || valuePartial.startsWith("'")
        ? valuePartial.slice(1)
        : valuePartial
    return {
      kind: 'value',
      filterType: key,
      partial: cleanPartial,
      tokenStart,
      tokenEnd: cursor,
      negated,
    }
  }

  // No colon — user is typing a filter key (or plain text)
  return {
    kind: 'key',
    partial: effective,
    tokenStart,
    tokenEnd: cursor,
    negated,
  }
}

/**
 * Find the end index of a token starting at position `start`.
 * Handles quoted values — a quoted segment runs until the closing quote.
 */
function findTokenEnd(input: string, start: number): number {
  let i = start
  while (i < input.length) {
    const ch = input[i]
    if (ch === ' ') return i
    if (ch === '"' || ch === "'") {
      // Skip to closing quote
      const closeIdx = input.indexOf(ch, i + 1)
      if (closeIdx === -1) return input.length
      i = closeIdx + 1
      continue
    }
    i++
  }
  return i
}

/**
 * Get autocomplete suggestions for the current cursor position.
 */
export function getFilterSuggestions(
  input: string,
  cursor: number,
  data: FilterSuggestionData
): Suggestion[] {
  const ctx = getCursorContext(input, cursor)
  const prefix = ctx.negated ? '-' : ''

  if (ctx.kind === 'key') {
    // Suggest filter type keys that match the partial
    const partial = ctx.partial.toLowerCase()
    const suggestions: Suggestion[] = []

    for (const info of FILTER_TYPE_INFO) {
      if (partial.length === 0 || info.key.startsWith(partial)) {
        suggestions.push({
          label: `${info.key}:`,
          description: info.description,
          insertText: `${prefix}${info.key}:`,
          replaceStart: ctx.tokenStart,
          replaceEnd: ctx.tokenEnd,
        })
      }
    }

    return suggestions
  }

  // Value suggestions — depends on the filter type
  const partial = ctx.partial.toLowerCase()
  const values = getValuesForType(ctx.filterType ?? '', data)

  return values
    .filter((v) => v.toLowerCase().startsWith(partial))
    .slice(0, 20) // Cap at 20 suggestions
    .map((v) => {
      const needsQuote = v.includes(' ')
      const quotedValue = needsQuote ? `"${v}"` : v
      return {
        label: v,
        insertText: `${prefix}${ctx.filterType}:${quotedValue}`,
        replaceStart: ctx.tokenStart,
        replaceEnd: ctx.tokenEnd,
      }
    })
}

/**
 * Get the list of possible values for a given filter type.
 */
function getValuesForType(
  filterType: string,
  data: FilterSuggestionData
): string[] {
  switch (filterType) {
    case 'domain':
      return data.domains
    case 'method':
      return data.methods
    case 'status-code':
      return data.statusCodes
    case 'mime-type':
      return data.mimeTypes
    case 'scheme':
      return data.schemes
    case 'has-response-header':
      return data.responseHeaders
    default:
      return []
  }
}

/**
 * Apply a suggestion to the input string, returning the new input and
 * where the cursor should be placed.
 */
export function applySuggestion(
  input: string,
  suggestion: Suggestion
): { newInput: string; newCursor: number } {
  const before = input.slice(0, suggestion.replaceStart)
  const after = input.slice(suggestion.replaceEnd)
  const newInput = before + suggestion.insertText + after
  // Place cursor right after the inserted text
  const newCursor = before.length + suggestion.insertText.length
  return { newInput, newCursor }
}
