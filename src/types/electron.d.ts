export interface ElectronAPI {
  openFileDialog: () => Promise<{
    filePath: string
    content: string
    fileName: string
  } | null>
  readHarFile: (filePath: string) => Promise<{
    filePath: string
    content: string
    fileName: string
  } | null>
  getNativeTheme: () => Promise<'dark' | 'light'>
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>
  onHarFileOpened: (
    callback: (data: {
      filePath: string
      content: string
      fileName: string
    }) => void
  ) => () => void
  onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
