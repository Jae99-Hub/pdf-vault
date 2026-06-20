import { app, shell, BrowserWindow, ipcMain, dialog, Menu, MenuItem } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join, basename, dirname, sep, extname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import fs from 'fs'
import chokidar, { FSWatcher } from 'chokidar'

const DB_PATH = join(app.getPath('userData'), 'foldry.db')
const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')
let db: Database.Database

// ── Settings ─────────────────────────────────────────────────────────────────

interface Settings {
  vaultPath?: string
}

let settings: Settings = {}

function loadSettings(): Settings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    }
  } catch (e) {
    console.error('settings load error:', e)
  }
  return {}
}

function saveSettings(s: Settings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8')
}

// ── File system helpers ───────────────────────────────────────────────────────

// Recursively copy a directory tree (no fs.cpSync dependency)
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// ── Vault helpers ─────────────────────────────────────────────────────────────

// Strip characters that are illegal in Windows/macOS/Linux file names
function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'untitled'
}

function isImageFile(p: string): boolean {
  return /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(p)
}

function isVideoFile(p: string): boolean {
  return /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i.test(p)
}

function isAudioFile(p: string): boolean {
  return /\.(mp3|wav|aiff|alac|flac|m4a|ogg|aac)$/i.test(p)
}

function isTextDocFile(p: string): boolean {
  return /\.(txt|md|docx|hwp|xlsx|xls|pptx|ppt|pages|numbers|key|csv|odt|ods|odp)$/i.test(p)
}

function isSupportedFile(p: string): boolean {
  return /\.pdf$/i.test(p) || isImageFile(p) || isVideoFile(p) || isAudioFile(p) || isTextDocFile(p)
}

// Build the relative path (from vault root) for a folder using its DB ancestry
function getFolderRelPath(folderId: number): string {
  const parts: string[] = []
  let cur: number | null = folderId
  while (cur) {
    const row = db
      .prepare('SELECT id, name, parent_id FROM folders WHERE id = ?')
      .get(cur) as { id: number; name: string; parent_id: number | null } | undefined
    if (!row) break
    parts.unshift(sanitizeName(row.name))
    cur = row.parent_id
  }
  return parts.join(sep)
}

// Ensure the vault directory for folderId (or vault root if null) exists
function ensureVaultDir(folderId: number | null): string | null {
  if (!settings.vaultPath) return null
  const rel = folderId ? getFolderRelPath(folderId) : ''
  const dir = rel ? join(settings.vaultPath, rel) : settings.vaultPath
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Resolve a unique destination path in dir for a given base name (no ext)
function uniquePath(dir: string, title: string, ext: string, avoid?: string): string {
  const safe = sanitizeName(title)
  let dest = join(dir, `${safe}${ext}`)
  let i = 1
  while (fs.existsSync(dest) && dest !== avoid) {
    dest = join(dir, `${safe} (${i})${ext}`)
    i++
  }
  return dest
}

// Copy srcPath into the vault at folderId; returns new vault path or null
async function copyToVault(srcPath: string, title: string, folderId: number | null): Promise<string | null> {
  const dir = ensureVaultDir(folderId)
  if (!dir) return null
  const ext = extname(srcPath).toLowerCase() || '.pdf'
  const dest = uniquePath(dir, title, ext, srcPath)
  if (dest !== srcPath) await fs.promises.copyFile(srcPath, dest)
  return dest
}

// Recursively collect all document rows ({id, file_path}) under folderId
function collectDocsInSubtree(folderId: number): { id: number; file_path: string }[] {
  const docs = db
    .prepare('SELECT id, file_path FROM documents WHERE folder_id = ?')
    .all(folderId) as { id: number; file_path: string }[]
  const subs = db
    .prepare('SELECT id FROM folders WHERE parent_id = ?')
    .all(folderId) as { id: number }[]
  for (const s of subs) docs.push(...collectDocsInSubtree(s.id))
  return docs
}

// ── Vault watcher ─────────────────────────────────────────────────────────────

let vaultWatcher: FSWatcher | null = null

function stopVaultWatcher(): void {
  if (vaultWatcher) { vaultWatcher.close(); vaultWatcher = null }
}

function getFolderIdFromVaultPath(filePath: string): number | null {
  if (!settings.vaultPath) return null
  const normDir = normalizePath(dirname(filePath))
  const normVault = normalizePath(settings.vaultPath)
  if (normDir === normVault) return null
  const rel = normDir.startsWith(normVault) ? normDir.slice(normVault.length).replace(/^\//, '') : ''
  if (!rel) return null
  const parts = rel.split('/').filter(Boolean)
  let parentId: number | null = null
  for (const part of parts) {
    const folder = (parentId === null
      ? db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS NULL').get(sanitizeName(part))
      : db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id = ?').get(sanitizeName(part), parentId)
    ) as { id: number } | undefined
    if (!folder) return null
    parentId = folder.id
  }
  return parentId
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

function syncExternalFolderCreated(dirPath: string, win: BrowserWindow): void {
  if (!settings.vaultPath) return
  const normDir = normalizePath(dirPath)
  const normVault = normalizePath(settings.vaultPath)
  const rel = normDir.startsWith(normVault) ? normDir.slice(normVault.length).replace(/^\//, '') : ''
  if (!rel) return
  const parts = rel.split('/').filter(Boolean)
  const folderName = parts[parts.length - 1]

  let parentId: number | null = null
  for (const part of parts.slice(0, -1)) {
    const row = (parentId === null
      ? db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS NULL').get(part)
      : db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id = ?').get(part, parentId)
    ) as { id: number } | undefined
    if (!row) return
    parentId = row.id
  }

  const existing = (parentId === null
    ? db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS NULL').get(folderName)
    : db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id = ?').get(folderName, parentId)
  ) as { id: number } | undefined

  if (!existing) {
    db.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').run(folderName, parentId)
    win.webContents.send('vault-file-changed')
  }
}

function walkVault(dir: string): string[] {
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) results.push(...walkVault(full))
      else if (isSupportedFile(entry.name)) results.push(full)
    }
  } catch { /* skip unreadable dirs */ }
  return results
}

function findFileInVault(dir: string, filename: string): string | null {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = findFileInVault(full, filename)
        if (found) return found
      } else if (entry.name === filename) return full
    }
  } catch { /* skip */ }
  return null
}

function orphanDocsInFolder(folderId: number): void {
  db.prepare('UPDATE documents SET folder_id = NULL WHERE folder_id = ?').run(folderId)
  const subs = db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(folderId) as { id: number }[]
  for (const s of subs) {
    orphanDocsInFolder(s.id)
    db.prepare('DELETE FROM folders WHERE id = ?').run(s.id)
  }
}

function syncExternalFolderDeleted(dirPath: string, win: BrowserWindow): void {
  if (!settings.vaultPath) return
  const normDir = normalizePath(dirPath)
  const normVault = normalizePath(settings.vaultPath)
  const rel = normDir.startsWith(normVault) ? normDir.slice(normVault.length).replace(/^\//, '') : ''
  if (!rel) return
  const parts = rel.split('/').filter(Boolean)

  let folderId: number | null = null
  for (const part of parts) {
    const row = (folderId === null
      ? db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS NULL').get(part)
      : db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id = ?').get(part, folderId)
    ) as { id: number } | undefined
    if (!row) return
    folderId = row.id
  }
  if (folderId === null) return

  const folder = db.prepare('SELECT type_key FROM folders WHERE id = ?').get(folderId) as { type_key: string | null } | undefined
  if (folder?.type_key) return  // never delete system folders

  orphanDocsInFolder(folderId)
  db.prepare('DELETE FROM folders WHERE id = ?').run(folderId)
  win.webContents.send('vault-file-changed')
}

function syncExternalFileChange(rawPath: string, win: BrowserWindow): void {
  if (!settings.vaultPath) return
  // Normalize to OS-native separators so DB lookups match stored paths
  const fullPath = join(rawPath)
  if (fs.existsSync(fullPath)) {
    let stat: fs.Stats
    try { stat = fs.statSync(fullPath) } catch { return }

    if (stat.isDirectory()) {
      syncExternalFolderCreated(fullPath, win)
      return
    }

    if (!isSupportedFile(fullPath)) return
    const existing = db.prepare('SELECT id FROM documents WHERE file_path = ?').get(fullPath) as { id: number } | undefined
    if (!existing) {
      try {
        const ext = extname(fullPath)
        const title = basename(fullPath, ext)
        const folderId = getFolderIdFromVaultPath(fullPath)
        db.prepare('INSERT OR IGNORE INTO documents (title, file_path, file_size, folder_id) VALUES (?, ?, ?, ?)').run(title, fullPath, stat.size, folderId)
        win.webContents.send('vault-file-changed')
      } catch (e) { console.error('sync add error:', e) }
    }
  } else {
    const existingDoc = db.prepare('SELECT id FROM documents WHERE file_path = ?').get(fullPath) as { id: number } | undefined
    if (existingDoc) {
      db.prepare('DELETE FROM documents WHERE id = ?').run(existingDoc.id)
      win.webContents.send('vault-file-changed')
    } else {
      syncExternalFolderDeleted(fullPath, win)
    }
  }
}

function startVaultWatcher(win: BrowserWindow): void {
  stopVaultWatcher()
  if (!settings.vaultPath || !fs.existsSync(settings.vaultPath)) return
  const pending = new Map<string, ReturnType<typeof setTimeout>>()

  const schedule = (fullPath: string): void => {
    if (pending.has(fullPath)) clearTimeout(pending.get(fullPath)!)
    pending.set(fullPath, setTimeout(() => {
      pending.delete(fullPath)
      syncExternalFileChange(fullPath, win)
    }, 200))
  }

  try {
    vaultWatcher = chokidar.watch(settings.vaultPath, {
      ignoreInitial: true,
      depth: 10,
      usePolling: true,
      interval: 500,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    })
    vaultWatcher.on('add', schedule)
    vaultWatcher.on('unlink', schedule)
    vaultWatcher.on('addDir', schedule)
    vaultWatcher.on('unlinkDir', schedule)
  } catch (e) {
    console.error('vault watcher error:', e)
  }
}

// ── Database ──────────────────────────────────────────────────────────────────

function initDatabase(): void {
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      folder_id INTEGER,
      page_count INTEGER DEFAULT 0,
      file_size INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      opened_at TEXT,
      is_favorite INTEGER DEFAULT 0,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#378ADD'
    );

    CREATE TABLE IF NOT EXISTS document_tags (
      document_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (document_id, tag_id),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      page INTEGER NOT NULL,
      x REAL, y REAL, width REAL, height REAL,
      color TEXT DEFAULT '#FAEEDA',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      page INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      title, content, document_id UNINDEXED
    );

    CREATE TABLE IF NOT EXISTS text_highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      page INTEGER NOT NULL,
      rects TEXT NOT NULL,
      selected_text TEXT DEFAULT '',
      color TEXT DEFAULT '#ffe066',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
  `)
}

function migrateDatabase(): void {
  try { db.exec('ALTER TABLE folders ADD COLUMN type_key TEXT') } catch {}
  // 기존 시스템 폴더를 일반 폴더로 전환
  db.prepare('UPDATE folders SET type_key = NULL WHERE type_key IS NOT NULL').run()
}

// ── DB 파일 이름 마이그레이션 (pdf-vault.db → foldry.db) ─────────────────────

function migrateOldDatabase(): void {
  const oldDbPath = join(app.getPath('userData'), 'pdf-vault.db')
  if (!fs.existsSync(DB_PATH) && fs.existsSync(oldDbPath)) {
    try {
      fs.copyFileSync(oldDbPath, DB_PATH)
      // WAL/SHM 파일도 같이 복사
      const oldWal = oldDbPath + '-wal'
      const oldShm = oldDbPath + '-shm'
      if (fs.existsSync(oldWal)) fs.copyFileSync(oldWal, DB_PATH + '-wal')
      if (fs.existsSync(oldShm)) fs.copyFileSync(oldShm, DB_PATH + '-shm')
      console.log('DB migrated: pdf-vault.db → foldry.db')
    } catch (e) {
      console.error('DB migration error:', e)
    }
  }
}

// ── 앱 시작 시 볼트 폴더와 DB 동기화 ─────────────────────────────────────────

function walkDirs(dir: string): string[] {
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const full = join(dir, entry.name)
        results.push(full)
        results.push(...walkDirs(full))
      }
    }
  } catch { /* skip */ }
  return results
}

function syncVaultOnStartup(win: BrowserWindow): void {
  if (!settings.vaultPath || !fs.existsSync(settings.vaultPath)) return

  let changed = false

  // 1) 폴더 동기화: 디스크에 있지만 DB에 없는 폴더 추가
  const diskDirs = walkDirs(settings.vaultPath)
  for (const dirPath of diskDirs) {
    const normDir = normalizePath(dirPath)
    const normVault = normalizePath(settings.vaultPath)
    const rel = normDir.startsWith(normVault) ? normDir.slice(normVault.length).replace(/^\//, '') : ''
    if (!rel) continue
    const parts = rel.split('/').filter(Boolean)
    let parentId: number | null = null
    for (const part of parts) {
      const existing = (parentId === null
        ? db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS NULL').get(part)
        : db.prepare('SELECT id FROM folders WHERE name = ? AND parent_id = ?').get(part, parentId)
      ) as { id: number } | undefined
      if (existing) {
        parentId = existing.id
      } else {
        const info = db.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').run(part, parentId)
        parentId = info.lastInsertRowid as number
        changed = true
      }
    }
  }

  // 2) 폴더 동기화: DB에 있지만 디스크에 없는 폴더 제거
  const allFolders = db.prepare('SELECT id FROM folders').all() as { id: number }[]
  for (const folder of allFolders) {
    const rel = getFolderRelPath(folder.id)
    if (!rel) continue
    const absPath = join(settings.vaultPath, rel)
    if (!fs.existsSync(absPath)) {
      orphanDocsInFolder(folder.id)
      db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id)
      changed = true
    }
  }

  // 3) 파일 동기화: 디스크에 있지만 DB에 없는 파일 추가
  const diskFiles = walkVault(settings.vaultPath)
  for (const filePath of diskFiles) {
    const existing = db.prepare('SELECT id FROM documents WHERE file_path = ?').get(filePath) as { id: number } | undefined
    if (!existing) {
      try {
        const stat = fs.statSync(filePath)
        const ext = extname(filePath)
        const title = basename(filePath, ext)
        const folderId = getFolderIdFromVaultPath(filePath)
        db.prepare('INSERT OR IGNORE INTO documents (title, file_path, file_size, folder_id) VALUES (?, ?, ?, ?)').run(title, filePath, stat.size, folderId)
        changed = true
      } catch (e) { console.error('startup sync add error:', e) }
    }
  }

  // 4) 파일 동기화: DB에 있지만 디스크에 없는 파일 제거
  const diskSet = new Set(diskFiles.map(normalizePath))
  const allDocs = db.prepare('SELECT id, file_path FROM documents').all() as { id: number; file_path: string }[]
  for (const doc of allDocs) {
    // 볼트 경로 밖의 파일은 건드리지 않음
    if (!normalizePath(doc.file_path).startsWith(normalizePath(settings.vaultPath))) continue
    if (!diskSet.has(normalizePath(doc.file_path))) {
      db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id)
      changed = true
    }
  }

  if (changed) {
    win.webContents.send('vault-file-changed')
  }
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    show: false,
    title: 'Foldry',
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    setupAutoUpdater(mainWindow)
    syncVaultOnStartup(mainWindow)
    startVaultWatcher(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Import helper ─────────────────────────────────────────────────────────────

async function importFiles(srcPaths: string[], folderId: number | null, win?: BrowserWindow): Promise<object[]> {
  const imported: object[] = []
  const total = srcPaths.filter(isSupportedFile).length
  let current = 0

  for (const srcPath of srcPaths) {
    if (!isSupportedFile(srcPath)) continue
    current++
    const filename = basename(srcPath)
    win?.webContents.send('import-progress', { type: 'copying', filename, current, total })
    try {
      const stat = fs.statSync(srcPath)
      const ext = extname(srcPath)
      const title = basename(srcPath, ext)
      const storedPath = settings.vaultPath
        ? ((await copyToVault(srcPath, title, folderId)) ?? srcPath)
        : srcPath

      const existing = db.prepare('SELECT id, folder_id FROM documents WHERE file_path = ?')
        .get(storedPath) as { id: number; folder_id: number | null } | undefined

      if (existing) {
        if (existing.folder_id !== folderId) {
          db.prepare('UPDATE documents SET folder_id = ? WHERE id = ?').run(folderId, existing.id)
        }
        imported.push({ id: existing.id, title, filePath: storedPath })
      } else {
        const info = db.prepare(
          'INSERT INTO documents (title, file_path, file_size, folder_id) VALUES (?, ?, ?, ?)'
        ).run(title, storedPath, stat.size, folderId)
        imported.push({ id: info.lastInsertRowid, title, filePath: storedPath })
      }
    } catch (e) {
      console.error('importFiles error:', e)
    }
  }
  win?.webContents.send('import-progress', { type: 'done', total })
  return imported
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {

  // ── Vault settings ──────────────────────────────────────────────────────────

  ipcMain.handle('get-vault-path', () => settings.vaultPath ?? null)

  ipcMain.handle('set-vault-path', async () => {
    const result = await dialog.showOpenDialog({
      title: '보관 폴더 선택',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const newVaultPath = result.filePaths[0]
    const oldVaultPath = settings.vaultPath

    // 기존 vault가 있고 새 경로가 다를 때 → 파일/폴더 통째 이동
    const shouldMigrate =
      !!oldVaultPath &&
      oldVaultPath !== newVaultPath &&
      !newVaultPath.startsWith(oldVaultPath + sep) &&
      fs.existsSync(oldVaultPath)

    if (shouldMigrate && oldVaultPath) {
      // 1) 새 위치로 전체 복사
      copyDirSync(oldVaultPath, newVaultPath)

      // 2) DB file_path 접두사 일괄 교체
      const oldPrefix = oldVaultPath + sep
      const newPrefix = newVaultPath + sep
      const docs = db.prepare('SELECT id, file_path FROM documents').all() as {
        id: number; file_path: string
      }[]
      const upd = db.prepare('UPDATE documents SET file_path = ? WHERE id = ?')
      for (const doc of docs) {
        if (doc.file_path.startsWith(oldPrefix)) {
          upd.run(newPrefix + doc.file_path.slice(oldPrefix.length), doc.id)
        }
      }

      // 3) 기존 vault 삭제
      fs.rmSync(oldVaultPath, { recursive: true, force: true })
    }

    settings.vaultPath = newVaultPath
    saveSettings(settings)
    fs.mkdirSync(newVaultPath, { recursive: true })
    const win = BrowserWindow.getFocusedWindow()
    if (win) startVaultWatcher(win)
    return newVaultPath
  })

  // 탐색기에서 파일 위치 열기
  ipcMain.handle('show-item-in-folder', (_e, filePath: string) => {
    // 파일이 존재하면 선택 상태로, 없으면 부모 폴더라도 열기
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    } else {
      const parent = dirname(filePath)
      if (fs.existsSync(parent)) {
        shell.openPath(parent)
      }
    }
  })

  // ── Import PDF (dialog) ─────────────────────────────────────────────────────

  ipcMain.handle('import-pdf', async (_e, folderId?: number | null) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '모든 지원 파일', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mp3', 'wav', 'aiff', 'alac', 'flac', 'm4a', 'ogg', 'aac', 'txt', 'md', 'docx', 'hwp', 'xlsx', 'xls', 'pptx', 'ppt', 'pages', 'numbers', 'key', 'csv', 'odt', 'ods', 'odp'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
        { name: '동영상', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'] },
        { name: '음원', extensions: ['mp3', 'wav', 'aiff', 'alac', 'flac', 'm4a', 'ogg', 'aac'] },
        { name: '문서', extensions: ['txt', 'md', 'docx', 'hwp', 'pages', 'odt'] },
        { name: '스프레드시트', extensions: ['xlsx', 'xls', 'csv', 'numbers', 'ods'] },
        { name: '프레젠테이션', extensions: ['pptx', 'ppt', 'key', 'odp'] },
      ]
    })
    if (result.canceled) return []
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    return importFiles(result.filePaths, folderId ?? null, win)
  })

  // ── Import PDF (paths, e.g. drag-drop) ─────────────────────────────────────

  ipcMain.handle('import-pdf-paths', async (_e, filePaths: string[], folderId?: number | null) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    return importFiles(filePaths, folderId ?? null, win)
  })

  // ── Import folders (drag-drop directories) ────────────────────────────────

  ipcMain.handle('import-folder-paths', async (_e, folderPaths: string[], parentFolderId?: number | null) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

    async function importDir(dirPath: string, parentId: number | null): Promise<void> {
      const dirName = basename(dirPath)
      const stmt = db.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)')
      const info = stmt.run(dirName, parentId)
      const folderId = info.lastInsertRowid as number
      if (settings.vaultPath) {
        try { ensureVaultDir(folderId) } catch (_) { /* ignore */ }
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      const files: string[] = []
      const subdirs: string[] = []
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = join(dirPath, entry.name)
        if (entry.isDirectory()) subdirs.push(fullPath)
        else if (isSupportedFile(fullPath)) files.push(fullPath)
      }

      if (files.length > 0) await importFiles(files, folderId, win)
      for (const sub of subdirs) await importDir(sub, folderId)
    }

    for (const fp of folderPaths) {
      try { await importDir(fp, parentFolderId ?? null) } catch (e) { console.error('import-folder error:', e) }
    }
    win?.webContents.send('vault-file-changed')
  })

  // ── Documents ───────────────────────────────────────────────────────────────

  ipcMain.handle('get-documents', (_e, folderId?: number, options?: {
    sortBy?: string; view?: string; limit?: number; offset?: number
  }) => {
    const { sortBy = 'opened', view, limit = 500, offset = 0 } = options ?? {}

    const orderClause =
      sortBy === 'title'   ? "title COLLATE NOCASE ASC" :
      sortBy === 'created' ? "created_at DESC" :
      sortBy === 'size'    ? "file_size DESC" :
      sortBy === 'pages'   ? "page_count DESC" :
      "CASE WHEN opened_at IS NULL THEN 1 ELSE 0 END, opened_at DESC, created_at DESC"

    const where: string[] = []
    if (folderId)             where.push(`folder_id = ${folderId}`)
    if (view === 'favorites') where.push('is_favorite = 1')
    if (view === 'recent')    where.push("opened_at > datetime('now', '-14 days')")

    const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return db.prepare(`SELECT * FROM documents ${whereStr} ORDER BY ${orderClause} LIMIT ? OFFSET ?`).all(limit, offset)
  })

  ipcMain.handle('search-documents', (_e, query: string) => {
    const titleMatches = db
      .prepare('SELECT * FROM documents WHERE title LIKE ? ORDER BY opened_at DESC')
      .all(`%${query}%`) as { id: number }[]
    try {
      // 영문·숫자·한글만 남기고 나머지는 공백으로 치환 (FTS5 특수문자 오류 방지)
      const ftsQuery = query.replace(/[^a-zA-Z0-9가-힣\s]/g, ' ').trim()
        .split(/\s+/).filter(Boolean).map(w => `${w}*`).join(' ')
      if (!ftsQuery) return titleMatches
      const contentMatches = db.prepare(`
        SELECT d.* FROM documents d
        INNER JOIN documents_fts fts ON d.id = fts.document_id
        WHERE documents_fts MATCH ?
        ORDER BY d.opened_at DESC
      `).all(ftsQuery) as { id: number }[]
      const seen = new Set(titleMatches.map(d => d.id))
      const merged = [...titleMatches]
      for (const doc of contentMatches) {
        if (!seen.has(doc.id)) { seen.add(doc.id); merged.push(doc) }
      }
      return merged
    } catch (e) {
      console.error('FTS search error:', e)
      return titleMatches
    }
  })

  ipcMain.handle('update-opened', (_e, documentId: number) => {
    db.prepare("UPDATE documents SET opened_at = datetime('now') WHERE id = ?").run(documentId)
  })

  ipcMain.handle('toggle-favorite', (_e, documentId: number) => {
    db.prepare('UPDATE documents SET is_favorite = NOT is_favorite WHERE id = ?').run(documentId)
  })

  ipcMain.handle('rename-document', (_e, documentId: number, title: string) => {
    if (settings.vaultPath) {
      const doc = db
        .prepare('SELECT id, file_path, folder_id FROM documents WHERE id = ?')
        .get(documentId) as { id: number; file_path: string; folder_id: number | null } | undefined
      if (doc && doc.file_path.startsWith(settings.vaultPath)) {
        try {
          const dir = dirname(doc.file_path)
          const ext = extname(doc.file_path) || '.pdf'
          const dest = uniquePath(dir, title, ext, doc.file_path)
          if (fs.existsSync(doc.file_path)) fs.renameSync(doc.file_path, dest)
          db.prepare('UPDATE documents SET title = ?, file_path = ? WHERE id = ?').run(
            title, dest, documentId
          )
          return
        } catch (e) {
          console.error('rename-document file error:', e)
        }
      }
    }
    db.prepare('UPDATE documents SET title = ? WHERE id = ?').run(title, documentId)
  })

  ipcMain.handle('move-document', (_e, documentId: number, folderId: number | null) => {
    if (settings.vaultPath) {
      const doc = db
        .prepare('SELECT id, file_path, title FROM documents WHERE id = ?')
        .get(documentId) as { id: number; file_path: string; title: string } | undefined
      if (doc && doc.file_path.startsWith(settings.vaultPath)) {
        try {
          const dir = ensureVaultDir(folderId)
          if (dir) {
            const ext = extname(doc.file_path) || '.pdf'
            const dest = uniquePath(dir, doc.title, ext, doc.file_path)
            if (fs.existsSync(doc.file_path) && doc.file_path !== dest) {
              fs.renameSync(doc.file_path, dest)
            }
            db.prepare('UPDATE documents SET folder_id = ?, file_path = ? WHERE id = ?').run(
              folderId, dest, documentId
            )
            return
          }
        } catch (e) {
          console.error('move-document file error:', e)
        }
      }
    }
    db.prepare('UPDATE documents SET folder_id = ? WHERE id = ?').run(folderId, documentId)
  })

  ipcMain.handle('delete-document', (_e, documentId: number) => {
    if (settings.vaultPath) {
      const doc = db
        .prepare('SELECT id, file_path FROM documents WHERE id = ?')
        .get(documentId) as { id: number; file_path: string } | undefined
      if (doc && doc.file_path.startsWith(settings.vaultPath)) {
        try {
          if (fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path)
        } catch (e) {
          console.error('delete-document file error:', e)
        }
      }
    }
    db.prepare('DELETE FROM documents WHERE id = ?').run(documentId)
  })

  ipcMain.handle('get-document-tags', (_e, documentId: number) => {
    return db
      .prepare('SELECT t.* FROM tags t JOIN document_tags dt ON t.id = dt.tag_id WHERE dt.document_id = ?')
      .all(documentId)
  })

  ipcMain.handle('add-document-tag', (_e, documentId: number, tagId: number) => {
    db.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)').run(documentId, tagId)
  })

  ipcMain.handle('remove-document-tag', (_e, documentId: number, tagId: number) => {
    db.prepare('DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?').run(documentId, tagId)
  })

  ipcMain.handle('get-documents-by-tags', (_e, tagIds: number[]) => {
    if (!tagIds.length) return []
    const placeholders = tagIds.map(() => '?').join(',')
    return db.prepare(`
      SELECT DISTINCT d.* FROM documents d
      JOIN document_tags dt ON d.id = dt.document_id
      WHERE dt.tag_id IN (${placeholders})
      ORDER BY d.opened_at DESC, d.created_at DESC
    `).all(...tagIds)
  })

  ipcMain.handle('get-documents-by-tag', (_e, tagId: number) => {
    return db
      .prepare(`SELECT d.* FROM documents d
        JOIN document_tags dt ON d.id = dt.document_id
        WHERE dt.tag_id = ?
        ORDER BY d.opened_at DESC, d.created_at DESC`)
      .all(tagId)
  })

  ipcMain.handle('update-page-count', (_e, documentId: number, pageCount: number) => {
    db.prepare('UPDATE documents SET page_count = ? WHERE id = ?').run(pageCount, documentId)
  })

  ipcMain.handle('index-pdf-content', (_e, documentId: number, content: string) => {
    const row = db.prepare('SELECT title FROM documents WHERE id = ?').get(documentId) as { title: string } | undefined
    if (!row) return
    db.prepare('INSERT OR REPLACE INTO documents_fts (document_id, title, content) VALUES (?, ?, ?)').run(documentId, row.title, content)
  })

  ipcMain.handle('get-text-highlights', (_e, documentId: number) => {
    return db.prepare('SELECT * FROM text_highlights WHERE document_id = ? ORDER BY page, created_at').all(documentId)
  })

  ipcMain.handle('add-text-highlight', (_e, documentId: number, page: number, rects: string, selectedText: string, color: string) => {
    const info = db.prepare(
      'INSERT INTO text_highlights (document_id, page, rects, selected_text, color) VALUES (?, ?, ?, ?, ?)'
    ).run(documentId, page, rects, selectedText, color)
    return { id: info.lastInsertRowid, document_id: documentId, page, rects, selected_text: selectedText, color }
  })

  ipcMain.handle('delete-text-highlight', (_e, highlightId: number) => {
    db.prepare('DELETE FROM text_highlights WHERE id = ?').run(highlightId)
  })

  ipcMain.handle('read-pdf-buffer', (_e, filePath: string) => {
    return fs.readFileSync(filePath)
  })

  // ── Folders ─────────────────────────────────────────────────────────────────

  ipcMain.handle('get-folders', () => {
    return db.prepare('SELECT * FROM folders ORDER BY name').all()
  })

  ipcMain.handle('create-folder', (_e, name: string, parentId?: number) => {
    const stmt = db.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)')
    const info = stmt.run(name, parentId ?? null)
    const folderId = info.lastInsertRowid as number

    if (settings.vaultPath) {
      try {
        ensureVaultDir(folderId)
      } catch (e) {
        console.error('create-folder dir error:', e)
      }
    }
    return { id: folderId, name, parent_id: parentId ?? null, type_key: null }
  })

  ipcMain.handle('move-folder', (_e, folderId: number, newParentId: number | null) => {
    // 순환 참조 방지 (자기 자신이나 자손에게 이동 불가)
    function isDescendant(id: number | null): boolean {
      if (id === null) return false
      if (id === folderId) return true
      const row = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(id) as { parent_id: number | null } | undefined
      return row ? isDescendant(row.parent_id) : false
    }
    if (isDescendant(newParentId)) return

    if (settings.vaultPath) {
      try {
        const oldRel = getFolderRelPath(folderId)
        const oldAbs = oldRel ? join(settings.vaultPath, oldRel) : null

        db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(newParentId, folderId)

        const newRel = getFolderRelPath(folderId)
        const newAbs = newRel ? join(settings.vaultPath, newRel) : null

        if (oldAbs && newAbs && oldAbs !== newAbs && fs.existsSync(oldAbs) && !fs.existsSync(newAbs)) {
          fs.mkdirSync(dirname(newAbs), { recursive: true })
          fs.renameSync(oldAbs, newAbs)

          const prefix = oldAbs + sep
          const docs = db.prepare('SELECT id, file_path FROM documents').all() as { id: number; file_path: string }[]
          const upd = db.prepare('UPDATE documents SET file_path = ? WHERE id = ?')
          for (const doc of docs) {
            if (doc.file_path.startsWith(prefix)) {
              upd.run(newAbs + sep + doc.file_path.slice(prefix.length), doc.id)
            }
          }
        }
      } catch (e) {
        console.error('move-folder error:', e)
      }
      return
    }
    db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(newParentId, folderId)
  })

  ipcMain.handle('rename-folder', (_e, folderId: number, name: string) => {
    if (settings.vaultPath) {
      try {
        const oldRel = getFolderRelPath(folderId)
        const oldAbs = join(settings.vaultPath, oldRel)

        db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folderId)

        const newRel = getFolderRelPath(folderId)
        const newAbs = join(settings.vaultPath, newRel)

        if (oldRel && oldAbs !== settings.vaultPath && fs.existsSync(oldAbs)) fs.renameSync(oldAbs, newAbs)

        // Update file_path for all documents that lived inside this folder tree
        const prefix = oldAbs + sep
        const docs = db.prepare('SELECT id, file_path FROM documents').all() as {
          id: number; file_path: string
        }[]
        const upd = db.prepare('UPDATE documents SET file_path = ? WHERE id = ?')
        for (const doc of docs) {
          if (doc.file_path.startsWith(prefix)) {
            upd.run(newAbs + sep + doc.file_path.slice(prefix.length), doc.id)
          }
        }
        return
      } catch (e) {
        console.error('rename-folder error:', e)
      }
    }
    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folderId)
  })

  ipcMain.handle('delete-folder', (_e, folderId: number) => {
    if (settings.vaultPath) {
      try {
        const folderRel = getFolderRelPath(folderId)
        const folderAbs = folderRel ? join(settings.vaultPath, folderRel) : null
        const docs = collectDocsInSubtree(folderId)
        const upd = db.prepare('UPDATE documents SET file_path = ? WHERE id = ?')

        // Move every file in the subtree back to vault root
        for (const doc of docs) {
          if (doc.file_path.startsWith(settings.vaultPath + sep) && fs.existsSync(doc.file_path)) {
            const docExt = extname(doc.file_path) || '.pdf'
            const dest = uniquePath(settings.vaultPath, basename(doc.file_path, docExt), docExt, doc.file_path)
            if (doc.file_path !== dest) fs.renameSync(doc.file_path, dest)
            upd.run(dest, doc.id)
          }
        }

        // Remove the now-empty folder tree (never touch vault root)
        if (folderAbs && folderAbs !== settings.vaultPath && fs.existsSync(folderAbs)) {
          fs.rmSync(folderAbs, { recursive: true })
        }
      } catch (e) {
        console.error('delete-folder error:', e)
      }
    }
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId)
  })

  // ── Tags ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('get-tags', () => {
    return db.prepare('SELECT * FROM tags ORDER BY name').all()
  })

  ipcMain.handle('create-tag', (_e, name: string, color: string) => {
    const stmt = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)')
    const info = stmt.run(name, color)
    return { id: info.lastInsertRowid, name, color }
  })

  ipcMain.handle('delete-tag', (_e, tagId: number) => {
    db.prepare('DELETE FROM tags WHERE id = ?').run(tagId)
  })

  ipcMain.handle('rename-tag', (_e, tagId: number, name: string) => {
    db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, tagId)
  })

  // ── Memos ────────────────────────────────────────────────────────────────────

  ipcMain.handle('add-memo', (_e, documentId: number, page: number, content: string) => {
    const stmt = db.prepare('INSERT INTO memos (document_id, page, content) VALUES (?, ?, ?)')
    const info = stmt.run(documentId, page, content)
    return { id: info.lastInsertRowid, document_id: documentId, page, content }
  })

  ipcMain.handle('get-memos', (_e, documentId: number) => {
    return db.prepare('SELECT * FROM memos WHERE document_id = ? ORDER BY page').all(documentId)
  })

  ipcMain.handle('delete-memo', (_e, memoId: number) => {
    db.prepare('DELETE FROM memos WHERE id = ?').run(memoId)
  })

  ipcMain.handle('read-text-file', (_e, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle('open-external-file', (_e, filePath: string) => {
    shell.openPath(filePath)
  })

  ipcMain.handle('repair-vault', async () => {
    if (!settings.vaultPath) return { fixed: 0, added: 0 }
    let fixed = 0, added = 0

    // 1) DB에 있지만 파일이 실제로 없는 레코드 → 볼트 전체에서 동일 파일명으로 검색해 경로 수정
    const allDocs = db.prepare('SELECT id, title, file_path FROM documents').all() as { id: number; title: string; file_path: string }[]
    for (const doc of allDocs) {
      if (fs.existsSync(doc.file_path)) continue
      // 볼트 안에서 같은 파일명 검색
      const found = findFileInVault(settings.vaultPath, basename(doc.file_path))
      if (found) {
        const folderId = getFolderIdFromVaultPath(found)
        db.prepare('UPDATE documents SET file_path = ?, folder_id = ? WHERE id = ?').run(found, folderId, doc.id)
        fixed++
      }
    }

    // 2) 볼트 안에 있지만 DB에 없는 파일 → 새로 추가
    const vaultFiles = walkVault(settings.vaultPath)
    for (const filePath of vaultFiles) {
      const existing = db.prepare('SELECT id FROM documents WHERE file_path = ?').get(filePath)
      if (!existing) {
        try {
          const stat = fs.statSync(filePath)
          const ext = extname(filePath)
          const title = basename(filePath, ext)
          const folderId = getFolderIdFromVaultPath(filePath)
          db.prepare('INSERT OR IGNORE INTO documents (title, file_path, file_size, folder_id) VALUES (?, ?, ?, ?)').run(title, filePath, stat.size, folderId)
          added++
        } catch { /* skip */ }
      }
    }

    return { fixed, added }
  })

  ipcMain.handle('check-for-updates', () => {
    if (is.dev) {
      BrowserWindow.getAllWindows()[0]?.webContents.send('update-status', { type: 'not-available' })
      return
    }
    autoUpdater.checkForUpdates()
  })

  ipcMain.handle('download-update', () => {
    autoUpdater.downloadUpdate()
  })

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall()
  })
}

// ── Auto updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    win.webContents.send('update-status', { type: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update-status', { type: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    win.webContents.send('update-status', { type: 'not-available' })
  })
  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('update-status', { type: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('update-status', { type: 'downloaded' })
  })
  autoUpdater.on('error', (err) => {
    win.webContents.send('update-status', { type: 'error', message: err.message })
  })

}

// ── Application menu (Korean) ─────────────────────────────────────────────────

function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: (Electron.MenuItemConstructorOptions | MenuItem)[] = [
    // macOS: 앱 이름 메뉴
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { label: `${app.getName()} 정보`, role: 'about' as const },
        { type: 'separator' as const },
        { label: '서비스', role: 'services' as const },
        { type: 'separator' as const },
        { label: `${app.getName()} 숨기기`, role: 'hide' as const },
        { label: '다른 앱 숨기기', role: 'hideOthers' as const },
        { label: '모두 보이기', role: 'unhide' as const },
        { type: 'separator' as const },
        { label: '종료', role: 'quit' as const }
      ]
    }] : []),

    // 파일
    {
      label: '파일',
      submenu: [
        {
          label: 'PDF 가져오기...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send('menu-import')
          }
        },
        { type: 'separator' },
        {
          label: '설정',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send('menu-settings')
          }
        },
        { type: 'separator' },
        isMac
          ? { label: '닫기', role: 'close' as const }
          : { label: '종료', role: 'quit' as const }
      ]
    },

    // 편집
    {
      label: '편집',
      submenu: [
        { label: '실행 취소', role: 'undo' as const },
        { label: '다시 실행', role: 'redo' as const },
        { type: 'separator' },
        { label: '잘라내기', role: 'cut' as const },
        { label: '복사', role: 'copy' as const },
        { label: '붙여넣기', role: 'paste' as const },
        { label: '전체 선택', role: 'selectAll' as const }
      ]
    },

    // 보기
    {
      label: '보기',
      submenu: [
        { label: '새로 고침', role: 'reload' as const },
        { label: '강제 새로 고침', role: 'forceReload' as const },
        { label: '개발자 도구', role: 'toggleDevTools' as const },
        { type: 'separator' },
        { label: '실제 크기', role: 'resetZoom' as const },
        { label: '확대', role: 'zoomIn' as const },
        { label: '축소', role: 'zoomOut' as const },
        { type: 'separator' },
        { label: '전체 화면', role: 'togglefullscreen' as const }
      ]
    },

    // 창
    {
      label: '창',
      submenu: [
        { label: '최소화', role: 'minimize' as const },
        { label: '최대화 / 복원', click: () => {
          const win = BrowserWindow.getFocusedWindow()
          if (!win) return
          win.isMaximized() ? win.unmaximize() : win.maximize()
        }},
        { type: 'separator' },
        { label: '맨 앞으로 가져오기', role: 'front' as const }
      ]
    },

    // 도움말
    {
      label: '도움말',
      submenu: [
        {
          label: 'Foldry 정보',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'Foldry 정보',
              message: 'Foldry',
              detail: `버전: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}`
            })
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.foldry')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  settings = loadSettings()
  migrateOldDatabase()
  initDatabase()
  migrateDatabase()
  registerIpcHandlers()
  buildMenu()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db?.close()
    app.quit()
  }
})
