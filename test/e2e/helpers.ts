// E2E harness: drives the real Tauri binary through tauri-driver (WebDriver).
//
// Requirements (Linux): the release binary (`npx tauri build --no-bundle`),
// `cargo install tauri-driver`, and the distro's WebKitWebDriver
// (`webkit2gtk-driver` on Debian/Ubuntu). Runs headless under xvfb-run in CI.
// Note: Arch's webkit2gtk package doesn't ship WebKitWebDriver, so these
// tests are CI-only on Arch dev machines.

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { remote } from "webdriverio";

const DRIVER_PORT = 4444;

const BINARY = path.resolve(
  __dirname,
  "../../src-tauri/target/release/netscope",
);

export const FIXTURES = path.resolve(__dirname, "../fixtures");

export type Session = {
  browser: WebdriverIO.Browser;
  stop: () => Promise<void>;
};

// Spawn tauri-driver and open a WebDriver session against the app binary.
// Each launch gets a fresh app instance; args are passed to the app
// (e.g. a .har path to open at startup).
export async function launchApp(args: string[] = []): Promise<Session> {
  const driver: ChildProcess = spawn(
    "tauri-driver",
    ["--port", String(DRIVER_PORT)],
    { stdio: "inherit" },
  );

  // Wait for the driver to accept connections
  await waitForPort(DRIVER_PORT);

  // No browserName: WebKitWebDriver's capability matching rejects "wry"
  // (Tauri's WebdriverIO example passes only tauri:options).
  const browser = await remote({
    hostname: "127.0.0.1",
    port: DRIVER_PORT,
    logLevel: "warn",
    capabilities: {
      // @ts-expect-error tauri-specific capability
      "tauri:options": {
        application: BINARY,
        args,
      },
    },
  });

  const stop = async () => {
    try {
      await browser.deleteSession();
    } finally {
      driver.kill();
    }
  };

  // If remote() threw, afterAll still runs; give it a killable handle
  process.once("beforeExit", () => driver.kill());

  return { browser, stop };
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await fetch(`http://127.0.0.1:${port}/status`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`tauri-driver did not start on port ${port}`);
}

// Set a controlled React input's value via script injection. WebDriver's
// Element Send Keys is unreliable through tauri-driver (the client falls
// back to the legacy wire format, which WebKitWebDriver rejects with
// "Missing text parameter"), so drive the input the way the app does:
// native value setter + an input event React picks up.
export async function setInputValue(
  browser: WebdriverIO.Browser,
  selector: string,
  value: string,
): Promise<void> {
  await browser.execute(
    (sel, val) => {
      const input = document.querySelector(sel) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
}

// Poll until the callback stops throwing (WebDriver has no built-in
// waitFor outside of element commands).
export async function eventually<T>(
  fn: () => Promise<T>,
  timeoutMs = 10_000,
): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}
