// HAR 1.2 Specification Types
// See: http://www.softwareishard.com/blog/har-12-spec/

export interface Har {
  log: HarLog
}

export interface HarLog {
  version: string
  creator: HarCreator
  browser?: HarBrowser
  pages?: HarPage[]
  entries: HarEntry[]
  comment?: string
}

export interface HarCreator {
  name: string
  version: string
  comment?: string
}

export interface HarBrowser {
  name: string
  version: string
  comment?: string
}

export interface HarPage {
  startedDateTime: string
  id: string
  title: string
  pageTimings: HarPageTimings
  comment?: string
}

export interface HarPageTimings {
  onContentLoad?: number
  onLoad?: number
  comment?: string
}

export interface HarEntry {
  pageref?: string
  startedDateTime: string
  time: number
  request: HarRequest
  response: HarResponse
  cache: HarCache
  timings: HarTimings
  serverIPAddress?: string
  connection?: string
  comment?: string
  // Computed fields we add
  _index?: number
  _url?: URL | null
}

export interface HarRequest {
  method: string
  url: string
  httpVersion: string
  cookies: HarCookie[]
  headers: HarHeader[]
  queryString: HarQueryParam[]
  postData?: HarPostData
  headersSize: number
  bodySize: number
  comment?: string
}

export interface HarResponse {
  status: number
  statusText: string
  httpVersion: string
  cookies: HarCookie[]
  headers: HarHeader[]
  content: HarContent
  redirectURL: string
  headersSize: number
  bodySize: number
  _transferSize?: number
  comment?: string
}

export interface HarCookie {
  name: string
  value: string
  path?: string
  domain?: string
  expires?: string
  httpOnly?: boolean
  secure?: boolean
  comment?: string
}

export interface HarHeader {
  name: string
  value: string
  comment?: string
}

export interface HarQueryParam {
  name: string
  value: string
  comment?: string
}

export interface HarPostData {
  mimeType: string
  params?: HarParam[]
  text?: string
  comment?: string
}

export interface HarParam {
  name: string
  value?: string
  fileName?: string
  contentType?: string
  comment?: string
}

export interface HarContent {
  size: number
  compression?: number
  mimeType: string
  text?: string
  encoding?: string
  comment?: string
}

export interface HarCache {
  beforeRequest?: HarCacheEntry
  afterRequest?: HarCacheEntry
  comment?: string
}

export interface HarCacheEntry {
  expires?: string
  lastAccess: string
  eTag: string
  hitCount: number
  comment?: string
}

export interface HarTimings {
  blocked?: number
  dns?: number
  connect?: number
  send: number
  wait: number
  receive: number
  ssl?: number
  comment?: string
  // Chrome-specific extension: portion of `blocked` spent in browser queue
  _blocked_queueing?: number
}

// App-specific types

export type ContentType =
  | 'xhr'
  | 'fetch'
  | 'document'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'media'
  | 'websocket'
  | 'manifest'
  | 'other'

export type SortField =
  | 'name'
  | 'method'
  | 'status'
  | 'type'
  | 'size'
  | 'time'
  | 'waterfall'

export type SortDirection = 'asc' | 'desc'

export interface FilterState {
  search: string
  method: string | null
  statusCode: string | null
  contentType: ContentType | null
}

export interface SortState {
  field: SortField
  direction: SortDirection
}

export interface SummaryStats {
  totalRequests: number
  totalTransferSize: number
  totalUncompressedSize: number
  totalTime: number
  requestsByType: Record<string, number>
  requestsByStatus: Record<string, number>
}
