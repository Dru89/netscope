import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Menu } from 'electron'
import path from 'path'
import fs from 'fs'

const windows = new Set<BrowserWindow>()
const windowFilePaths = new Map<BrowserWindow, string>()
let pendingFile: string | null = null

function createWindow(fileToOpen?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
  })

  windows.add(win)

  win.once('ready-to-show', () => {
    win.show()
    // If a file was specified for this window, send it now
    if (fileToOpen) {
      sendFileToWindow(win, fileToOpen)
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  win.on('closed', () => {
    windows.delete(win)
    windowFilePaths.delete(win)
  })

  return win
}

function sendFileToWindow(win: BrowserWindow, filePath: string) {
  try {
    const resolved = path.resolve(filePath)
    const content = fs.readFileSync(resolved, 'utf-8')
    windowFilePaths.set(win, resolved)
    win.webContents.send('har-file-opened', {
      filePath: resolved,
      content,
      fileName: path.basename(resolved),
    })
  } catch (err) {
    console.error('Failed to read HAR file:', err)
  }
}

function findWindowForFile(filePath: string): BrowserWindow | null {
  const resolved = path.resolve(filePath)
  let found: BrowserWindow | null = null
  windowFilePaths.forEach((openPath, win) => {
    if (openPath === resolved) {
      found = win
    }
  })
  return found
}

function openFileInNewWindow(filePath: string) {
  const existing = findWindowForFile(filePath)
  if (existing) {
    existing.focus()
    return
  }
  createWindow(filePath)
}

// Handle file open dialog
ipcMain.handle('open-file-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [
      { name: 'HAR Files', extensions: ['har'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0]
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      if (win) {
        windowFilePaths.set(win, path.resolve(filePath))
      }
      return {
        filePath,
        content,
        fileName: path.basename(filePath),
      }
    } catch (err) {
      console.error('Failed to read file:', err)
      return null
    }
  }
  return null
})

// Handle reading a file from a dropped path
ipcMain.handle('read-har-file', async (event, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      windowFilePaths.set(win, path.resolve(filePath))
    }
    return {
      filePath,
      content,
      fileName: path.basename(filePath),
    }
  } catch (err) {
    console.error('Failed to read file:', err)
    return null
  }
})

// Handle theme query
ipcMain.handle('get-native-theme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

// Handle theme mode changes (system, light, dark)
ipcMain.handle('set-theme-mode', (_event, mode: 'system' | 'light' | 'dark') => {
  nativeTheme.themeSource = mode
})

// Watch for theme changes
nativeTheme.on('updated', () => {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  windows.forEach((win) => {
    win.webContents.send('theme-changed', theme)
  })
})

// Build application menu
function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open HAR File...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const focusedWindow = BrowserWindow.getFocusedWindow()
            const result = await dialog.showOpenDialog(focusedWindow!, {
              properties: ['openFile'],
              filters: [
                { name: 'HAR Files', extensions: ['har'] },
                { name: 'All Files', extensions: ['*'] },
              ],
            })
            if (!result.canceled && result.filePaths.length > 0) {
              // Open in the focused window by sending to its renderer
              if (focusedWindow) {
                sendFileToWindow(focusedWindow, result.filePaths[0])
              } else {
                openFileInNewWindow(result.filePaths[0])
              }
            }
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// macOS: Handle file open via Finder double-click or drag onto dock icon
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) {
    // App is running — always open a new window for the file
    openFileInNewWindow(filePath)
  } else {
    // App is still launching — store it and the initial window will pick it up
    pendingFile = filePath
  }
})

app.whenReady().then(() => {
  buildMenu()

  // Check if launched with a file argument (e.g., from command line)
  const args = process.argv.slice(1)
  const harFile = args.find(
    (arg) => arg.endsWith('.har') && fs.existsSync(arg)
  )
  if (harFile && !pendingFile) {
    pendingFile = path.resolve(harFile)
  }

  // Create the initial window, passing the pending file if any
  createWindow(pendingFile || undefined)
  pendingFile = null
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (windows.size === 0) {
    createWindow()
  }
})
