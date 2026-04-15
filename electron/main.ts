import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  Menu,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import fs from "fs";

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
let pendingUpdateVersion: string | null = null;

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

// Watch for theme changes
nativeTheme.on("updated", () => {
  const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  windows.forEach((win) => {
    win.webContents.send("theme-changed", theme);
  });
});

// Show download progress on the dock/taskbar
autoUpdater.on("download-progress", (progress) => {
  const fraction = progress.percent / 100;
  windows.forEach((win) => {
    win.setProgressBar(fraction);
  });
});

// Track when an update has been downloaded
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
      autoUpdater.quitAndInstall();
    }
  });
});

// Handle update download errors
autoUpdater.on("error", (err) => {
  console.error("Auto-update error:", err);
  // Clear progress bars
  windows.forEach((win) => {
    win.setProgressBar(-1);
  });
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const dialogOptions = {
    type: "error" as const,
    message: "Update Failed",
    detail: `An error occurred while updating: ${err.message}. You can download the latest version manually from the Netscope website.`,
    buttons: ["OK"],
  };
  if (focusedWindow) {
    dialog.showMessageBox(focusedWindow, dialogOptions);
  } else {
    dialog.showMessageBox(dialogOptions);
  }
});

// Prompt the user when an update is available (before downloading)
autoUpdater.on("update-available", (info) => {
  const skippedVersion = getSkippedVersion();
  if (skippedVersion === info.version) return;

  // Check if the user chose "Remind Me Later" for this version within
  // the current calendar day — don't re-prompt until tomorrow
  const remindLaterDate = getRemindLaterDate();
  if (remindLaterDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (remindLaterDate === today) return;
  }

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

// Update the macOS About panel options (called on launch and when an update is downloaded)
function updateAboutPanel() {
  const currentVersion = app.getVersion();
  let credits = "";
  if (pendingUpdateVersion) {
    credits = `Version ${pendingUpdateVersion} is ready — restart to install.`;
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
  }

  const buttons = pendingUpdateVersion ? ["Restart Now", "OK"] : ["OK"];
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

  // "Restart Now" is index 0 when an update is pending
  if (pendingUpdateVersion && result.response === 0) {
    autoUpdater.quitAndInstall();
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

  // Create the initial window, passing the pending file if any
  createWindow(pendingFile || undefined);
  pendingFile = null;

  // Check for updates — prompt the user before downloading
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null; // Suppress verbose logging
  autoUpdater.checkForUpdates();
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

app.on("activate", () => {
  if (windows.size === 0) {
    createWindow();
  }
});
