import { describe, it, expect } from 'vitest'
import {
  extractSuggestionData,
  getCursorContext,
  getFilterSuggestions,
  applySuggestion,
} from './filterSuggestions'
import type { HarEntry } from '../types/har'
import type { FilterSuggestionData } from './filterSuggestions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: {
  url?: string
  method?: string
  status?: number
  mimeType?: string
  responseHeaders?: { name: string; value: string }[]
}): HarEntry {
  const url = overrides.url ?? 'https://example.com/api/data'
  let parsedUrl: URL | null = null
  try {
    parsedUrl = new URL(url)
  } catch {
    parsedUrl = null
  }
  return {
    startedDateTime: '2024-01-01T00:00:00.000Z',
    time: 100,
    request: {
      method: overrides.method ?? 'GET',
      url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      queryString: [],
      headersSize: 0,
      bodySize: 0,
    },
    response: {
      status: overrides.status ?? 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: overrides.responseHeaders ?? [],
      content: {
        size: 0,
        mimeType: overrides.mimeType ?? 'application/json',
      },
      redirectURL: '',
      headersSize: 0,
      bodySize: 0,
    },
    cache: {},
    timings: { send: 1, wait: 50, receive: 10 },
    _index: 0,
    _url: parsedUrl,
  }
}

const sampleData: FilterSuggestionData = {
  domains: ['api.example.com', 'cdn.example.com', 'example.com'],
  methods: ['GET', 'POST', 'PUT'],
  statusCodes: ['200', '301', '404', '500'],
  mimeTypes: ['application/json', 'text/html', 'text/css'],
  schemes: ['http', 'https'],
  responseHeaders: ['content-type', 'x-request-id', 'x-custom'],
}

// ===========================================================================
// extractSuggestionData
// ===========================================================================

describe('extractSuggestionData', () => {
  it('extracts unique domains, methods, status codes, etc.', () => {
    const entries = [
      makeEntry({
        url: 'https://api.example.com/users',
        method: 'GET',
        status: 200,
        mimeType: 'application/json',
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      }),
      makeEntry({
        url: 'https://cdn.example.com/style.css',
        method: 'GET',
        status: 200,
        mimeType: 'text/css',
        responseHeaders: [{ name: 'Content-Type', value: 'text/css' }],
      }),
      makeEntry({
        url: 'https://api.example.com/users',
        method: 'POST',
        status: 201,
        mimeType: 'application/json',
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'X-Request-Id', value: 'abc123' },
        ],
      }),
    ]

    const data = extractSuggestionData(entries)

    expect(data.domains).toEqual(['api.example.com', 'cdn.example.com'])
    expect(data.methods).toEqual(['GET', 'POST'])
    expect(data.statusCodes).toEqual(['200', '201'])
    expect(data.mimeTypes).toEqual(['application/json', 'text/css'])
    expect(data.schemes).toEqual(['https'])
    expect(data.responseHeaders).toContain('content-type')
    expect(data.responseHeaders).toContain('x-request-id')
  })

  it('returns empty arrays for empty entries', () => {
    const data = extractSuggestionData([])
    expect(data.domains).toEqual([])
    expect(data.methods).toEqual([])
  })

  it('strips MIME type parameters (charset, etc.)', () => {
    const entries = [
      makeEntry({ mimeType: 'application/json; charset=utf-8' }),
    ]
    const data = extractSuggestionData(entries)
    expect(data.mimeTypes).toEqual(['application/json'])
  })
})

// ===========================================================================
// getCursorContext
// ===========================================================================

describe('getCursorContext', () => {
  it('detects key context at the start of input', () => {
    const ctx = getCursorContext('dom', 3)
    expect(ctx.kind).toBe('key')
    expect(ctx.partial).toBe('dom')
    expect(ctx.tokenStart).toBe(0)
    expect(ctx.tokenEnd).toBe(3)
  })

  it('detects key context with empty input', () => {
    const ctx = getCursorContext('', 0)
    expect(ctx.kind).toBe('key')
    expect(ctx.partial).toBe('')
  })

  it('detects value context after a colon', () => {
    const ctx = getCursorContext('domain:exa', 10)
    expect(ctx.kind).toBe('value')
    expect(ctx.filterType).toBe('domain')
    expect(ctx.partial).toBe('exa')
  })

  it('detects value context right after colon with no value', () => {
    const ctx = getCursorContext('method:', 7)
    expect(ctx.kind).toBe('value')
    expect(ctx.filterType).toBe('method')
    expect(ctx.partial).toBe('')
  })

  it('handles cursor in the middle of a multi-token input', () => {
    //                         01234567890123456
    const input = 'method:GET domain:ex'
    const ctx = getCursorContext(input, 20)
    expect(ctx.kind).toBe('value')
    expect(ctx.filterType).toBe('domain')
    expect(ctx.partial).toBe('ex')
    expect(ctx.tokenStart).toBe(11)
  })

  it('detects key context for second token', () => {
    const input = 'method:GET dom'
    const ctx = getCursorContext(input, 14)
    expect(ctx.kind).toBe('key')
    expect(ctx.partial).toBe('dom')
    expect(ctx.tokenStart).toBe(11)
  })

  it('detects negation prefix', () => {
    const ctx = getCursorContext('-domain:ex', 10)
    expect(ctx.negated).toBe(true)
    expect(ctx.kind).toBe('value')
    expect(ctx.filterType).toBe('domain')
    expect(ctx.partial).toBe('ex')
  })

  it('handles quoted value partial', () => {
    const ctx = getCursorContext('domain:"my sit', 14)
    expect(ctx.kind).toBe('value')
    expect(ctx.partial).toBe('my sit')
  })
})

// ===========================================================================
// getFilterSuggestions
// ===========================================================================

describe('getFilterSuggestions', () => {
  it('suggests filter keys for empty input', () => {
    const suggestions = getFilterSuggestions('', 0, sampleData)
    expect(suggestions.length).toBe(8) // All filter types
    expect(suggestions[0].label).toBe('domain:')
    expect(suggestions[0].description).toBe('Request domain')
  })

  it('filters key suggestions by partial input', () => {
    const suggestions = getFilterSuggestions('me', 2, sampleData)
    expect(suggestions.length).toBe(1) // method:
    expect(suggestions[0].label).toBe('method:')
  })

  it('suggests values after typing a filter key with colon', () => {
    const suggestions = getFilterSuggestions('method:', 7, sampleData)
    expect(suggestions.map((s) => s.label)).toEqual(['GET', 'POST', 'PUT'])
  })

  it('filters value suggestions by partial input', () => {
    const suggestions = getFilterSuggestions('method:P', 8, sampleData)
    expect(suggestions.map((s) => s.label)).toEqual(['POST', 'PUT'])
  })

  it('suggests domains after domain:', () => {
    const suggestions = getFilterSuggestions('domain:', 7, sampleData)
    expect(suggestions.map((s) => s.label)).toEqual([
      'api.example.com',
      'cdn.example.com',
      'example.com',
    ])
  })

  it('filters domain suggestions by partial', () => {
    const suggestions = getFilterSuggestions('domain:cdn', 10, sampleData)
    expect(suggestions.map((s) => s.label)).toEqual(['cdn.example.com'])
  })

  it('returns no value suggestions for larger-than and url', () => {
    const suggestions = getFilterSuggestions('larger-than:', 12, sampleData)
    expect(suggestions).toEqual([])

    const suggestions2 = getFilterSuggestions('url:', 4, sampleData)
    expect(suggestions2).toEqual([])
  })

  it('suggests values in the context of a second token', () => {
    const input = 'method:GET domain:'
    const suggestions = getFilterSuggestions(input, input.length, sampleData)
    expect(suggestions.map((s) => s.label)).toEqual([
      'api.example.com',
      'cdn.example.com',
      'example.com',
    ])
  })

  it('preserves negation in insertText', () => {
    const suggestions = getFilterSuggestions('-domain:', 8, sampleData)
    expect(suggestions[0].insertText).toMatch(/^-domain:/)
  })

  it('returns no key suggestions when partial does not match', () => {
    const suggestions = getFilterSuggestions('xyz', 3, sampleData)
    expect(suggestions).toEqual([])
  })
})

// ===========================================================================
// applySuggestion
// ===========================================================================

describe('applySuggestion', () => {
  it('replaces the current token with the suggestion', () => {
    const result = applySuggestion('dom', {
      label: 'domain:',
      insertText: 'domain:',
      replaceStart: 0,
      replaceEnd: 3,
    })
    expect(result.newInput).toBe('domain:')
    expect(result.newCursor).toBe(7)
  })

  it('preserves other tokens', () => {
    const result = applySuggestion('method:GET dom', {
      label: 'domain:',
      insertText: 'domain:',
      replaceStart: 11,
      replaceEnd: 14,
    })
    expect(result.newInput).toBe('method:GET domain:')
    expect(result.newCursor).toBe(18)
  })

  it('handles value insertion', () => {
    const result = applySuggestion('method:P', {
      label: 'POST',
      insertText: 'method:POST',
      replaceStart: 0,
      replaceEnd: 8,
    })
    expect(result.newInput).toBe('method:POST')
    expect(result.newCursor).toBe(11)
  })
})
