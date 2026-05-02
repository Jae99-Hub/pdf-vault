import React, { useState, useEffect } from 'react'
import { Document, Folder, Tag } from '../types'

function InfoRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      <span style={{ color: '#4a4a5a', minWidth: 34, fontSize: 10, paddingTop: 1, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#c0c0d0', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

interface Props {
  documents: Document[]
  folders: Folder[]
  tags: Tag[]
  selectedDoc: Document | null
  onSelectDoc: (doc: Document) => void
  onToggleFavorite: (doc: Document) => void
  onMoveDocument: (doc: Document, folderId: number | null) => void
  onDragStart: (doc: Document) => void
  onDeleteDocument: (doc: Document) => void
  onRenameDocument: (doc: Document, title: string) => void
  onBulkDelete: (docs: Document[]) => void
  onBulkMove: (docs: Document[], folderId: number | null) => void
}

const C = {
  bg: '#1c1c21',
  surface: '#22222a',
  hover: '#26262f',
  active: '#1a2f4a',
  activeBorder: '#4d94e8',
  border: '#2a2a33',
  text: '#d8d8e0',
  muted: '#66667a',
  accent: '#4d94e8',
}

function formatSize(bytes: number): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) return '오늘'
  if (diff < 86400000 * 2) return '어제'
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

function getFolderName(doc: Document, folders: Folder[]): string | null {
  if (!doc.folder_id) return null
  return folders.find(f => f.id === doc.folder_id)?.name ?? null
}

export default function DocumentList({
  documents, folders, tags, selectedDoc,
  onSelectDoc, onToggleFavorite, onMoveDocument,
  onDragStart, onDeleteDocument, onRenameDocument,
  onBulkDelete, onBulkMove
}: Props): React.ReactElement {
  const [sortBy, setSortBy] = useState<'opened' | 'title' | 'created' | 'size' | 'pages'>('opened')
  const [selectedDocTags, setSelectedDocTags] = useState<Tag[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; doc: Document } | null>(null)
  const [draggingDoc, setDraggingDoc] = useState<Document | null>(null)
  const [renamingDoc, setRenamingDoc] = useState<Document | null>(null)
  const [renameText, setRenameText] = useState('')
  const [tagMenuDoc, setTagMenuDoc] = useState<Document | null>(null)
  const [docTags, setDocTags] = useState<Tag[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [showBulkMoveMenu, setShowBulkMoveMenu] = useState(false)

  useEffect(() => {
    if (tagMenuDoc) loadDocTags(tagMenuDoc.id)
  }, [tagMenuDoc])

  useEffect(() => {
    if (selectedDoc) window.api.getDocumentTags(selectedDoc.id).then(setSelectedDocTags)
    else setSelectedDocTags([])
  }, [selectedDoc])

  async function loadDocTags(docId: number): Promise<void> {
    setDocTags(await window.api.getDocumentTags(docId))
  }

  async function handleToggleTag(tag: Tag): Promise<void> {
    if (!tagMenuDoc) return
    const has = docTags.find(t => t.id === tag.id)
    if (has) await window.api.removeDocumentTag(tagMenuDoc.id, tag.id)
    else await window.api.addDocumentTag(tagMenuDoc.id, tag.id)
    loadDocTags(tagMenuDoc.id)
  }

  function handleClick(e: React.MouseEvent, doc: Document): void {
    if (selectMode || e.ctrlKey || e.metaKey) {
      const next = new Set(selectedIds)
      if (next.has(doc.id)) { next.delete(doc.id) } else { next.add(doc.id) }
      setSelectedIds(next)
    } else if (e.shiftKey && selectedIds.size > 0) {
      const ids = documents.map(d => d.id)
      const last = Array.from(selectedIds).pop()!
      const [s, e2] = [ids.indexOf(last), ids.indexOf(doc.id)].sort((a, b) => a - b)
      const next = new Set(selectedIds)
      for (let i = s; i <= e2; i++) next.add(ids[i])
      setSelectedIds(next)
    } else {
      setSelectedIds(new Set())
      onSelectDoc(doc)
    }
  }

  function handleContextMenu(e: React.MouseEvent, doc: Document): void {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, doc })
    setTagMenuDoc(null)
  }

  function handleDragStart(e: React.DragEvent, doc: Document): void {
    setDraggingDoc(doc); onDragStart(doc)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDelete(doc: Document): void {
    if (confirm(`"${doc.title}" 을(를) 삭제할까요?`)) onDeleteDocument(doc)
    setContextMenu(null)
  }

  function handleBulkDelete(): void {
    const selected = documents.filter(d => selectedIds.has(d.id))
    if (confirm(`선택한 ${selected.length}개 문서를 삭제할까요?`)) {
      onBulkDelete(selected); setSelectedIds(new Set()); setSelectMode(false)
    }
  }

  function handleBulkMove(folderId: number | null): void {
    onBulkMove(documents.filter(d => selectedIds.has(d.id)), folderId)
    setSelectedIds(new Set()); setSelectMode(false); setShowBulkMoveMenu(false)
  }

  function sortedDocs(): Document[] {
    const arr = [...documents]
    switch (sortBy) {
      case 'title': return arr.sort((a, b) => a.title.localeCompare(b.title, 'ko'))
      case 'created': return arr.sort((a, b) => b.created_at.localeCompare(a.created_at))
      case 'size': return arr.sort((a, b) => b.file_size - a.file_size)
      case 'pages': return arr.sort((a, b) => b.page_count - a.page_count)
      default: return arr
    }
  }

  const menuItemStyle: React.CSSProperties = { padding: '8px 14px', fontSize: 12, cursor: 'pointer', transition: 'background 0.1s' }

  return (
    <div
      style={{ width: 256, flexShrink: 0, background: C.bg, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      onClick={() => { setContextMenu(null); setTagMenuDoc(null); setShowBulkMoveMenu(false) }}
    >
      {/* 헤더 */}
      <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: C.muted, flex: 1, fontWeight: 500 }}>문서 <span style={{ color: C.accent }}>{documents.length}</span>개</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          onClick={(e) => e.stopPropagation()}
          style={{ fontSize: 10, background: '#1e1e28', border: `1px solid ${C.border}`, borderRadius: 5, color: '#9898aa', padding: '3px 5px', cursor: 'pointer', outline: 'none' }}
        >
          <option value="opened">열람일순</option>
          <option value="title">제목순</option>
          <option value="created">추가일순</option>
          <option value="size">크기순</option>
          <option value="pages">페이지순</option>
        </select>
        <button
          onClick={(e) => { e.stopPropagation(); if (selectMode) { setSelectMode(false); setSelectedIds(new Set()) } else setSelectMode(true) }}
          style={{ padding: '3px 9px', fontSize: 10, background: selectMode ? '#1a3560' : 'transparent', border: `1px solid ${selectMode ? C.accent : '#3a3a48'}`, borderRadius: 5, color: selectMode ? '#a0c4ff' : C.muted, cursor: 'pointer', transition: 'all 0.12s' }}
        >{selectMode ? '취소' : '선택'}</button>
      </div>

      {/* 다중 선택 안내 / 액션 바 */}
      {selectMode && (
        <div style={{ padding: '7px 10px', background: '#0e2840', borderBottom: `1px solid #1a3a60`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#6aaddf', flex: 1 }}>
            {selectedIds.size > 0 ? `${selectedIds.size}개 선택` : '클릭으로 선택'}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              const allIds = new Set(documents.map(d => d.id))
              const allSelected = documents.every(d => selectedIds.has(d.id))
              setSelectedIds(allSelected ? new Set() : allIds)
            }}
            style={{ padding: '3px 9px', fontSize: 10, background: documents.every(d => selectedIds.has(d.id)) ? '#1a3560' : 'transparent', border: `1px solid ${C.accent}`, borderRadius: 5, color: '#a0c4ff', cursor: 'pointer', transition: 'all 0.12s' }}
          >
            {documents.every(d => selectedIds.has(d.id)) ? '전체 해제' : '전체 선택'}
          </button>

      {selectedIds.size > 0 && (<>
          <div style={{ position: 'relative' }}>
            <button onClick={(e) => { e.stopPropagation(); setShowBulkMoveMenu(!showBulkMoveMenu) }}
              style={{ padding: '4px 10px', background: '#1a3560', border: `1px solid ${C.accent}`, borderRadius: 5, color: '#a0c4ff', fontSize: 11, cursor: 'pointer' }}>이동</button>
            {showBulkMoveMenu && (
              <div style={{ position: 'absolute', top: 28, left: 0, background: '#2a2a33', border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 9999, minWidth: 156, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
                onClick={e => e.stopPropagation()}>
                {[{ id: null as number | null, name: '📂 분류 없음' }, ...folders.map(f => ({ id: f.id, name: `📁 ${f.name}` }))].map(item => (
                  <div key={item.id ?? 'none'} onClick={() => handleBulkMove(item.id)}
                    style={{ padding: '8px 14px', fontSize: 12, color: C.text, cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.hover}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >{item.name}</div>
                ))}
              </div>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); handleBulkDelete() }}
            style={{ padding: '4px 10px', background: '#2e1515', border: '1px solid #6e2020', borderRadius: 5, color: '#e07070', fontSize: 11, cursor: 'pointer' }}>삭제</button>
          <button onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set()); setSelectMode(false) }}
            style={{ padding: '4px 7px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, fontSize: 11, cursor: 'pointer' }}>✕</button>
        </>)}
        </div>
      )}

      {/* 문서 목록 */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {documents.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted }}>
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>📄</div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>문서가 없습니다</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>PDF 또는 이미지를 드래그하거나 추가 버튼을 눌러주세요</div>
          </div>
        )}
        {sortedDocs().map((doc) => {
          const isSelected = selectedIds.has(doc.id)
          const isActive = selectedDoc?.id === doc.id
          const folderName = getFolderName(doc, folders)
          return (
            <div
              key={doc.id}
              draggable={!selectMode}
              onDragStart={(e) => handleDragStart(e, doc)}
              onDragEnd={() => setDraggingDoc(null)}
              onClick={(e) => handleClick(e, doc)}
              onContextMenu={(e) => handleContextMenu(e, doc)}
              style={{
                padding: '10px 12px',
                borderBottom: `1px solid ${C.border}`,
                cursor: selectMode ? 'pointer' : 'grab',
                opacity: draggingDoc?.id === doc.id ? 0.35 : 1,
                background: isSelected ? '#162440' : isActive ? C.active : 'transparent',
                borderLeft: isSelected ? `3px solid ${C.accent}` : isActive ? `3px solid ${C.activeBorder}55` : '3px solid transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!isActive && !isSelected) e.currentTarget.style.background = C.hover }}
              onMouseLeave={e => { if (!isActive && !isSelected) e.currentTarget.style.background = 'transparent' }}
            >
              {renamingDoc?.id === doc.id ? (
                <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                  <input
                    autoFocus value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { if (renameText.trim()) { onRenameDocument(renamingDoc, renameText.trim()); setRenamingDoc(null) } }
                      if (e.key === 'Escape') setRenamingDoc(null)
                    }}
                    onBlur={() => setRenamingDoc(null)}
                    style={{ flex: 1, padding: '4px 8px', background: '#1e1e28', border: `1px solid ${C.accent}`, borderRadius: 5, color: '#e2e2e8', fontSize: 12, outline: 'none' }}
                  />
                  <span onMouseDown={(e) => { e.preventDefault(); if (renameText.trim()) { onRenameDocument(renamingDoc, renameText.trim()); setRenamingDoc(null) } }}
                    style={{ cursor: 'pointer', color: '#4eca7c', fontSize: 16, display: 'flex', alignItems: 'center' }}>✓</span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {selectMode && (
                    <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1, border: `2px solid ${isSelected ? C.accent : '#3a3a50'}`, background: isSelected ? C.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.1s' }}>
                      {isSelected && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                    </div>
                  )}
                  <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(doc.file_path) ? '🖼️' : '📄'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: isSelected ? '#a0c4ff' : isActive ? '#c8dcf8' : C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4, lineHeight: 1.4 }}>
                      {doc.title}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                      {formatSize(doc.file_size) && (
                        <span style={{ fontSize: 10, color: C.muted, background: '#2a2a35', borderRadius: 3, padding: '1px 5px' }}>{formatSize(doc.file_size)}</span>
                      )}
                      {doc.page_count > 0 && (
                        <span style={{ fontSize: 10, color: C.muted, background: '#2a2a35', borderRadius: 3, padding: '1px 5px' }}>{doc.page_count}p</span>
                      )}
                      <span style={{ fontSize: 10, color: '#4a4a60' }}>{formatDate(doc.opened_at || doc.created_at)}</span>
                      {folderName && (
                        <span style={{ fontSize: 10, color: '#7a6a30', background: '#2a2510', borderRadius: 3, padding: '1px 5px', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {folderName}</span>
                      )}
                    </div>
                  </div>
                  {!selectMode && (
                    <span onClick={(e) => { e.stopPropagation(); onToggleFavorite(doc) }}
                      style={{ fontSize: 14, cursor: 'pointer', flexShrink: 0, color: doc.is_favorite ? '#f0c040' : '#333345', transition: 'color 0.12s, transform 0.1s', transform: doc.is_favorite ? 'scale(1.15)' : 'scale(1)' }}>★</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 문서 정보 패널 */}
      {selectedDoc && (
        <div style={{ borderTop: `1px solid ${C.border}`, background: C.surface, flexShrink: 0, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: '#44445a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>
            문서 정보
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {formatSize(selectedDoc.file_size) && <InfoRow label="크기" value={formatSize(selectedDoc.file_size)} />}
            {selectedDoc.page_count > 0 && <InfoRow label="페이지" value={`${selectedDoc.page_count}p`} />}
            <InfoRow label="추가일" value={new Date(selectedDoc.created_at).toLocaleDateString('ko-KR')} />
            {selectedDoc.opened_at && <InfoRow label="열람일" value={formatDate(selectedDoc.opened_at)} />}
            {getFolderName(selectedDoc, folders) && <InfoRow label="폴더" value={getFolderName(selectedDoc, folders)!} />}
            {selectedDocTags.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                {selectedDocTags.map(t => (
                  <span key={t.id} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: `${t.color}20`, border: `1px solid ${t.color}50`, color: t.color }}>
                    #{t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 우클릭 메뉴 */}
      {contextMenu && (
        <div style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: '#2a2a33', border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 9999, minWidth: 188, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }}
          onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '4px 0' }}>
            {[
              { label: '✏️ 제목 수정', action: () => { setRenamingDoc(contextMenu.doc); setRenameText(contextMenu.doc.title); setContextMenu(null) }, color: C.text },
              { label: '📂 파일 위치 열기', action: () => { window.api.showItemInFolder(contextMenu.doc.file_path); setContextMenu(null) }, color: C.text },
            ].map(({ label, action, color }) => (
              <div key={label} onClick={action} style={{ ...menuItemStyle, color }}
                onMouseEnter={e => e.currentTarget.style.background = C.hover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >{label}</div>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '4px 0', padding: '4px 14px 2px', fontSize: 10, color: '#44445a', fontWeight: 500 }}>폴더로 이동</div>
            {[{ id: null as number | null, name: '📂 분류 없음' }, ...folders.map(f => ({ id: f.id, name: `📁 ${f.name}` }))].map(item => (
              <div key={item.id ?? 'none'} onClick={() => { onMoveDocument(contextMenu.doc, item.id); setContextMenu(null) }}
                style={{ ...menuItemStyle, color: C.text }}
                onMouseEnter={e => e.currentTarget.style.background = C.hover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >{item.name}</div>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
              <div onClick={() => handleDelete(contextMenu.doc)}
                style={{ ...menuItemStyle, color: '#e07070' }}
                onMouseEnter={e => e.currentTarget.style.background = '#2e1515'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >🗑️ 삭제</div>
            </div>
          </div>
        </div>
      )}

      {/* 태그 패널 */}
      {tagMenuDoc && (
        <div style={{ position: 'fixed', top: contextMenu?.y ?? 100, left: (contextMenu?.x ?? 256) + 192, background: '#2a2a33', border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 10000, minWidth: 164, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }}
          onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '8px 14px 6px', fontSize: 10, color: '#55556a', borderBottom: `1px solid ${C.border}`, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>태그 선택</div>
          {tags.length === 0 && <div style={{ padding: '12px 14px', fontSize: 12, color: C.muted }}>태그가 없습니다</div>}
          {tags.map((t) => {
            const has = docTags.find(dt => dt.id === t.id)
            return (
              <div key={t.id} onClick={() => handleToggleTag(t)}
                style={{ padding: '8px 14px', fontSize: 12, color: C.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = C.hover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>#{t.name}</span>
                {has && <span style={{ color: '#4eca7c', fontSize: 14 }}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
