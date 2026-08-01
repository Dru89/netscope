// Fills in the browser APIs jsdom doesn't implement. Runs for every test
// file; the guards keep it inert in the node-environment utility tests.
//
// Deliberately no @testing-library import here — that would need a DOM at
// import time and would break the node-environment tests. Component test
// files register their own `afterEach(cleanup)`.

if (typeof globalThis.ResizeObserver === "undefined") {
  // RequestTable observes its scroll container to track viewport height and
  // row height. jsdom reports zero for both, which is fine: the virtual
  // window falls back to its minimum overscan and renders the first 12 rows.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (
  typeof globalThis.matchMedia === "undefined" &&
  typeof window !== "undefined"
) {
  // Theme code asks for prefers-color-scheme. Report light and no listeners.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
