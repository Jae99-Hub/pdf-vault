export interface Folder {
  id: number
  name: string
  parent_id: number | null
  created_at: string
}

export interface Document {
  id: number
  title: string
  file_path: string
  folder_id: number | null
  page_count: number
  file_size: number
  created_at: string
  opened_at: string | null
  is_favorite: number
}

export interface Tag {
  id: number
  name: string
  color: string
}

export interface TextHighlight {
  id: number
  document_id: number
  page: number
  rects: string
  selected_text: string
  color: string
  created_at: string
}

export interface Memo {
  id: number
  document_id: number
  page: number
  content: string
  created_at: string
}

export interface UpdateStatus {
  type: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

export interface ApiType {
  onMenuAction: (callback: (action: string) => void) => void
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => void
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  getDocumentsByTags: (tagIds: number[]) => Promise<Document[]>
  getTextHighlights: (documentId: number) => Promise<TextHighlight[]>
  addTextHighlight: (documentId: number, page: number, rects: string, selectedText: string, color: string) => Promise<TextHighlight>
  deleteTextHighlight: (highlightId: number) => Promise<void>
  getVaultPath: () => Promise<string | null>
  setVaultPath: () => Promise<string | null>
  showItemInFolder: (filePath: string) => Promise<void>
  updatePageCount: (documentId: number, pageCount: number) => Promise<void>
  indexPdfContent: (documentId: number, content: string) => Promise<void>
  importPdf: () => Promise<{ id: number; title: string; filePath: string }[]>
  getDocuments: (folderId?: number) => Promise<Document[]>
  getFolders: () => Promise<Folder[]>
  createFolder: (name: string, parentId?: number) => Promise<Folder>
  getTags: () => Promise<Tag[]>
  createTag: (name: string, color: string) => Promise<Tag>
  updateOpened: (documentId: number) => Promise<void>
  toggleFavorite: (documentId: number) => Promise<void>
  addMemo: (documentId: number, page: number, content: string) => Promise<Memo>
  getMemos: (documentId: number) => Promise<Memo[]>
  searchDocuments: (query: string) => Promise<Document[]>
  readPdfBuffer: (filePath: string) => Promise<Buffer>
  moveDocument: (documentId: number, folderId: number | null) => Promise<void>
  deleteDocument: (documentId: number) => Promise<void>
  renameDocument: (documentId: number, title: string) => Promise<void>
  getDocumentTags: (documentId: number) => Promise<Tag[]>
  addDocumentTag: (documentId: number, tagId: number) => Promise<void>
  removeDocumentTag: (documentId: number, tagId: number) => Promise<void>
  getDocumentsByTag: (tagId: number) => Promise<Document[]>
  deleteMemo: (memoId: number) => Promise<void>
  deleteFolder: (folderId: number) => Promise<void>
renameFolder: (folderId: number, name: string) => Promise<void>
importPdfPaths: (filePaths: string[], folderId?: number | null) => Promise<object[]>
deleteTag: (tagId: number) => Promise<void>
renameTag: (tagId: number, name: string) => Promise<void>
getPathForFile: (file: File) => string
}

declare global {
  interface Window {
    api: ApiType
  }
}