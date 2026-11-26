import { app, shell, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// ---------- Encrypted key/value store (used for the Supabase session) ----------
const storePath = (): string => join(app.getPath('userData'), 'secure-store.json')

async function readStore(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(storePath(), 'utf8'))
  } catch {
    return {}
  }
}

async function writeStore(data: Record<string, string>): Promise<void> {
  await fs.writeFile(storePath(), JSON.stringify(data))
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
    throw new Error('Invalid storage key')
  }
}

// ---------- Saving files (Excel, JSON and PDF) ----------
type SaveResult =
  | { status: 'saved'; path: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

const BINARY_KINDS = {
  xlsx: { ext: '.xlsx', label: 'Excel' },
  json: { ext: '.json', label: 'JSON' }
} as const

function cleanFileName(name: unknown, ext: string): string {
  const base = typeof name === 'string' ? basename(name) : 'export'
  // eslint-disable-next-line no-control-regex
  const safe = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'export'
  return safe.toLowerCase().endsWith(ext) ? safe : safe + ext
}

async function askSavePath(
  parent: BrowserWindow | null,
  fileName: string,
  label: string,
  ext: string
): Promise<string | null> {
  const options = {
    defaultPath: join(app.getPath('documents'), fileName),
    filters: [{ name: label, extensions: [ext] }]
  }
  const res = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  return res.canceled || !res.filePath ? null : res.filePath
}

const errorResult = (err: unknown): SaveResult => ({
  status: 'error',
  message: err instanceof Error ? err.message : String(err)
})

function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('secure:get', async (_e, key: unknown) => {
    assertKey(key)
    if (!safeStorage.isEncryptionAvailable()) return null
    const stored = (await readStore())[key]
    if (!stored) return null
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  })

  ipcMain.handle('secure:set', async (_e, key: unknown, value: unknown) => {
    assertKey(key)
    if (typeof value !== 'string') throw new Error('Invalid value')
    if (!safeStorage.isEncryptionAvailable()) return false
    const store = await readStore()
    store[key] = safeStorage.encryptString(value).toString('base64')
    await writeStore(store)
    return true
  })

  ipcMain.handle('secure:remove', async (_e, key: unknown) => {
    assertKey(key)
    const store = await readStore()
    delete store[key]
    await writeStore(store)
    return true
  })

  // Excel and JSON files: the renderer builds the content, the main process shows "Save as"
  ipcMain.handle(
    'file:saveBinary',
    async (e, defaultName: unknown, data: unknown, kind: unknown): Promise<SaveResult> => {
      try {
        if (kind !== 'xlsx' && kind !== 'json') throw new Error('Invalid file type')
        const spec = BINARY_KINDS[kind]
        if (!ArrayBuffer.isView(data) || data.byteLength === 0 || data.byteLength > 200_000_000) {
          throw new Error('Invalid file data')
        }
        const parent = BrowserWindow.fromWebContents(e.sender)
        const path = await askSavePath(parent, cleanFileName(defaultName, spec.ext), spec.label, kind)
        if (!path) return { status: 'canceled' }
        await fs.writeFile(path, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
        return { status: 'saved', path }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // PDF: the HTML is printed by a hidden window with JavaScript disabled
  ipcMain.handle(
    'file:savePdf',
    async (e, defaultName: unknown, html: unknown, landscape: unknown): Promise<SaveResult> => {
      let tmpFile: string | null = null
      let pdfWin: BrowserWindow | null = null
      try {
        if (typeof html !== 'string' || html.length === 0 || html.length > 30_000_000) {
          throw new Error('Invalid report data')
        }
        const parent = BrowserWindow.fromWebContents(e.sender)
        const path = await askSavePath(parent, cleanFileName(defaultName, '.pdf'), 'PDF', 'pdf')
        if (!path) return { status: 'canceled' }

        tmpFile = join(app.getPath('temp'), `fp-report-${randomUUID()}.html`)
        await fs.writeFile(tmpFile, html, 'utf8')

        pdfWin = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            javascript: false
          }
        })
        await pdfWin.loadFile(tmpFile)

        const pdf = await pdfWin.webContents.printToPDF({
          pageSize: 'A4',
          landscape: landscape === true,
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate:
            '<div style="font-size:8px;width:100%;text-align:center;color:#666;">' +
            '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
          margins: { top: 0.5, bottom: 0.7, left: 0.4, right: 0.4 }
        })
        await fs.writeFile(path, pdf)
        return { status: 'saved', path }
      } catch (err) {
        return errorResult(err)
      } finally {
        pdfWin?.destroy()
        if (tmpFile) fs.unlink(tmpFile).catch(() => undefined)
      }
    }
  )
}

// ---------- Window ----------
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.facturespassives.manager')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})