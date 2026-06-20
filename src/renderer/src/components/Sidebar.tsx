import React, { useState, useRef, useEffect } from 'react'
import { Folder, Tag, Document } from '../types'
import { useTheme } from '../ThemeContext'

interface FolderNode {
  folder: Folder
  children: FolderNode[]
}

interface Props {
  folders: Folder[]
  tags: Tag[]
  selectedFolderId: number | undefined
  selectedTagIds: number[]
  view: 'all' | 'favorites' | 'recent'
  onSelectFolder: (id: number | undefined) => void
  onSelectTag: (id: number) => void
  onSelectView: (v: 'all' | 'favorites' | 'recent') => void
  onCreateFolder: (name: string, parentId?: number) => void
  onCreateTag: (name: string, color: string) => void
  onImport: () => void
  searchQuery: string
  onSearch: (q: string) => void
  draggingDoc: Document | null
  onDropToFolder: (folderId: number | null) => void
  onMoveFolder: (folderId: number, newParentId: number | null) => void
  onDeleteFolder: (folderId: number) => void
  onRenameFolder: (folderId: number, name: string) => void
  onDeleteTag: (tagId: number) => void
  onRenameTag: (tagId: number, name: string) => void
  onDropFileToFolder: (folderId: number | null, files: string[]) => void
  onOpenSettings: () => void
}

const TAG_COLORS = ['#4d94e8', '#1D9E75', '#D85A30', '#7F77DD', '#BA7517']

function buildTree(folders: Folder[], parentId: number | null = null): FolderNode[] {
  return folders
    .filter(f => f.parent_id === (parentId ?? null))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .map(f => ({ folder: f, children: buildTree(folders, f.id) }))
}


const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: '#55556a', textTransform: 'uppercase',
  letterSpacing: '0.08em', fontWeight: 600, padding: '10px 14px 4px', flex: 1
}

function NavItem({ label, active, onClick, colors }: { label: string; active: boolean; onClick: () => void; colors: { active: string; hover: string; text: string; activeBorder: string; accent: string } }): React.ReactElement {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '6px 14px', cursor: 'pointer', borderRadius: 6,
        margin: '1px 8px', fontSize: 12, fontWeight: active ? 500 : 400,
        background: active ? colors.active : hov ? colors.hover : 'transparent',
        color: active ? colors.accent : colors.text,
        borderLeft: active ? `2px solid ${colors.activeBorder}` : '2px solid transparent',
        transition: 'background 0.12s, color 0.12s',
      }}
    >{label}</div>
  )
}

export default function Sidebar({
  folders, tags, selectedFolderId, selectedTagIds, view,
  onSelectFolder, onSelectTag, onSelectView, onCreateFolder, onCreateTag,
  onImport, searchQuery, onSearch, draggingDoc, onDropToFolder, onMoveFolder,
  onDeleteFolder, onRenameFolder, onDeleteTag, onRenameTag, onDropFileToFolder,
  onOpenSettings
}: Props): React.ReactElement {
  const t = useTheme()
  const C = {
    surface: t.sidebarBg,
    hover: t.hover,
    active: t.active,
    activeBorder: t.activeBorder,
    dropHover: t.dropHover,
    dropText: t.dropText,
    border: t.border,
    text: t.text,
    muted: t.muted,
    accent: t.accent,
    inputBg: t.inputBg,
  }
  const [newFolderName, setNewFolderName] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [showTagInput, setShowTagInput] = useState(false)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showFolderInput) setTimeout(() => folderInputRef.current?.focus(), 50)
  }, [showFolderInput])
  useEffect(() => {
    if (showTagInput) setTimeout(() => tagInputRef.current?.focus(), 50)
  }, [showTagInput])
  const [dragOverFolder, setDragOverFolder] = useState<number | 'none' | 'root' | null>(null)
  const [draggingFolderId, setDraggingFolderId] = useState<number | null>(null)
  const draggingFolderIdRef = useRef<number | null>(null)
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null)
  const [renamingFolderText, setRenamingFolderText] = useState('')
  const [renamingTagId, setRenamingTagId] = useState<number | null>(null)
  const [renamingTagText, setRenamingTagText] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'folder' | 'tag'; id: number; name: string; isSystem?: boolean } | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [addingSubInFolderId, setAddingSubInFolderId] = useState<number | null>(null)
  const [addingSubName, setAddingSubName] = useState('')

  React.useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  function toggleExpand(folderId: number, e: React.MouseEvent): void {
    e.stopPropagation()
    const next = new Set(expandedIds)
    if (next.has(folderId)) { next.delete(folderId) } else { next.add(folderId) }
    setExpandedIds(next)
  }

  function handleCreateFolder(): void {
    if (!newFolderName.trim()) return
    onCreateFolder(newFolderName.trim())
    setNewFolderName(''); setShowFolderInput(false)
  }

  function handleCreateTag(): void {
    if (!newTagName.trim()) return
    onCreateTag(newTagName.trim(), newTagColor)
    setNewTagName(''); setShowTagInput(false)
  }

  function handleContextMenu(e: React.MouseEvent, type: 'folder' | 'tag', id: number, name: string, isSystem?: boolean): void {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, type, id, name, isSystem })
  }

  function getFilesFromDrop(e: React.DragEvent): { files: string[]; folders: string[] } {
    const files: string[] = []
    const folders: string[] = []
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i]
      const path = window.api.getPathForFile(f)
      if (!path) continue
      if (f.type === '' && f.size === 0) {
        folders.push(path)
      } else if (/\.(pdf|jpg|jpeg|png|gif|bmp|webp|mp4|mkv|avi|mov|wmv|flv|webm|m4v|mp3|wav|aiff|alac|flac|m4a|ogg|aac|txt|md|docx|hwp|xlsx|xls|pptx|ppt|pages|numbers|key|csv|odt|ods|odp)$/i.test(f.name)) {
        files.push(path)
      }
    }
    return { files, folders }
  }

  function handleFolderDragOver(e: React.DragEvent, folderId: number): void {
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverFolder(folderId)
  }

  function handleFolderDrop(e: React.DragEvent, folderId: number): void {
    e.preventDefault(); e.stopPropagation()
    setDragOverFolder(null)
    const movingId = draggingFolderIdRef.current
    if (movingId !== null) {
      if (movingId !== folderId) onMoveFolder(movingId, folderId)
      draggingFolderIdRef.current = null
      setDraggingFolderId(null)
    } else if (draggingDoc) {
      onDropToFolder(folderId)
    } else {
      const { files, folders } = getFilesFromDrop(e)
      if (files.length > 0) onDropFileToFolder(folderId, files)
      if (folders.length > 0) window.api.importFolderPaths(folders, folderId)
      if (files.length > 0 || folders.length > 0) onSelectFolder(folderId)
    }
  }

  function handleRootDrop(e: React.DragEvent): void {
    e.preventDefault(); e.stopPropagation()
    setDragOverFolder(null)
    const movingId = draggingFolderIdRef.current
    if (movingId !== null) {
      onMoveFolder(movingId, null)
      draggingFolderIdRef.current = null
      setDraggingFolderId(null)
    }
  }

  function handleNoneDragOver(e: React.DragEvent): void {
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = draggingDoc ? 'move' : 'copy'
    setDragOverFolder('none')
  }

  function handleNoneDrop(e: React.DragEvent): void {
    e.preventDefault(); e.stopPropagation()
    setDragOverFolder(null)
    if (draggingDoc) { onDropToFolder(null) }
    else {
      const { files, folders } = getFilesFromDrop(e)
      if (files.length > 0) onDropFileToFolder(null, files)
      if (folders.length > 0) window.api.importFolderPaths(folders, null)
    }
  }

  function commitSubFolder(parentId: number): void {
    if (addingSubName.trim()) onCreateFolder(addingSubName.trim(), parentId)
    setAddingSubInFolderId(null); setAddingSubName('')
  }

  function renderFolderNode(node: FolderNode, depth: number): React.ReactElement {
    const { folder } = node
    const isExpanded = expandedIds.has(folder.id)
    const hasChildren = node.children.length > 0 || addingSubInFolderId === folder.id
    const isSelected = selectedFolderId === folder.id
    const isDrop = dragOverFolder === folder.id

    const isFolderDragging = draggingFolderId === folder.id

    return (
      <React.Fragment key={folder.id}>
        <div
          draggable={renamingFolderId !== folder.id}
          onDragStart={(e) => { e.stopPropagation(); draggingFolderIdRef.current = folder.id; setDraggingFolderId(folder.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => { draggingFolderIdRef.current = null; setDraggingFolderId(null) }}
          onDragOver={(e) => handleFolderDragOver(e, folder.id)}
          onDrop={(e) => handleFolderDrop(e, folder.id)}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null) }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation() }}
          onClick={() => { if (renamingFolderId !== folder.id) onSelectFolder(folder.id) }}
          onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id, folder.name)}
          style={{
            display: 'flex', alignItems: 'center',
            paddingLeft: 10 + depth * 16, paddingRight: 10,
            paddingTop: 5, paddingBottom: 5,
            margin: '1px 8px', borderRadius: 6, cursor: 'pointer',
            fontSize: 12, userSelect: 'none',
            opacity: isFolderDragging ? 0.4 : 1,
            background: isDrop ? C.dropHover : isSelected ? C.active : 'transparent',
            color: isDrop ? C.dropText : isSelected ? C.accent : C.text,
            borderLeft: isSelected && !isDrop ? `2px solid ${C.activeBorder}` : '2px solid transparent',
            outline: isDrop ? `1px dashed ${C.dropText}` : 'none',
            transition: 'background 0.12s, color 0.12s, opacity 0.12s',
          }}
        >
          <span
            onClick={(e) => toggleExpand(folder.id, e)}
            style={{
              width: 22, flexShrink: 0, fontSize: 15, color: hasChildren ? C.text : 'transparent',
              textAlign: 'center', marginRight: 3, cursor: hasChildren ? 'pointer' : 'default',
              transition: 'color 0.1s'
            }}
          >{hasChildren ? (isExpanded ? '▼' : '▶') : ''}</span>

          {renamingFolderId === folder.id ? (
            <div style={{ display: 'flex', gap: 4, flex: 1 }} onClick={e => e.stopPropagation()}>
              <input
                autoFocus value={renamingFolderText}
                onChange={(e) => setRenamingFolderText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') { onRenameFolder(folder.id, renamingFolderText); setRenamingFolderId(null) }
                  if (e.key === 'Escape') setRenamingFolderId(null)
                }}
                onBlur={() => setRenamingFolderId(null)}
                style={{ flex: 1, padding: '2px 6px', background: C.inputBg, border: `1px solid ${C.accent}`, borderRadius: 4, color: C.text, fontSize: 12, outline: 'none' }}
              />
              <span onMouseDown={(e) => { e.preventDefault(); onRenameFolder(folder.id, renamingFolderText); setRenamingFolderId(null) }}
                style={{ cursor: 'pointer', color: '#4eca7c', fontSize: 14 }}>✓</span>
            </div>
          ) : (
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13 }}>📁</span> {folder.name}
            </span>
          )}
        </div>

        {isExpanded && (
          <div style={{ position: 'relative' }}>
            {node.children.map(child => renderFolderNode(child, depth + 1))}
            {addingSubInFolderId === folder.id && (
              <div style={{ paddingLeft: 10 + (depth + 1) * 16, paddingRight: 10, margin: '2px 8px' }}>
                <input
                  autoFocus value={addingSubName}
                  onChange={(e) => setAddingSubName(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitSubFolder(folder.id)
                    if (e.key === 'Escape') { setAddingSubInFolderId(null); setAddingSubName('') }
                  }}
                  onBlur={() => commitSubFolder(folder.id)}
                  placeholder="하위 폴더 이름..."
                  style={{ width: '100%', padding: '5px 8px', background: C.inputBg, border: `1px solid ${C.accent}`, borderRadius: 5, color: C.text, fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            )}
          </div>
        )}
      </React.Fragment>
    )
  }

  // 최상위 폴더 트리 (모든 폴더)
  const rootTree = buildTree(folders, null)

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '5px 9px', background: C.inputBg,
    border: `1px solid ${C.accent}`, borderRadius: 5, color: C.text,
    fontSize: 12, outline: 'none', boxSizing: 'border-box'
  }

  return (
    <div
      style={{ width: 210, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      onClick={() => setContextMenu(null)}
    >
      {/* 검색 */}
      <div style={{ padding: '12px 10px 8px' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: C.muted, pointerEvents: 'none' }}>🔍</span>
          <input
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="검색..."
            style={{ width: '100%', padding: '7px 10px 7px 28px', background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s' }}
            onFocus={e => e.currentTarget.style.borderColor = C.accent}
            onBlur={e => e.currentTarget.style.borderColor = C.border}
          />
        </div>
      </div>

      {/* 파일 추가 버튼 */}
      <div style={{ padding: '0 10px 10px' }}>
        <button
          onClick={onImport}
          style={{ width: '100%', padding: '8px', background: 'linear-gradient(135deg, #1a5fa8, #2577c8)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600, letterSpacing: '0.02em', transition: 'opacity 0.15s', boxShadow: '0 2px 8px rgba(77,148,232,0.25)' }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >＋ 파일 추가</button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* 라이브러리 */}
        <div style={sectionLabel}>라이브러리</div>
        <NavItem label="📚 전체 문서" active={view === 'all' && !selectedFolderId && selectedTagIds.length === 0} onClick={() => onSelectView('all')} colors={C} />
        <NavItem label="⭐ 즐겨찾기" active={view === 'favorites' && !selectedFolderId && selectedTagIds.length === 0} onClick={() => onSelectView('favorites')} colors={C} />
        <NavItem label="🕐 최근 열람" active={view === 'recent' && !selectedFolderId && selectedTagIds.length === 0} onClick={() => onSelectView('recent')} colors={C} />

        <div style={{ height: 1, background: C.border, margin: '10px 0' }} />

        {/* 폴더 */}
        <div
          style={{ display: 'flex', alignItems: 'center', paddingRight: 10 }}
          onDragOver={(e) => { if (draggingFolderId !== null) { e.preventDefault(); e.stopPropagation(); setDragOverFolder('root') } }}
          onDragLeave={() => setDragOverFolder(null)}
          onDrop={handleRootDrop}
        >
          <span style={{ ...sectionLabel, color: dragOverFolder === 'root' ? C.accent : undefined }}>
            {dragOverFolder === 'root' ? '여기에 놓으면 최상위로 이동' : '폴더'}
          </span>
          <span
            onClick={() => setShowFolderInput(!showFolderInput)}
            style={{ cursor: 'pointer', color: C.muted, fontSize: 18, lineHeight: 1, paddingRight: 14, paddingBottom: 2, transition: 'color 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.color = C.text}
            onMouseLeave={e => e.currentTarget.style.color = C.muted}
          >+</span>
        </div>
        {showFolderInput && (
          <div style={{ padding: '4px 10px 6px' }} onClick={e => e.stopPropagation()}>
            <input ref={folderInputRef} value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleCreateFolder()
                if (e.key === 'Escape') { setNewFolderName(''); setShowFolderInput(false) }
              }}
              placeholder="폴더 이름..."
              style={inputStyle}
            />
          </div>
        )}
        <div style={{ position: 'relative' }}>
          {rootTree.map(node => renderFolderNode(node, 0))}
        </div>

        {/* 드래그 중 분류없음 드롭존 */}
        {draggingDoc && (
          <div
            onDragOver={handleNoneDragOver} onDrop={handleNoneDrop}
            onDragLeave={() => setDragOverFolder(null)}
            style={{
              borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
              margin: '1px 8px', fontSize: 12,
              background: dragOverFolder === 'none' ? C.dropHover : 'transparent',
              color: dragOverFolder === 'none' ? C.dropText : C.text,
              outline: dragOverFolder === 'none' ? `1px dashed ${C.dropText}` : 'none',
              borderLeft: '2px solid transparent',
            }}
          >📂 분류 없음</div>
        )}

        <div style={{ height: 1, background: C.border, margin: '10px 0' }} />

        {/* 태그 */}
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: 10 }}>
          <span style={sectionLabel}>
            태그
            {selectedTagIds.length > 0 && (
              <span style={{ marginLeft: 5, fontSize: 9, background: C.accent, color: '#fff', borderRadius: 8, padding: '1px 5px' }}>
                {selectedTagIds.length}
              </span>
            )}
          </span>
          <span
            onClick={() => setShowTagInput(!showTagInput)}
            style={{ cursor: 'pointer', color: C.muted, fontSize: 18, lineHeight: 1, paddingRight: 14, paddingBottom: 2, transition: 'color 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2e2e8'}
            onMouseLeave={e => e.currentTarget.style.color = C.muted}
          >+</span>
        </div>

        {showTagInput && (
          <div style={{ padding: '4px 10px 8px' }}>
            <input ref={tagInputRef} value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleCreateTag() }}
              onBlur={() => { if (newTagName.trim()) handleCreateTag(); else setShowTagInput(false) }}
              placeholder="태그 이름..."
              style={{ ...inputStyle, marginBottom: 6 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              {TAG_COLORS.map((c) => (
                <div key={c} onClick={() => setNewTagColor(c)}
                  style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: newTagColor === c ? '2px solid #fff' : '2px solid transparent', transition: 'transform 0.1s', transform: newTagColor === c ? 'scale(1.2)' : 'scale(1)' }} />
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: '2px 8px 12px' }}>
          {tags.length === 0 && <div style={{ padding: '4px 6px', fontSize: 11, color: C.muted }}>태그가 없습니다</div>}
          {tags.map((tag) => {
            const isActive = selectedTagIds.includes(tag.id)
            return (
              <div key={tag.id}
                onClick={() => { if (renamingTagId !== tag.id) onSelectTag(tag.id) }}
                onContextMenu={(e) => handleContextMenu(e, 'tag', tag.id, tag.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 6, cursor: 'pointer', margin: '1px 0',
                  background: isActive ? tag.color + '22' : 'transparent',
                  border: isActive ? `1px solid ${tag.color}55` : '1px solid transparent',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.hover }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color, flexShrink: 0, boxShadow: `0 0 4px ${tag.color}88` }} />
                {renamingTagId === tag.id ? (
                  <div style={{ display: 'flex', gap: 4, flex: 1 }} onClick={e => e.stopPropagation()}>
                    <input autoFocus value={renamingTagText}
                      onChange={(e) => setRenamingTagText(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') { onRenameTag(tag.id, renamingTagText); setRenamingTagId(null) }
                        if (e.key === 'Escape') setRenamingTagId(null)
                      }}
                      onBlur={() => setRenamingTagId(null)}
                      style={{ flex: 1, padding: '2px 6px', background: C.inputBg, border: `1px solid ${C.accent}`, borderRadius: 4, color: C.text, fontSize: 12, outline: 'none' }}
                    />
                    <span onMouseDown={(e) => { e.preventDefault(); onRenameTag(tag.id, renamingTagText); setRenamingTagId(null) }}
                      style={{ cursor: 'pointer', color: '#4eca7c', fontSize: 14 }}>✓</span>
                  </div>
                ) : (
                  <>
                    <span style={{ fontSize: 12, color: isActive ? tag.color : C.text, flex: 1 }}>#{tag.name}</span>
                    {isActive && <span style={{ fontSize: 10, color: tag.color, fontWeight: 600 }}>✓</span>}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 설정 */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '8px 10px' }}>
        <button onClick={onOpenSettings}
          style={{ width: '100%', padding: '7px 10px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 12, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 7, transition: 'background 0.12s, color 0.12s' }}
          onMouseEnter={e => { e.currentTarget.style.background = C.hover; e.currentTarget.style.color = '#e2e2e8' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted }}
        >⚙️ 설정</button>
      </div>

      {/* 컨텍스트 메뉴 */}
      {contextMenu && (() => {
        const isSystem = contextMenu.isSystem
        const itemCount = contextMenu.type === 'folder'
          ? (isSystem ? 1 : 3)
          : 2
        const estimated = 16 + itemCount * 36
        const menuTop = contextMenu.y + estimated > window.innerHeight - 10
          ? Math.max(10, contextMenu.y - estimated)
          : contextMenu.y
        const menuLeft = Math.min(contextMenu.x, window.innerWidth - 172)
        const items = contextMenu.type === 'folder'
          ? [
              ...(!isSystem ? [{ label: '✏️ 이름 수정', action: () => { setRenamingFolderId(contextMenu.id); setRenamingFolderText(contextMenu.name); setContextMenu(null) }, color: '#d0d0da' }] : []),
              { label: '📁 새 하위 폴더', action: () => { setAddingSubInFolderId(contextMenu.id); setAddingSubName(''); setExpandedIds(prev => new Set([...prev, contextMenu.id])); setContextMenu(null) }, color: '#d0d0da' },
              ...(!isSystem ? [{ label: '🗑️ 삭제', action: () => { if (confirm(`"${contextMenu.name}" 폴더를 삭제할까요?`)) onDeleteFolder(contextMenu.id); setContextMenu(null) }, color: '#e05555' }] : []),
            ]
          : [
              { label: '✏️ 이름 수정', action: () => { setRenamingTagId(contextMenu.id); setRenamingTagText(contextMenu.name); setContextMenu(null) }, color: '#d0d0da' },
              { label: '🗑️ 삭제', action: () => { if (confirm(`"${contextMenu.name}" 태그를 삭제할까요?`)) onDeleteTag(contextMenu.id); setContextMenu(null) }, color: '#e05555' },
            ]
        return (
          <div
            style={{ position: 'fixed', top: menuTop, left: menuLeft, background: '#2a2a33', border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 9999, minWidth: 164, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '4px 0' }}>
              {items.map(({ label, action, color }) => (
                <div key={label} onClick={action} style={{ padding: '8px 14px', fontSize: 12, color, cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = C.hover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >{label}</div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
