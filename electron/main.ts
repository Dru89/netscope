import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  Menu,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import fs from "fs";
import {
  toCurl,
  toFetch,
  toFetchNode,
  toPowerShell,
  getResponseBody,
} from "../src/utils/copyFormatters";
import type { HarEntry, SortField, SortDirection } from "../src/types/har";

const windows = new Set<BrowserWindow>();
const windowFilePaths = new Map<BrowserWindow, string>();
const recentDocuments: string[] = [];
const MAX_RECENT_DOCUMENTS = 10;

function addRecentDocument(filePath: string) {
  app.addRecentDocument(filePath);
  const index = recentDocuments.indexOf(filePath);
  if (index !== -1) {
    recentDocuments.splice(index, 1);
  }
  recentDocuments.unshift(filePath);
  if (recentDocuments.length > MAX_RECENT_DOCUMENTS) {
    recentDocuments.length = MAX_RECENT_DOCUMENTS;
  }
}

function removeRecentDocument(filePath: string) {
  const index = recentDocuments.indexOf(filePath);
  if (index !== -1) {
    recentDocuments.splice(index, 1);
  }
}
let pendingFile: string | null = null;
// A downloaded 3.4.x update waiting for a restart (electron-updater flow)
let pendingUpdateVersion: string | null = null;
// A Netscope 4.x version known to be available (drives the About panel note)
let netscope4Version: string | null = null;

const prefsPath = path.join(app.getPath("userData"), "preferences.json");

function readPrefs(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
  } catch {
    return {};
  }
}

function writePrefs(prefs: Record<string, unknown>) {
  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
}

function getSkippedVersion(): string | null {
  return (readPrefs().skippedUpdateVersion as string) ?? null;
}

function setSkippedVersion(version: string) {
  const prefs = readPrefs();
  prefs.skippedUpdateVersion = version;
  // Clear any remind-later date when skipping — they're mutually exclusive
  delete prefs.remindLaterDate;
  writePrefs(prefs);
}

function getRemindLaterDate(): string | null {
  return (readPrefs().remindLaterDate as string) ?? null;
}

function setRemindLaterDate(date: string) {
  const prefs = readPrefs();
  prefs.remindLaterDate = date;
  writePrefs(prefs);
}

// Written before an update-triggered restart so the next launch can reopen
// the same files. 3.3.x wrote this before installing us, and 3.4.x writes it
// before installing any later 3.4.x release.
function saveRestoreState() {
  const filePaths = [...windowFilePaths.values()];
  if (filePaths.length === 0) return;
  const prefs = readPrefs();
  prefs.restoreAfterUpdate = filePaths;
  writePrefs(prefs);
}

function getRestoreState(): string[] | null {
  const prefs = readPrefs();
  const paths = prefs.restoreAfterUpdate as string[] | undefined;
  return paths && paths.length > 0 ? paths : null;
}

function clearRestoreState() {
  const prefs = readPrefs();
  delete prefs.restoreAfterUpdate;
  writePrefs(prefs);
}

const isMac = process.platform === "darwin";
const CASCADE_OFFSET = 28;
let lastCreatedWindow: BrowserWindow | null = null;

// On Windows and Linux, ensure only one instance of the app runs.
// When a second instance is launched (e.g., double-clicking a .har file),
// the file path arrives here via argv instead of spawning a new process.
// macOS uses the `open-file` event instead, so the lock is still acquired
// but the `second-instance` handler won't fire for Finder opens.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running — it will receive our argv via
  // the `second-instance` event. Quit this instance immediately.
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // On Windows, the file path is passed as the last argument.
    // argv[0] is the executable, argv[1..] are flags/paths.
    const filePath = argv.find(
      (arg) => arg.endsWith(".har") && fs.existsSync(arg),
    );
    if (filePath) {
      openFileInNewWindow(filePath);
    } else {
      // No file — just open a new window
      createWindow();
    }

    // Focus the most recently used window so the app comes to the front
    const win = BrowserWindow.getFocusedWindow() ?? [...windows][0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function getCascadePosition(): { x: number; y: number } | undefined {
  // Cascade from the most recently created window, not the focused one,
  // so that new windows always stack below the previous one regardless
  // of which window the user has focused.
  const reference = lastCreatedWindow ?? BrowserWindow.getFocusedWindow();
  if (!reference || reference.isDestroyed()) return undefined;
  const [x, y] = reference.getPosition();
  return { x: x + CASCADE_OFFSET, y: y + CASCADE_OFFSET };
}

function createWindow(fileToOpen?: string): BrowserWindow {
  const cascade = windows.size > 0 ? getCascadePosition() : undefined;
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    ...(cascade ? { x: cascade.x, y: cascade.y } : {}),
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 16 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff",
  });

  windows.add(win);
  lastCreatedWindow = win;

  win.once("ready-to-show", () => {
    if (fileToOpen) {
      // When opening a file, defer showing the window until the renderer
      // signals that the HAR content is parsed and rendered. This avoids
      // a flash of the welcome screen. A timeout ensures the window still
      // appears even if the renderer is slow (e.g., very large files).
      const SHOW_TIMEOUT_MS = 800;
      let shown = false;
      const show = () => {
        if (shown) return;
        shown = true;
        ipcMain.removeListener("renderer-ready", onReady);
        win.show();
      };
      const onReady = (event: Electron.IpcMainEvent) => {
        if (event.sender === win.webContents) {
          clearTimeout(timeout);
          show();
        }
      };
      const timeout = setTimeout(show, SHOW_TIMEOUT_MS);
      ipcMain.on("renderer-ready", onReady);
      sendFileToWindow(win, fileToOpen);
    } else {
      win.show();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.on("closed", () => {
    windows.delete(win);
    windowFilePaths.delete(win);
    if (lastCreatedWindow === win) {
      lastCreatedWindow = null;
    }
  });

  return win;
}

function sendFileToWindow(win: BrowserWindow, filePath: string) {
  try {
    const resolved = path.resolve(filePath);
    const content = fs.readFileSync(resolved, "utf-8");
    const fileName = path.basename(resolved);
    windowFilePaths.set(win, resolved);
    win.setTitle(fileName);
    if (isMac) {
      win.setRepresentedFilename(resolved);
    }
    addRecentDocument(resolved);
    buildMenu();
    win.webContents.send("har-file-opened", {
      filePath: resolved,
      content,
      fileName,
    });
  } catch (err) {
    console.error("Failed to read HAR file:", err);
    const message =
      (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `The file "${path.basename(filePath)}" could not be found. It may have been moved or deleted.`
        : `The file "${path.basename(filePath)}" could not be opened.`;
    dialog.showMessageBox(win, {
      type: "warning",
      message: "Unable to open file",
      detail: message,
      buttons: ["OK"],
    });
  }
}

function findWindowForFile(filePath: string): BrowserWindow | null {
  const resolved = path.resolve(filePath);
  let found: BrowserWindow | null = null;
  windowFilePaths.forEach((openPath, win) => {
    if (openPath === resolved) {
      found = win;
    }
  });
  return found;
}

function openFileInNewWindow(filePath: string) {
  const resolved = path.resolve(filePath);

  // Check if the file exists before creating or reusing a window
  if (!fs.existsSync(resolved)) {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const dialogOptions = {
      type: "warning" as const,
      message: "Unable to open file",
      detail: `The file "${path.basename(filePath)}" could not be found. It may have been moved or deleted.`,
      buttons: ["OK"],
    };
    if (focusedWindow) {
      dialog.showMessageBox(focusedWindow, dialogOptions);
    } else {
      dialog.showMessageBox(dialogOptions);
    }
    removeRecentDocument(resolved);
    buildMenu();
    return;
  }

  // If this file is already open, just focus that window
  const existing = findWindowForFile(filePath);
  if (existing) {
    existing.focus();
    return;
  }

  // If the focused window is a welcome screen (no file loaded), reuse it
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !windowFilePaths.has(focused)) {
    sendFileToWindow(focused, filePath);
    return;
  }

  createWindow(filePath);
}

// Handle file open dialog
ipcMain.handle("open-file-dialog", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win!, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "HAR Files", extensions: ["har"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    // First file loads in the calling window; additional files open new windows
    const [firstPath, ...restPaths] = result.filePaths;
    for (const extra of restPaths) {
      openFileInNewWindow(extra);
    }
    try {
      const resolved = path.resolve(firstPath);
      const fileName = path.basename(resolved);
      const content = fs.readFileSync(resolved, "utf-8");
      if (win) {
        windowFilePaths.set(win, resolved);
        win.setTitle(fileName);
        if (isMac) {
          win.setRepresentedFilename(resolved);
        }
      }
      addRecentDocument(resolved);
      buildMenu();
      return {
        filePath: resolved,
        content,
        fileName,
      };
    } catch (err) {
      console.error("Failed to read file:", err);
      return null;
    }
  }
  return null;
});

// Handle reading a file from a dropped path
ipcMain.handle("read-har-file", async (event, filePath: string) => {
  try {
    const resolved = path.resolve(filePath);
    const fileName = path.basename(resolved);
    const content = fs.readFileSync(resolved, "utf-8");
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      windowFilePaths.set(win, resolved);
      win.setTitle(fileName);
      if (isMac) {
        win.setRepresentedFilename(resolved);
      }
    }
    addRecentDocument(resolved);
    buildMenu();
    return {
      filePath: resolved,
      content,
      fileName,
    };
  } catch (err) {
    console.error("Failed to read file:", err);
    return null;
  }
});

// Handle theme query
ipcMain.handle("get-native-theme", () => {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
});

// Handle theme mode changes (system, light, dark)
ipcMain.handle(
  "set-theme-mode",
  (_event, mode: "system" | "light" | "dark") => {
    nativeTheme.themeSource = mode;
  },
);

// Handle request row context menu
ipcMain.on(
  "show-request-context-menu",
  (
    event,
    data: {
      entry: HarEntry;
      allEntries: HarEntry[];
      sortField: SortField;
      sortDirection: SortDirection;
    },
  ) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const { entry, allEntries, sortField, sortDirection } = data;

    const SORT_FIELDS: { label: string; field: SortField }[] = [
      { label: "Name", field: "name" },
      { label: "Method", field: "method" },
      { label: "Status", field: "status" },
      { label: "Type", field: "type" },
      { label: "Size", field: "size" },
      { label: "Time", field: "time" },
      { label: "Waterfall", field: "waterfall" },
    ];

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: "Open in Browser",
        click: () => {
          shell.openExternal(entry.request.url);
        },
      },
      { type: "separator" },
      {
        label: "Copy",
        submenu: [
          {
            label: "Copy URL",
            click: () => clipboard.writeText(entry.request.url),
          },
          { type: "separator" },
          {
            label: "Copy as cURL",
            click: () => clipboard.writeText(toCurl(entry)),
          },
          {
            label: "Copy as fetch",
            click: () => clipboard.writeText(toFetch(entry)),
          },
          {
            label: "Copy as fetch (Node.js)",
            click: () => clipboard.writeText(toFetchNode(entry)),
          },
          {
            label: "Copy as PowerShell",
            click: () => clipboard.writeText(toPowerShell(entry)),
          },
          { type: "separator" },
          {
            label: "Copy Response",
            click: () => clipboard.writeText(getResponseBody(entry)),
          },
          { type: "separator" },
          {
            label: "Copy All Listed URLs",
            click: () =>
              clipboard.writeText(
                allEntries.map((e) => e.request.url).join("\n"),
              ),
          },
          {
            label: "Copy All Listed as cURL",
            click: () =>
              clipboard.writeText(
                allEntries.map((e) => toCurl(e)).join("\n\n"),
              ),
          },
          {
            label: "Copy All Listed as fetch",
            click: () =>
              clipboard.writeText(
                allEntries.map((e) => toFetch(e)).join("\n\n"),
              ),
          },
          {
            label: "Copy All Listed as fetch (Node.js)",
            click: () =>
              clipboard.writeText(
                allEntries.map((e) => toFetchNode(e)).join("\n\n"),
              ),
          },
          {
            label: "Copy All Listed as PowerShell",
            click: () =>
              clipboard.writeText(
                allEntries.map((e) => toPowerShell(e)).join("\n\n"),
              ),
          },
        ],
      },
      { type: "separator" },
      {
        label: "Sort By",
        submenu: SORT_FIELDS.map(({ label, field }) => ({
          label:
            field === sortField
              ? `${label} (${sortDirection === "asc" ? "↑" : "↓"})`
              : label,
          type: "checkbox" as const,
          checked: field === sortField,
          click: () => {
            // Toggle direction if same field, otherwise default to ascending
            const newDirection: SortDirection =
              field === sortField
                ? sortDirection === "asc"
                  ? "desc"
                  : "asc"
                : "asc";
            win.webContents.send("context-menu-sort", {
              field,
              direction: newDirection,
            });
          },
        })),
      },
    ];

    Menu.buildFromTemplate(template).popup({ window: win });
  },
);

// Watch for theme changes
nativeTheme.on("updated", () => {
  const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  windows.forEach((win) => {
    win.webContents.send("theme-changed", theme);
  });
});

// ---------------------------------------------------------------------------
// Updates: two flows, one active per launch.
//
// 1. electron-updater still handles ordinary 3.4.x updates, so bridge bugs
//    can be fixed with a 3.4.1. It only runs when no Netscope 4 release
//    exists yet (see whenReady), and its errors are silent: once a 4.x
//    release owns "latest" on GitHub, the latest-*.yml check 404s forever
//    and must not nag the user — the migration flow owns updates from then
//    on. (3.3.x showed a dialog here; that was a mistake we can't unship.)
//
// 2. The Netscope 4 migration check (this is the 3.4.x "bridge" release).
//    Netscope 4 is a Tauri app with its own updater, so electron-updater
//    can't carry users across the boundary (different bundle ID, different
//    artifact formats, no latest-*.yml manifests on 4.x releases). Instead,
//    this release polls the Tauri updater manifest on the latest stable
//    GitHub release and, when a 4.x exists, walks the user through a
//    one-time installer download. Until 4.0 ships, the manifest URL 404s
//    and this stays completely silent.
// ---------------------------------------------------------------------------

// Show download progress on the dock/taskbar
autoUpdater.on("download-progress", (progress) => {
  const fraction = progress.percent / 100;
  windows.forEach((win) => {
    win.setProgressBar(fraction);
  });
});

// Track when a 3.4.x update has been downloaded
autoUpdater.on("update-downloaded", (info) => {
  // Clear progress bars
  windows.forEach((win) => {
    win.setProgressBar(-1);
  });

  pendingUpdateVersion = info.version;
  updateAboutPanel();

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const dialogOptions = {
    type: "info" as const,
    message: "Update Ready",
    detail: `Version ${info.version} has been downloaded. Restart to install.`,
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
  };
  const showDialog = focusedWindow
    ? dialog.showMessageBox(focusedWindow, dialogOptions)
    : dialog.showMessageBox(dialogOptions);
  showDialog.then((result) => {
    if (result.response === 0) {
      saveRestoreState();
      autoUpdater.quitAndInstall();
    }
  });
});

// Silent by design — see the comment block above. A mid-download failure
// also lands here; the next launch re-prompts and retries.
autoUpdater.on("error", (err) => {
  console.error("Auto-update error:", err);
  windows.forEach((win) => {
    win.setProgressBar(-1);
  });
});

// Prompt the user when a 3.4.x update is available (before downloading)
autoUpdater.on("update-available", (info) => {
  if (getSkippedVersion() === info.version) return;
  const remindLaterDate = getRemindLaterDate();
  if (remindLaterDate === new Date().toISOString().slice(0, 10)) return;

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const dialogOptions = {
    type: "info" as const,
    message: "Update Available",
    detail: `A new version of Netscope (${info.version}) is available. Would you like to download and install it?`,
    buttons: ["Install Update", "Remind Me Later", "Skip This Version"],
    defaultId: 0,
  };
  const showDialog = focusedWindow
    ? dialog.showMessageBox(focusedWindow, dialogOptions)
    : dialog.showMessageBox(dialogOptions);
  showDialog.then((result) => {
    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    } else if (result.response === 1) {
      setRemindLaterDate(new Date().toISOString().slice(0, 10));
    } else if (result.response === 2) {
      setSkippedVersion(info.version);
    }
  });
});

const NETSCOPE4_MANIFEST_URL =
  "https://github.com/Dru89/netscope/releases/latest/download/latest.json";

// Returns true when a Netscope 4 release exists (the caller then skips the
// electron-updater check — the migration flow owns updates at that point).
async function checkForNetscope4(): Promise<boolean> {
  try {
    const res = await fetch(NETSCOPE4_MANIFEST_URL);
    if (!res.ok) return false; // no Tauri stable release yet, or offline
    const manifest = (await res.json()) as { version?: string };
    const version = manifest.version;
    if (!version) return false;
    const major = Number.parseInt(version.split(".")[0] ?? "", 10);
    if (!Number.isFinite(major) || major < 4) return false;

    netscope4Version = version;
    updateAboutPanel();
    promptForMigration(version);
    return true;
  } catch {
    // Offline or GitHub unreachable — matches the old updater's silence
    return false;
  }
}

function promptForMigration(version: string) {
  if (getSkippedVersion() === version) return;
  const remindLaterDate = getRemindLaterDate();
  if (remindLaterDate === new Date().toISOString().slice(0, 10)) return;

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const dialogOptions = {
    type: "info" as const,
    message: "Netscope 4 is available",
    detail:
      `Netscope ${version} is a major upgrade built on a new engine, so ` +
      `this one-time update downloads the new installer. After that, ` +
      `updates are automatic again.`,
    buttons: ["Install Update", "Remind Me Later", "Skip This Version"],
    defaultId: 0,
  };
  const showDialog = focusedWindow
    ? dialog.showMessageBox(focusedWindow, dialogOptions)
    : dialog.showMessageBox(dialogOptions);
  showDialog.then((result) => {
    if (result.response === 0) {
      void downloadNetscope4(version);
    } else if (result.response === 1) {
      setRemindLaterDate(new Date().toISOString().slice(0, 10));
    } else if (result.response === 2) {
      setSkippedVersion(version);
    }
  });
}

// Artifact names produced by the Netscope 4 release pipeline
function netscope4InstallerUrl(version: string): string | null {
  const base = `https://github.com/Dru89/netscope/releases/download/v${version}`;
  if (isMac) return `${base}/Netscope_${version}_universal.dmg`;
  if (process.platform === "win32")
    return `${base}/Netscope_${version}_x64-setup.exe`;
  return null; // Linux installs vary (AppImage/deb/pacman) — use the page
}

async function downloadNetscope4(version: string) {
  const url = netscope4InstallerUrl(version);
  if (!url) {
    // Linux: the right artifact depends on how this copy was installed
    shell.openExternal(
      `https://github.com/Dru89/netscope/releases/tag/v${version}`,
    );
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const fileName = url.split("/").pop()!;
    const target = path.join(app.getPath("downloads"), fileName);
    const total = Number(res.headers.get("content-length")) || 0;
    let received = 0;

    const out = fs.createWriteStream(target);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (total > 0) {
        const fraction = received / total;
        windows.forEach((win) => win.setProgressBar(fraction));
      }
      await new Promise<void>((resolve, reject) =>
        out.write(value, (err) => (err ? reject(err) : resolve())),
      );
    }
    await new Promise<void>((resolve, reject) =>
      out.end((err: unknown) => (err ? reject(err) : resolve())),
    );
    windows.forEach((win) => win.setProgressBar(-1));

    const focusedWindow = BrowserWindow.getFocusedWindow();
    const doneOptions = isMac
      ? {
          type: "info" as const,
          message: "Installer downloaded",
          detail:
            `The Netscope ${version} installer is in your Downloads folder ` +
            `and will open now. Netscope will quit so the new version can ` +
            `replace it — drag Netscope into Applications to finish.`,
          buttons: ["Open Installer & Quit"],
          defaultId: 0,
        }
      : {
          type: "info" as const,
          message: "Installer downloaded",
          detail:
            `The Netscope ${version} installer will now run. ` +
            `This version will close. You can uninstall the old ` +
            `"Netscope" entry afterwards.`,
          buttons: ["Run Installer"],
          defaultId: 0,
        };
    const showDone = focusedWindow
      ? dialog.showMessageBox(focusedWindow, doneOptions)
      : dialog.showMessageBox(doneOptions);
    await showDone;
    await shell.openPath(target);
    // Quit on both platforms: the NSIS installer needs the app closed, and
    // Finder can't replace a running app in /Applications.
    app.quit();
  } catch (err) {
    windows.forEach((win) => win.setProgressBar(-1));
    console.error("Netscope 4 download failed:", err);
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const dialogOptions = {
      type: "error" as const,
      message: "Update Failed",
      detail:
        `The Netscope ${version} installer could not be downloaded. ` +
        `You can download it manually from the Netscope website.`,
      buttons: ["OK"],
    };
    if (focusedWindow) {
      dialog.showMessageBox(focusedWindow, dialogOptions);
    } else {
      dialog.showMessageBox(dialogOptions);
    }
  }
}

// Update the macOS About panel options (called on launch, when a 3.4.x
// update is downloaded, and when a Netscope 4 release is detected)
function updateAboutPanel() {
  const currentVersion = app.getVersion();
  let credits = "";
  if (pendingUpdateVersion) {
    credits = `Version ${pendingUpdateVersion} is ready — restart to install.`;
  } else if (netscope4Version) {
    credits = `Netscope ${netscope4Version} is available.`;
  }
  app.setAboutPanelOptions({
    applicationName: "Netscope",
    applicationVersion: currentVersion,
    version: "", // Hide the secondary version string
    copyright: `Copyright © ${new Date().getFullYear()} Drew Hays`,
    credits,
  });
}

// Custom About dialog that shows update status
async function showAbout() {
  if (isMac) {
    updateAboutPanel();
    app.showAboutPanel();
    return;
  }

  const currentVersion = app.getVersion();
  const lines = [
    `Version ${currentVersion}`,
    "",
    `Copyright © ${new Date().getFullYear()} Drew Hays`,
  ];

  if (pendingUpdateVersion) {
    lines.push(
      "",
      `Version ${pendingUpdateVersion} is ready — restart to install.`,
    );
  } else if (netscope4Version) {
    lines.push("", `Netscope ${netscope4Version} is available.`);
  }

  const buttons = pendingUpdateVersion
    ? ["Restart Now", "OK"]
    : netscope4Version
      ? ["Install Update", "OK"]
      : ["OK"];
  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const result = await dialog.showMessageBox(
    focusedWindow ?? ({} as BrowserWindow),
    {
      title: "About Netscope",
      message: "Netscope",
      detail: lines.join("\n"),
      buttons,
      icon: iconPath,
    },
  );

  // Index 0 is "Restart Now" when a 3.4.x update is downloaded, otherwise
  // "Install Update" when a Netscope 4 release exists
  if (pendingUpdateVersion && result.response === 0) {
    saveRestoreState();
    autoUpdater.quitAndInstall();
  } else if (netscope4Version && result.response === 0) {
    void downloadNetscope4(netscope4Version);
  }
}

// Build application menu
function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu (About, Services, Hide, Quit)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: "About Netscope", click: showAbout },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            createWindow();
          },
        },
        {
          label: "Open HAR File...",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            const result = await dialog.showOpenDialog(focusedWindow!, {
              properties: ["openFile", "multiSelections"],
              filters: [
                { name: "HAR Files", extensions: ["har"] },
                { name: "All Files", extensions: ["*"] },
              ],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              let usedFocusedWindow = false;
              for (const filePath of result.filePaths) {
                const existing = findWindowForFile(filePath);
                if (existing) {
                  existing.focus();
                } else if (
                  !usedFocusedWindow &&
                  focusedWindow &&
                  !windowFilePaths.has(focusedWindow)
                ) {
                  // First file loads into the welcome screen window
                  sendFileToWindow(focusedWindow, filePath);
                  usedFocusedWindow = true;
                } else {
                  openFileInNewWindow(filePath);
                }
              }
            }
          },
        },
        {
          label: "Open Recent",
          submenu: [
            ...recentDocuments.map((filePath) => ({
              label: path.basename(filePath),
              click: () => openFileInNewWindow(filePath),
            })),
            ...(recentDocuments.length > 0
              ? [{ type: "separator" as const }]
              : []),
            {
              label: "Clear Menu",
              enabled: recentDocuments.length > 0,
              click: () => {
                app.clearRecentDocuments();
                recentDocuments.length = 0;
                buildMenu();
              },
            },
          ],
        },
        { type: "separator" },
        ...(isMac ? [{ role: "close" as const }] : [{ role: "quit" as const }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "windowMenu",
    },
    {
      role: "help",
      submenu: [
        {
          label: "Netscope Website",
          click: () => {
            shell.openExternal("https://netscopeapp.com");
          },
        },
        {
          label: "Report an Issue",
          click: () => {
            shell.openExternal("https://github.com/Dru89/netscope/issues");
          },
        },
        ...(!isMac
          ? [
              { type: "separator" as const },
              { label: "About Netscope", click: showAbout },
            ]
          : []),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// macOS: Handle file open via Finder double-click or drag onto dock icon
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) {
    // App is running — always open a new window for the file
    openFileInNewWindow(filePath);
  } else {
    // App is still launching — store it and the initial window will pick it up
    pendingFile = filePath;
  }
});

app.whenReady().then(() => {
  buildMenu();

  // Check if launched with a file argument (e.g., from command line)
  const args = process.argv.slice(1);
  const harFile = args.find(
    (arg) => arg.endsWith(".har") && fs.existsSync(arg),
  );
  if (harFile && !pendingFile) {
    pendingFile = path.resolve(harFile);
  }

  // Restore files that were open before an update-triggered restart.
  // If no file was passed via args/Finder, use the first restore path
  // for the initial window to avoid an empty welcome screen.
  const restorePaths = getRestoreState();
  if (restorePaths) {
    clearRestoreState();
    let pathsToOpen = restorePaths.filter((p) => fs.existsSync(p));
    if (!pendingFile && pathsToOpen.length > 0) {
      pendingFile = pathsToOpen[0];
      pathsToOpen = pathsToOpen.slice(1);
    }

    // Create the initial window, passing the pending file if any
    createWindow(pendingFile || undefined);
    pendingFile = null;

    // Open remaining restored files in new windows
    for (const filePath of pathsToOpen) {
      openFileInNewWindow(filePath);
    }
  } else {
    // Create the initial window, passing the pending file if any
    createWindow(pendingFile || undefined);
    pendingFile = null;
  }

  // Check whether Netscope 4 (the Tauri successor) has shipped; silent
  // until it has. Only fall back to electron-updater (3.4.x fixes) when it
  // hasn't — post-4.0 that check 404s and the migration flow owns updates.
  // See the updates section above.
  void checkForNetscope4().then((found) => {
    if (found) return;
    // __BUILD_CHANNEL__ is injected at build time by vite.config.ts. Nightly
    // builds set it to "nightly", which makes electron-updater check the
    // nightly-*.yml manifests and accept GitHub pre-release builds.
    autoUpdater.channel = __BUILD_CHANNEL__;
    autoUpdater.allowPrerelease = __BUILD_CHANNEL__ !== "latest";
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;
    autoUpdater.checkForUpdates();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

app.on("activate", () => {
  if (windows.size === 0) {
    createWindow();
  }
});
