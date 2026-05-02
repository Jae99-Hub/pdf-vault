import { contextBridge, ipcRenderer, webUtils } from 'electron'

interface UpdateStatus {
  type: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

contextBridge.exposeInMainWorld('api', {
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-import', () => callback('import'))
    ipcRenderer.on('menu-settings', () => callback('settings'))
  },
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    ipcRenderer.on('update-status', (_e, status) => callback(status))
  },
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getVaultPath: () => ipcRenderer.invoke('get-vault-path'),
  setVaultPath: () => ipcRenderer.invoke('set-vault-path'),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),
  updatePageCount: (documentId: number, pageCount: number) => ipcRenderer.invoke('update-page-count', documentId, pageCount),
  indexPdfContent: (documentId: number, content: string) => ipcRenderer.invoke('index-pdf-content', documentId, content),
  importPdf: () => ipcRenderer.invoke('import-pdf'),
  getDocuments: (folderId?: number) => ipcRenderer.invoke('get-documents', folderId),
  getFolders: () => ipcRenderer.invoke('get-folders'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  createFolder: (name: string, parentId?: number) => ipcRenderer.invoke('create-folder', name, parentId),
  getTags: () => ipcRenderer.invoke('get-tags'),
  createTag: (name: string, color: string) => ipcRenderer.invoke('create-tag', name, color),
  updateOpened: (documentId: number) => ipcRenderer.invoke('update-opened', documentId),
  toggleFavorite: (documentId: number) => ipcRenderer.invoke('toggle-favorite', documentId),
  addMemo: (documentId: number, page: number, content: string) => ipcRenderer.invoke('add-memo', documentId, page, content),
  getMemos: (documentId: number) => ipcRenderer.invoke('get-memos', documentId),
  searchDocuments: (query: string) => ipcRenderer.invoke('search-documents', query),
  readPdfBuffer: (filePath: string) => ipcRenderer.invoke('read-pdf-buffer', filePath),
  moveDocument: (documentId: number, folderId: number | null) => ipcRenderer.invoke('move-document', documentId, folderId),
  deleteDocument: (documentId: number) => ipcRenderer.invoke('delete-document', documentId),
  renameDocument: (documentId: number, title: string) => ipcRenderer.invoke('rename-document', documentId, title),
  getDocumentTags: (documentId: number) => ipcRenderer.invoke('get-document-tags', documentId),
  addDocumentTag: (documentId: number, tagId: number) => ipcRenderer.invoke('add-document-tag', documentId, tagId),
  getDocumentsByTag: (tagId: number) => ipcRenderer.invoke('get-documents-by-tag', tagId),
  deleteMemo: (memoId: number) => ipcRenderer.invoke('delete-memo', memoId),
  removeDocumentTag: (documentId: number, tagId: number) => ipcRenderer.invoke('remove-document-tag', documentId, tagId),
  deleteFolder: (folderId: number) => ipcRenderer.invoke('delete-folder', folderId),
renameFolder: (folderId: number, name: string) => ipcRenderer.invoke('rename-folder', folderId, name),
deleteTag: (tagId: number) => ipcRenderer.invoke('delete-tag', tagId),
renameTag: (tagId: number, name: string) => ipcRenderer.invoke('rename-tag', tagId, name),
importPdfPaths: (filePaths: string[], folderId?: number | null) => ipcRenderer.invoke('import-pdf-paths', filePaths, folderId),
getDocumentsByTags: (tagIds: number[]) => ipcRenderer.invoke('get-documents-by-tags', tagIds),
getTextHighlights: (documentId: number) => ipcRenderer.invoke('get-text-highlights', documentId),
addTextHighlight: (documentId: number, page: number, rects: string, selectedText: string, color: string) => ipcRenderer.invoke('add-text-highlight', documentId, page, rects, selectedText, color),
deleteTextHighlight: (highlightId: number) => ipcRenderer.invoke('delete-text-highlight', highlightId),
readTextFile: (filePath: string) => ipcRenderer.invoke('read-text-file', filePath),
openExternalFile: (filePath: string) => ipcRenderer.invoke('open-external-file', filePath),
onVaultChanged: (callback: () => void) => { ipcRenderer.on('vault-file-changed', () => callback()) },
})