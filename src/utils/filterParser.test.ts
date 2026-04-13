import { describe, it, expect } from 'vitest'
import type { HarEntry } from '../types/har'
import {
  parseFilterQuery,
  parseSize,
  matchDomain,
  matchToken,
  matchEntry,
} from './filterParser'

// ---------------------------------------------------------------------------
// Helpers to build minimal HarEntry objects for testing
// ---------------------------------------------------------------------------

function makeEntry(overrides: {
  url?: string
  method?: string
  status?: number
  mimeType?: string
  headersSize?: number
  bodySize?: number
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
      headersSize: overrides.headersSize ?? 100,
      bodySize: overrides.bodySize ?? 5000,
    },
    cache: {},
    timings: { send: 1, wait: 50, receive: 10 },
    _index: 0,
    _url: parsedUrl,
  }
}

// ===========================================================================
// parseFilterQuery
// ===========================================================================

describe('parseFilterQuery', () => {
  it('parses plain text tokens', () => {
    const tokens = parseFilterQuery('api')
    expect(tokens).toEqual([{ type: 'text', value: 'api', negated: false }])
  })

  it('parses multiple plain text tokens', () => {
    const tokens = parseFilterQuery('api data')
    expect(tokens).toEqual([
      { type: 'text', value: 'api', negated: false },
      { type: 'text', value: 'data', negated: false },
    ])
  })

  it('parses a typed filter', () => {
    const tokens = parseFilterQuery('domain:example.com')
    expect(tokens).toEqual([
      { type: 'domain', value: 'example.com', negated: false },
    ])
  })

  it('parses negated typed filter', () => {
    const tokens = parseFilterQuery('-domain:example.com')
    expect(tokens).toEqual([
      { type: 'domain', value: 'example.com', negated: true },
    ])
  })

  it('parses negated plain text', () => {
    const tokens = parseFilterQuery('-analytics')
    expect(tokens).toEqual([
      { type: 'text', value: 'analytics', negated: true },
    ])
  })

  it('parses quoted values with spaces', () => {
    const tokens = parseFilterQuery('domain:"my site.com"')
    expect(tokens).toEqual([
      { type: 'domain', value: 'my site.com', negated: false },
    ])
  })

  it('parses single-quoted values', () => {
    const tokens = parseFilterQuery("url:'some path'")
    expect(tokens).toEqual([
      { type: 'url', value: 'some path', negated: false },
    ])
  })

  it('parses mixed typed and text tokens', () => {
    const tokens = parseFilterQuery('method:POST api domain:example.com')
    expect(tokens).toEqual([
      { type: 'method', value: 'POST', negated: false },
      { type: 'text', value: 'api', negated: false },
      { type: 'domain', value: 'example.com', negated: false },
    ])
  })

  it('handles unknown key: prefix as plain text', () => {
    const tokens = parseFilterQuery('foo:bar')
    expect(tokens).toEqual([
      { type: 'text', value: 'foo:bar', negated: false },
    ])
  })

  it('is case-insensitive for filter type names', () => {
    const tokens = parseFilterQuery('Domain:example.com')
    expect(tokens).toEqual([
      { type: 'domain', value: 'example.com', negated: false },
    ])
  })

  it('handles empty string', () => {
    expect(parseFilterQuery('')).toEqual([])
  })

  it('handles whitespace-only string', () => {
    expect(parseFilterQuery('   ')).toEqual([])
  })

  it('handles unclosed quote gracefully', () => {
    const tokens = parseFilterQuery('domain:"example.com')
    expect(tokens).toEqual([
      { type: 'domain', value: 'example.com', negated: false },
    ])
  })

  it('parses all supported filter types', () => {
    const types = [
      'domain',
      'method',
      'status-code',
      'mime-type',
      'larger-than',
      'scheme',
      'has-response-header',
      'url',
    ]
    for (const t of types) {
      const tokens = parseFilterQuery(`${t}:test`)
      expect(tokens).toEqual([{ type: t, value: 'test', negated: false }])
    }
  })

  it('treats a bare hyphen as a text token', () => {
    // A lone hyphen is not meaningful as negation — treat as literal text
    const tokens = parseFilterQuery('-')
    expect(tokens).toEqual([{ type: 'text', value: '-', negated: false }])
  })
})

// ===========================================================================
// parseSize
// ===========================================================================

describe('parseSize', () => {
  it('parses plain numbers as bytes', () => {
    expect(parseSize('500')).toBe(500)
    expect(parseSize('0')).toBe(0)
  })

  it('parses k/K suffix as kilobytes', () => {
    expect(parseSize('1k')).toBe(1000)
    expect(parseSize('1K')).toBe(1000)
    expect(parseSize('2.5k')).toBe(2500)
  })

  it('parses m/M suffix as megabytes', () => {
    expect(parseSize('1m')).toBe(1000000)
    expect(parseSize('1M')).toBe(1000000)
  })

  it('returns NaN for invalid values', () => {
    expect(parseSize('abc')).toBeNaN()
    expect(parseSize('')).toBeNaN()
    expect(parseSize('1g')).toBeNaN()
  })
})

// ===========================================================================
// matchDomain
// ===========================================================================

describe('matchDomain', () => {
  it('matches exact domain', () => {
    expect(matchDomain('example.com', 'example.com')).toBe(true)
  })

  it('rejects non-matching domain', () => {
    expect(matchDomain('example.com', 'other.com')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(matchDomain('Example.COM', 'example.com')).toBe(true)
  })

  it('matches wildcard *.domain against subdomains', () => {
    expect(matchDomain('*.example.com', 'sub.example.com')).toBe(true)
    expect(matchDomain('*.example.com', 'deep.sub.example.com')).toBe(true)
  })

  it('matches wildcard *.domain against the bare domain', () => {
    expect(matchDomain('*.example.com', 'example.com')).toBe(true)
  })

  it('rejects wildcard against unrelated domain', () => {
    expect(matchDomain('*.example.com', 'notexample.com')).toBe(false)
  })
})

// ===========================================================================
// matchToken (individual token matching)
// ===========================================================================

describe('matchToken', () => {
  describe('text filter', () => {
    it('matches against URL', () => {
      const entry = makeEntry({ url: 'https://example.com/api/users' })
      expect(
        matchToken({ type: 'text', value: 'api', negated: false }, entry)
      ).toBe(true)
    })

    it('is case-insensitive', () => {
      const entry = makeEntry({ url: 'https://example.com/API/Users' })
      expect(
        matchToken({ type: 'text', value: 'api', negated: false }, entry)
      ).toBe(true)
    })

    it('rejects non-matching text', () => {
      const entry = makeEntry({ url: 'https://example.com/api/users' })
      expect(
        matchToken({ type: 'text', value: 'photos', negated: false }, entry)
      ).toBe(false)
    })

    it('supports negation', () => {
      const entry = makeEntry({ url: 'https://example.com/api/users' })
      expect(
        matchToken({ type: 'text', value: 'api', negated: true }, entry)
      ).toBe(false)
      expect(
        matchToken({ type: 'text', value: 'photos', negated: true }, entry)
      ).toBe(true)
    })
  })

  describe('domain filter', () => {
    it('matches exact domain', () => {
      const entry = makeEntry({ url: 'https://api.example.com/data' })
      expect(
        matchToken(
          { type: 'domain', value: 'api.example.com', negated: false },
          entry
        )
      ).toBe(true)
    })

    it('matches wildcard domain', () => {
      const entry = makeEntry({ url: 'https://api.example.com/data' })
      expect(
        matchToken(
          { type: 'domain', value: '*.example.com', negated: false },
          entry
        )
      ).toBe(true)
    })

    it('rejects non-matching domain', () => {
      const entry = makeEntry({ url: 'https://api.example.com/data' })
      expect(
        matchToken(
          { type: 'domain', value: 'other.com', negated: false },
          entry
        )
      ).toBe(false)
    })
  })

  describe('method filter', () => {
    it('matches method case-insensitively', () => {
      const entry = makeEntry({ method: 'POST' })
      expect(
        matchToken({ type: 'method', value: 'post', negated: false }, entry)
      ).toBe(true)
      expect(
        matchToken({ type: 'method', value: 'POST', negated: false }, entry)
      ).toBe(true)
    })

    it('rejects non-matching method', () => {
      const entry = makeEntry({ method: 'GET' })
      expect(
        matchToken({ type: 'method', value: 'POST', negated: false }, entry)
      ).toBe(false)
    })
  })

  describe('status-code filter', () => {
    it('matches exact status code', () => {
      const entry = makeEntry({ status: 404 })
      expect(
        matchToken(
          { type: 'status-code', value: '404', negated: false },
          entry
        )
      ).toBe(true)
    })

    it('matches status range pattern (4xx)', () => {
      const entry = makeEntry({ status: 403 })
      expect(
        matchToken(
          { type: 'status-code', value: '4xx', negated: false },
          entry
        )
      ).toBe(true)
    })

    it('rejects non-matching status range', () => {
      const entry = makeEntry({ status: 200 })
      expect(
        matchToken(
          { type: 'status-code', value: '4xx', negated: false },
          entry
        )
      ).toBe(false)
    })
  })

  describe('mime-type filter', () => {
    it('matches partial MIME type', () => {
      const entry = makeEntry({ mimeType: 'application/json; charset=utf-8' })
      expect(
        matchToken(
          { type: 'mime-type', value: 'json', negated: false },
          entry
        )
      ).toBe(true)
    })

    it('matches full MIME type', () => {
      const entry = makeEntry({ mimeType: 'text/html' })
      expect(
        matchToken(
          { type: 'mime-type', value: 'text/html', negated: false },
          entry
        )
      ).toBe(true)
    })
  })

  describe('larger-than filter', () => {
    it('matches entries larger than the threshold', () => {
      // headersSize: 100, bodySize: 5000 => transferSize: 5100
      const entry = makeEntry({ headersSize: 100, bodySize: 5000 })
      expect(
        matchToken(
          { type: 'larger-than', value: '1k', negated: false },
          entry
        )
      ).toBe(true)
    })

    it('rejects entries smaller than the threshold', () => {
      const entry = makeEntry({ headersSize: 100, bodySize: 500 })
      expect(
        matchToken(
          { type: 'larger-than', value: '1k', negated: false },
          entry
        )
      ).toBe(false)
    })

    it('handles invalid size value gracefully', () => {
      const entry = makeEntry({})
      expect(
        matchToken(
          { type: 'larger-than', value: 'abc', negated: false },
          entry
        )
      ).toBe(false)
    })
  })

  describe('scheme filter', () => {
    it('matches https scheme', () => {
      const entry = makeEntry({ url: 'https://example.com/path' })
      expect(
        matchToken({ type: 'scheme', value: 'https', negated: false }, entry)
      ).toBe(true)
    })

    it('matches http scheme', () => {
      const entry = makeEntry({ url: 'http://example.com/path' })
      expect(
        matchToken({ type: 'scheme', value: 'http', negated: false }, entry)
      ).toBe(true)
    })

    it('rejects non-matching scheme', () => {
      const entry = makeEntry({ url: 'https://example.com/path' })
      expect(
        matchToken({ type: 'scheme', value: 'http', negated: false }, entry)
      ).toBe(false)
    })
  })

  describe('has-response-header filter', () => {
    it('matches when header is present', () => {
      const entry = makeEntry({
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html' },
          { name: 'X-Custom', value: 'yes' },
        ],
      })
      expect(
        matchToken(
          { type: 'has-response-header', value: 'x-custom', negated: false },
          entry
        )
      ).toBe(true)
    })

    it('rejects when header is absent', () => {
      const entry = makeEntry({
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
      })
      expect(
        matchToken(
          { type: 'has-response-header', value: 'x-custom', negated: false },
          entry
        )
      ).toBe(false)
    })
  })

  describe('url filter', () => {
    it('matches substring of URL', () => {
      const entry = makeEntry({ url: 'https://example.com/api/v2/users' })
      expect(
        matchToken({ type: 'url', value: 'api/v2', negated: false }, entry)
      ).toBe(true)
    })
  })
})

// ===========================================================================
// matchEntry (multi-token AND logic)
// ===========================================================================

describe('matchEntry', () => {
  it('matches when all tokens match', () => {
    const entry = makeEntry({
      url: 'https://api.example.com/users',
      method: 'POST',
      status: 201,
    })
    const tokens = parseFilterQuery('domain:api.example.com method:POST')
    expect(matchEntry(tokens, entry)).toBe(true)
  })

  it('rejects when any token fails', () => {
    const entry = makeEntry({
      url: 'https://api.example.com/users',
      method: 'GET',
    })
    const tokens = parseFilterQuery('domain:api.example.com method:POST')
    expect(matchEntry(tokens, entry)).toBe(false)
  })

  it('matches everything when query is empty', () => {
    const entry = makeEntry({})
    const tokens = parseFilterQuery('')
    expect(matchEntry(tokens, entry)).toBe(true)
  })

  it('supports mixed text and typed filters', () => {
    const entry = makeEntry({
      url: 'https://api.example.com/users',
      method: 'GET',
    })
    const tokens = parseFilterQuery('users method:GET')
    expect(matchEntry(tokens, entry)).toBe(true)
  })

  it('supports negated tokens mixed with positive ones', () => {
    const entry = makeEntry({
      url: 'https://api.example.com/users',
      method: 'GET',
    })
    // Should match: has "users" in URL, method is GET, is NOT on other.com
    const tokens = parseFilterQuery('users method:GET -domain:other.com')
    expect(matchEntry(tokens, entry)).toBe(true)
  })

  it('rejects when negated token matches', () => {
    const entry = makeEntry({
      url: 'https://api.example.com/users',
      method: 'GET',
    })
    const tokens = parseFilterQuery('-domain:api.example.com')
    expect(matchEntry(tokens, entry)).toBe(false)
  })
})
