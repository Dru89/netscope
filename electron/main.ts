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

function addRecentDocument(filePath: string) {
  app.addRecentDocument(filePath);
}
let pendingFile: string | null = null;
let pendingUpdateVersion: string | null = null;

const isMac = process.platform === "darwin";
const CASCADE_OFFSET = 28;

function getCascadePosition(): { x: number; y: number } | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  if (!focused) return undefined;
  const [x, y] = focused.getPosition();
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

  win.once("ready-to-show", () => {
    win.show();
    // If a file was specified for this window, send it now
    if (fileToOpen) {
      sendFileToWindow(win, fileToOpen);
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
    buildMenu();
    return;
  }

  // If this file is already open, just focus that window
  const existing = findWindowForFile(filePath);
  if (existing) {
    existing.focus();
    return;
  }

  // If there's a window with no file loaded (welcome screen), reuse it
  let emptyWindow: BrowserWindow | null = null;
  windows.forEach((win) => {
    if (!windowFilePaths.has(win)) {
      emptyWindow = win;
    }
  });
  if (emptyWindow) {
    (emptyWindow as BrowserWindow).focus();
    sendFileToWindow(emptyWindow, filePath);
    return;
  }

  createWindow(filePath);
}

// Handle file open dialog
ipcMain.handle("open-file-dialog", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win!, {
    properties: ["openFile"],
    filters: [
      { name: "HAR Files", extensions: ["har"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
      const resolved = path.resolve(filePath);
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

// Track when an update has been downloaded
autoUpdater.on("update-downloaded", (info) => {
  pendingUpdateVersion = info.version;
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
              properties: ["openFile"],
              filters: [
                { name: "HAR Files", extensions: ["har"] },
                { name: "All Files", extensions: ["*"] },
              ],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              const filePath = result.filePaths[0];
              const existing = findWindowForFile(filePath);
              if (existing) {
                existing.focus();
              } else if (focusedWindow && !windowFilePaths.has(focusedWindow)) {
                // Window is on the welcome screen — load in place
                sendFileToWindow(focusedWindow, filePath);
              } else {
                // Window already has a file, or no focused window — open in new window
                openFileInNewWindow(filePath);
              }
            }
          },
        },
        {
          label: "Open Recent",
          submenu: (() => {
            const recentFiles = app
              .getRecentDocuments()
              .filter((f) => fs.existsSync(f));
            return [
              ...recentFiles.map((filePath) => ({
                label: path.basename(filePath),
                click: () => openFileInNewWindow(filePath),
              })),
              ...(recentFiles.length > 0
                ? [{ type: "separator" as const }]
                : []),
              {
                label: "Clear Menu",
                enabled: recentFiles.length > 0,
                click: () => {
                  app.clearRecentDocuments();
                  buildMenu();
                },
              },
            ];
          })(),
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

  // Check for updates silently — download in the background, install on quit
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
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
