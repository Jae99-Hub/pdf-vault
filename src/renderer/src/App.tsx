import React, { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar'
import DocumentList from './components/DocumentList'
import PdfViewer from './components/PdfViewer'
import Settings from './components/Settings'
import { Document, Folder, Tag } from './types'
import { useTheme } from './ThemeContext'
import './assets/main.css'

function isSupportedFile(name: string): boolean {
  return /\.(pdf|jpg|jpeg|png|gif|bmp|webp|mp4|mkv|avi|mov|wmv|flv|webm|m4v|mp3|wav|aiff|alac|flac|m4a|ogg|aac|txt|md|docx|hwp)$/i.test(name)
}

function App(): React.ReactElement {
  const C = useTheme()
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<number | undefined>(undefined)
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [view, setView] = useState<'all' | 'favorites' | 'recent'>('all')
  const [draggingDoc, setDraggingDoc] = useState<Document | null>(null)
  const [draggingDocs, setDraggingDocs] = useState<Document[]>([])
  const [reloadTrigger, setReloadTrigger] = useState(0)
  const [isDroppingFile, setIsDroppingFile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isFirstTime, setIsFirstTime] = useState(false)
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null)
  const dragCountRef = useRef(0)

  const reload = useCallback(() => setReloadTrigger(t => t + 1), [])

  useEffect(() => {
    window.api.getFolders().then(setFolders)
    window.api.getTags().then(setTags)
    window.api.getVaultPath().then((p) => {
      if (!p) { setIsFirstTime(true); setShowSettings(true) }
    })
    window.api.onMenuAction((action) => {
      if (action === 'import') handleImport()
      if (action === 'settings') { setIsFirstTime(false); setShowSettings(true) }
    })
    window.api.onVaultChanged(() => reload())
  }, [])

  useEffect(() => {
    const resetDrag = () => {
      dragCountRef.current = 0
      setIsDroppingFile(false)
      setDraggingDoc(null)
      setDraggingDocs([])
    }
    window.addEventListener('dragend', resetDrag)
    window.addEventListener('drop', resetDrag)
    return () => {
      window.removeEventListener('dragend', resetDrag)
      window.removeEventListener('drop', resetDrag)
    }
  }, [])

  useEffect(() => {
    async function load(): Promise<void> {
      if (selectedTagIds.length > 0) {
        const data = await window.api.getDocumentsByTags(selectedTagIds)
        setDocuments(data)
        return
      }
      const data = await window.api.getDocuments(selectedFolderId)
      if (view === 'favorites') {
        setDocuments(data.filter((d) => d.is_favorite === 1))
      } else if (view === 'recent') {
        const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
        setDocuments(data.filter(d => d.opened_at && new Date(d.opened_at) > cutoff))
      } else {
        setDocuments(data)
      }
    }
    load()
  }, [selectedFolderId, selectedTagIds, view, reloadTrigger])

  async function handleImport(): Promise<void> {
    let targetFolderId: number | null = selectedFolderId ?? null
    if (!targetFolderId && selectedFileType) {
      const sf = folders.find(f => f.type_key === selectedFileType)
      if (sf) targetFolderId = sf.id
    }
    await window.api.importPdf(targetFolderId)
    reload()
  }

  async function handleSearch(q: string): Promise<void> {
    setSearchQuery(q)
    if (q.trim() === '') {
      reload()
    } else {
      const result = await window.api.searchDocuments(q)
      setDocuments(result)
    }
  }

  async function handleSelectDoc(doc: Document): Promise<void> {
    setSelectedDoc(doc)
    await window.api.updateOpened(doc.id)
  }

  async function handleCreateFolder(name: string, parentId?: number): Promise<void> {
    await window.api.createFolder(name, parentId)
    window.api.getFolders().then(setFolders)
  }

  async function handleCreateTag(name: string, color: string): Promise<void> {
    await window.api.createTag(name, color)
    window.api.getTags().then(setTags)
  }

  async function handleToggleFavorite(doc: Document): Promise<void> {
    await window.api.toggleFavorite(doc.id)
    reload()
  }

  async function handleMoveDocument(doc: Document, folderId: number | null): Promise<void> {
    await window.api.moveDocument(doc.id, folderId)
    reload()
  }

  async function handleDropToFolder(folderId: number | null): Promise<void> {
    const docs = draggingDocs.length > 0 ? draggingDocs : (draggingDoc ? [draggingDoc] : [])
    if (docs.length === 0) return
    for (const doc of docs) await window.api.moveDocument(doc.id, folderId)
    setDraggingDoc(null)
    setDraggingDocs([])
    reload()
  }

  async function handleDeleteDocument(doc: Document): Promise<void> {
    await window.api.deleteDocument(doc.id)
    if (selectedDoc?.id === doc.id) setSelectedDoc(null)
    reload()
  }

  function handlePageCountUpdate(docId: number, pageCount: number): void {
    setDocuments(docs => docs.map(d => d.id === docId ? { ...d, page_count: pageCount } : d))
  }

  async function handleRenameDocument(doc: Document, title: string): Promise<void> {
    await window.api.renameDocument(doc.id, title)
    reload()
  }

  async function handleBulkDelete(docs: Document[]): Promise<void> {
    for (const doc of docs) {
      await window.api.deleteDocument(doc.id)
    }
    if (docs.find(d => d.id === selectedDoc?.id)) setSelectedDoc(null)
    reload()
  }

  async function handleBulkMove(docs: Document[], folderId: number | null): Promise<void> {
    for (const doc of docs) {
      await window.api.moveDocument(doc.id, folderId)
    }
    reload()
  }

  async function handleDeleteFolder(folderId: number): Promise<void> {
    await window.api.deleteFolder(folderId)
    if (selectedFolderId === folderId) setSelectedFolderId(undefined)
    window.api.getFolders().then(setFolders)
    reload()
  }

  async function handleRenameFolder(folderId: number, name: string): Promise<void> {
    await window.api.renameFolder(folderId, name)
    window.api.getFolders().then(setFolders)
  }

  async function handleDeleteTag(tagId: number): Promise<void> {
    await window.api.deleteTag(tagId)
    if (selectedTagIds.includes(tagId)) setSelectedTagIds(prev => prev.filter(id => id !== tagId))
    window.api.getTags().then(setTags)
    reload()
  }

  async function handleRenameTag(tagId: number, name: string): Promise<void> {
    await window.api.renameTag(tagId, name)
    window.api.getTags().then(setTags)
  }

  function handleWindowDragEnter(e: React.DragEvent): void {
    if (draggingDoc) return
    const hasFiles = Array.from(e.dataTransfer.types).includes('Files')
    if (!hasFiles) return
    e.preventDefault()
    dragCountRef.current++
    setIsDroppingFile(true)
  }

  function handleWindowDragOver(e: React.DragEvent): void {
    if (draggingDoc) return
    const hasFiles = Array.from(e.dataTransfer.types).includes('Files')
    if (!hasFiles) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleWindowDragLeave(): void {
    if (draggingDoc) return
    dragCountRef.current--
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0
      setIsDroppingFile(false)
    }
  }

  async function handleWindowDrop(e: React.DragEvent): Promise<void> {
    if (draggingDoc) return
    e.preventDefault()
    dragCountRef.current = 0
    setIsDroppingFile(false)
    const files: string[] = []
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i]
      if (isSupportedFile(f.name)) {
        const filePath = window.api.getPathForFile(f)
        if (filePath) files.push(filePath)
      }
    }
    if (files.length === 0) return
    await window.api.importPdfPaths(files, selectedFolderId ?? null)
    reload()
  }

  return (
    <div
      style={{
        display: 'flex', width: '100vw', height: '100vh',
        fontFamily: 'Segoe UI, sans-serif', fontSize: '13px',
        background: C.bg, color: C.text, overflow: 'hidden',
        position: 'fixed', top: 0, left: 0
      }}
      onDragEnter={handleWindowDragEnter}
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
    >
      <Sidebar
        folders={folders}
        tags={tags}
        selectedFolderId={selectedFolderId}
        selectedTagIds={selectedTagIds}
        view={view}
        selectedFileType={selectedFileType}
        onSelectFolder={(id, typeKey) => { setSelectedFolderId(id); setSelectedTagIds([]); setView('all'); setSelectedFileType(typeKey !== undefined ? typeKey : null) }}
        onSelectTag={(id) => {
          setSelectedTagIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
          setSelectedFolderId(undefined)
          setView('all')
          setSelectedFileType(null)
        }}
        onSelectView={(v) => { setView(v); setSelectedFolderId(undefined); setSelectedTagIds([]); setSelectedFileType(null) }}
        onCreateFolder={handleCreateFolder}
        onCreateTag={handleCreateTag}
        onImport={handleImport}
        searchQuery={searchQuery}
        onSearch={handleSearch}
        draggingDoc={draggingDoc}
        onDropToFolder={handleDropToFolder}
        onDeleteFolder={handleDeleteFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteTag={handleDeleteTag}
        onRenameTag={handleRenameTag}
        onDropFileToFolder={async (folderId, files) => {
          await window.api.importPdfPaths(files, folderId)
          reload()
        }}
        onOpenSettings={() => { setIsFirstTime(false); setShowSettings(true) }}
      />
      <DocumentList
        documents={documents}
        folders={folders}
        tags={tags}
        selectedDoc={selectedDoc}
        selectedFileType={selectedFileType}
        onSelectDoc={handleSelectDoc}
        onToggleFavorite={handleToggleFavorite}
        onMoveDocument={handleMoveDocument}
        onDragStart={(doc, docs) => { setDraggingDoc(doc); setDraggingDocs(docs) }}
        onDeleteDocument={handleDeleteDocument}
        onRenameDocument={handleRenameDocument}
        onBulkDelete={handleBulkDelete}
        onBulkMove={handleBulkMove}
      />
      <PdfViewer document={selectedDoc} onPageCountUpdate={handlePageCountUpdate} />

      {showSettings && (
        <Settings
          isFirstTime={isFirstTime}
          onClose={() => { setShowSettings(false); setIsFirstTime(false) }}
        />
      )}

      {isDroppingFile && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: `${C.accent}18`,
          border: `2px dashed ${C.accent}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
          backdropFilter: 'blur(2px)'
        }}>
          <div style={{
            background: C.surface, borderRadius: 14, padding: '28px 48px',
            border: `1px solid ${C.accent}`,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            textAlign: 'center'
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: C.accentDim, border: `1px solid ${C.accent}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, margin: '0 auto 14px'
            }}>📄</div>
            <div style={{ fontSize: 14, color: C.accent, fontWeight: 600, marginBottom: 4 }}>
              {selectedFolderId
                ? `${folders.find(f => f.id === selectedFolderId)?.name} 에 추가`
                : '전체 문서에 추가'}
            </div>
            <div style={{ fontSize: 11, color: C.textDim }}>지원 파일을 놓으세요</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App