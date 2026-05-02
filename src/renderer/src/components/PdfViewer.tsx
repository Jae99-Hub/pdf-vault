import React, { useEffect, useRef, useState } from 'react'
import { Document, Memo, TextHighlight } from '../types'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString()

const C = {
  bg: '#16161a',
  surface: '#1e1e24',
  toolbar: '#1a1a20',
  border: '#2a2a33',
  borderLight: '#32323e',
  text: '#e2e2e8',
  textMuted: '#8888a0',
  textDim: '#4a4a5a',
  accent: '#4d94e8',
  accentDim: '#1a3560',
  canvas: '#2a2a32',
  panelBg: '#1a1a20',
  danger: '#e05555',
}

const HIGHLIGHT_COLORS = ['#ffe066', '#90e89a', '#7ac8f5', '#f5a0d0', '#ffb347']

interface NormalizedRect { x: number; y: number; w: number; h: number }

interface Props {
  document: Document | null
  onPageCountUpdate?: (docId: number, pageCount: number) => void
}

export default function PdfViewer({ document, onPageCountUpdate }: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageContainerRef = useRef<HTMLDivElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const textLayerTaskRef = useRef<any>(null)

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.2)

  const [memos, setMemos] = useState<Memo[]>([])
  const [highlights, setHighlights] = useState<TextHighlight[]>([])
  const [showMemoInput, setShowMemoInput] = useState(false)
  const [memoText, setMemoText] = useState('')
  const [showPanel, setShowPanel] = useState(true)
  const [activeTab, setActiveTab] = useState<'memo' | 'highlight'>('memo')

  const [selectionPopup, setSelectionPopup] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!document) return
    loadPdf(document.file_path)
    loadMemos(document.id)
    loadHighlights(document.id)
    setCurrentPage(1)
  }, [document])

  useEffect(() => {
    if (pdfDoc) renderPage(currentPage)
  }, [pdfDoc, currentPage, scale])

  useEffect(() => {
    function onGlobalClick(): void { setSelectionPopup(null) }
    window.addEventListener('mousedown', onGlobalClick)
    return () => window.removeEventListener('mousedown', onGlobalClick)
  }, [])

  async function extractAndIndex(pdf: pdfjsLib.PDFDocumentProxy, docId: number): Promise<void> {
    const maxPages = Math.min(pdf.numPages, 50)
    let text = ''
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      text += content.items.map((item: any) => ('str' in item ? item.str : '')).join(' ') + ' '
    }
    if (text.trim()) await window.api.indexPdfContent(docId, text.trim())
  }

  async function loadPdf(filePath: string): Promise<void> {
    try {
      const buffer = await window.api.readPdfBuffer(filePath)
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
      setPdfDoc(pdf)
      setTotalPages(pdf.numPages)
      if (document && document.page_count === 0) {
        window.api.updatePageCount(document.id, pdf.numPages)
        onPageCountUpdate?.(document.id, pdf.numPages)
      }
      if (document) extractAndIndex(pdf, document.id).catch(() => {})
    } catch (e) {
      console.error('PDF 로드 실패:', e)
    }
  }

  async function renderPage(pageNum: number): Promise<void> {
    if (!pdfDoc || !canvasRef.current) return

    if (renderTaskRef.current) renderTaskRef.current.cancel()
    if (textLayerTaskRef.current?.cancel) textLayerTaskRef.current.cancel()

    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale })
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    canvas.width = viewport.width
    canvas.height = viewport.height

    const task = page.render({ canvasContext: ctx, viewport })
    renderTaskRef.current = task
    try { await task.promise } catch { return }

    if (textLayerRef.current) {
      const tl = textLayerRef.current
      tl.style.width = `${viewport.width}px`
      tl.style.height = `${viewport.height}px`
      tl.innerHTML = ''
      try {
        const textContent = await page.getTextContent()
        const textTask = (pdfjsLib as any).renderTextLayer({
          textContentSource: textContent,
          container: tl,
          viewport,
        })
        textLayerTaskRef.current = textTask
        if (textTask?.promise) await textTask.promise
      } catch { /* 스캔 PDF 등 텍스트 없는 경우 */ }
    }
  }

  async function loadMemos(docId: number): Promise<void> {
    setMemos(await window.api.getMemos(docId))
  }

  async function loadHighlights(docId: number): Promise<void> {
    setHighlights(await window.api.getTextHighlights(docId))
  }

  async function handleAddMemo(): Promise<void> {
    if (!document || !memoText.trim()) return
    await window.api.addMemo(document.id, currentPage, memoText.trim())
    setMemoText('')
    setShowMemoInput(false)
    loadMemos(document.id)
  }

  async function handleDeleteMemo(memoId: number): Promise<void> {
    await window.api.deleteMemo(memoId)
    if (document) loadMemos(document.id)
  }

  async function handleDeleteHighlight(highlightId: number): Promise<void> {
    await window.api.deleteTextHighlight(highlightId)
    if (document) loadHighlights(document.id)
  }

  function handlePageContainerMouseUp(e: React.MouseEvent): void {
    setTimeout(() => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelectionPopup(null); return }
      const range = sel.getRangeAt(0)
      if (range.collapsed) { setSelectionPopup(null); return }
      if (!textLayerRef.current?.contains(range.commonAncestorContainer as Node)) { setSelectionPopup(null); return }
      setSelectionPopup({ x: e.clientX, y: e.clientY })
    }, 10)
  }

  async function saveHighlight(color: string): Promise<void> {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount || !pageContainerRef.current) return

    const range = sel.getRangeAt(0)
    const containerRect = pageContainerRef.current.getBoundingClientRect()
    const normalizedRects: NormalizedRect[] = Array.from(range.getClientRects())
      .filter(r => r.width > 1 && r.height > 1)
      .map(r => ({
        x: (r.left - containerRect.left) / containerRect.width,
        y: (r.top - containerRect.top) / containerRect.height,
        w: r.width / containerRect.width,
        h: r.height / containerRect.height,
      }))
      .filter(r => r.x > -0.02 && r.y > -0.02 && r.x + r.w < 1.02 && r.y + r.h < 1.02)

    const selectedText = sel.toString().trim().slice(0, 300)
    sel.removeAllRanges()
    setSelectionPopup(null)

    if (!document || normalizedRects.length === 0) return
    await window.api.addTextHighlight(document.id, currentPage, JSON.stringify(normalizedRects), selectedText, color)
    loadHighlights(document.id)
  }

  const pageHighlights = highlights.filter(h => h.page === currentPage)

  if (!document) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, background: C.bg, borderLeft: `1px solid ${C.border}` }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: C.surface, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>📄</div>
        <div style={{ fontSize: 13, color: C.textMuted }}>문서를 선택하세요</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0, borderLeft: `1px solid ${C.border}` }}>
      {/* 뷰어 영역 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* 제목 */}
        <div style={{ padding: '0 14px', height: 38, borderBottom: `1px solid ${C.border}`, background: C.toolbar, flexShrink: 0, display: 'flex', alignItems: 'center', fontSize: 12, color: C.text, fontWeight: 500 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{document.title}</span>
        </div>

        {/* 툴바 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 10px', height: 36, borderBottom: `1px solid ${C.border}`, background: C.toolbar, flexShrink: 0 }}>
          <ToolBtn onClick={() => setScale(s => Math.max(0.3, s - 0.2))}>−</ToolBtn>
          <span style={{ fontSize: 11, color: C.textMuted, minWidth: 38, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
          <ToolBtn onClick={() => setScale(s => Math.min(4, s + 0.2))}>+</ToolBtn>
          <Divider />
          <ToolBtn onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>◂</ToolBtn>
          <span style={{ fontSize: 11, color: C.textMuted, minWidth: 52, textAlign: 'center' }}>{currentPage} / {totalPages}</span>
          <ToolBtn onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>▸</ToolBtn>
          <Divider />
          <button onClick={() => setShowMemoInput(v => !v)} style={{ padding: '3px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer', border: `1px solid ${showMemoInput ? C.accent : C.borderLight}`, background: showMemoInput ? C.accentDim : 'transparent', color: showMemoInput ? C.accent : C.textMuted, transition: 'all 0.15s' }}>+ 메모</button>
          <button onClick={() => setShowPanel(v => !v)} style={{ padding: '3px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer', border: `1px solid ${showPanel ? C.borderLight : C.border}`, background: showPanel ? C.surface : 'transparent', color: showPanel ? C.textMuted : C.textDim, transition: 'all 0.15s', marginLeft: 2 }}>패널</button>
        </div>

        {/* 메모 입력 */}
        {showMemoInput && (
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, background: C.surface, display: 'flex', gap: 8, flexShrink: 0 }}>
            <input autoFocus value={memoText}
              onChange={(e) => setMemoText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddMemo()}
              placeholder={`${currentPage}페이지 메모...`}
              style={{ flex: 1, padding: '6px 10px', background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 5, color: C.text, fontSize: 12, outline: 'none' }}
            />
            <button onClick={handleAddMemo} style={{ padding: '6px 14px', background: C.accent, border: 'none', borderRadius: 5, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>저장</button>
          </div>
        )}

        {/* PDF 캔버스 */}
        <div style={{ flex: 1, overflow: 'auto', background: C.canvas, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24 }}>
          <div
            ref={pageContainerRef}
            style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}
            onMouseUp={handlePageContainerMouseUp}
          >
            <canvas ref={canvasRef} style={{ display: 'block', boxShadow: '0 4px 24px rgba(0,0,0,0.6)', borderRadius: 2 }} />

            {/* 하이라이트 레이어 */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
              {pageHighlights.map(h => {
                const rects: NormalizedRect[] = JSON.parse(h.rects)
                return rects.map((r, i) => (
                  <div key={`${h.id}-${i}`} style={{
                    position: 'absolute',
                    left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`, height: `${r.h * 100}%`,
                    background: h.color, opacity: 0.45,
                    mixBlendMode: 'multiply', borderRadius: 2,
                  }} />
                ))
              })}
            </div>

            {/* 텍스트 레이어 */}
            <div ref={textLayerRef} className="pdf-text-layer" style={{ zIndex: 2 }} />
          </div>
        </div>
      </div>

      {/* 오른쪽 패널 */}
      {showPanel && (
        <div style={{ width: 220, flexShrink: 0, borderLeft: `1px solid ${C.border}`, background: C.panelBg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 탭 */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            {(['memo', 'highlight'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                flex: 1, height: 36, border: 'none', cursor: 'pointer', fontSize: 11,
                background: activeTab === tab ? C.surface : 'transparent',
                color: activeTab === tab ? C.text : C.textDim,
                borderBottom: activeTab === tab ? `2px solid ${C.accent}` : '2px solid transparent',
                fontWeight: activeTab === tab ? 600 : 400, transition: 'all 0.15s',
              }}>
                {tab === 'memo'
                  ? `메모${memos.length > 0 ? ` (${memos.length})` : ''}`
                  : `하이라이트${highlights.length > 0 ? ` (${highlights.length})` : ''}`}
              </button>
            ))}
          </div>

          {/* 메모 탭 */}
          {activeTab === 'memo' && (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {memos.length === 0 && <div style={{ padding: 20, color: C.textDim, fontSize: 11, textAlign: 'center', lineHeight: 1.6 }}>메모가 없습니다</div>}
              {memos.map(m => (
                <div key={m.id} style={{ padding: '9px 12px', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, background: C.accentDim, borderRadius: 4, padding: '1px 6px', maxWidth: 'fit-content' }}>p.{m.page}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textDim, cursor: 'pointer', padding: '0 3px', transition: 'color 0.15s' }}
                      onClick={() => handleDeleteMemo(m.id)}
                      onMouseEnter={e => (e.currentTarget.style.color = C.danger)}
                      onMouseLeave={e => (e.currentTarget.style.color = C.textDim)}>✕</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>{m.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* 하이라이트 탭 */}
          {activeTab === 'highlight' && (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {highlights.length === 0 && (
                <div style={{ padding: 20, color: C.textDim, fontSize: 11, textAlign: 'center', lineHeight: 1.7 }}>
                  하이라이트가 없습니다<br />
                  <span style={{ fontSize: 10, opacity: 0.6 }}>텍스트를 드래그해 추가하세요</span>
                </div>
              )}
              {highlights.map(h => (
                <div key={h.id}
                  onClick={() => setCurrentPage(h.page)}
                  style={{ padding: '9px 12px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#22222e')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: h.selected_text ? 5 : 0 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: h.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, background: C.accentDim, borderRadius: 4, padding: '1px 6px' }}>p.{h.page}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textDim, cursor: 'pointer', padding: '0 3px', transition: 'color 0.15s' }}
                      onClick={e => { e.stopPropagation(); handleDeleteHighlight(h.id) }}
                      onMouseEnter={e => (e.currentTarget.style.color = C.danger)}
                      onMouseLeave={e => (e.currentTarget.style.color = C.textDim)}>✕</span>
                  </div>
                  {h.selected_text && (
                    <div style={{ fontSize: 11, color: '#c8c8d8', lineHeight: 1.5, background: `${h.color}25`, borderLeft: `3px solid ${h.color}`, padding: '3px 7px', borderRadius: '0 3px 3px 0', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any }}>
                      {h.selected_text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 형광펜 색 선택 팝업 */}
      {selectionPopup && (
        <div
          style={{ position: 'fixed', left: selectionPopup.x - 8, top: selectionPopup.y - 46, zIndex: 99999, background: '#22222a', border: '1px solid #3a3a48', borderRadius: 10, padding: '6px 10px', display: 'flex', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.6)' }}
          onMouseDown={e => e.stopPropagation()}
        >
          {HIGHLIGHT_COLORS.map(color => (
            <div key={color}
              onClick={() => saveHighlight(color)}
              style={{ width: 22, height: 22, borderRadius: '50%', background: color, cursor: 'pointer', border: '2px solid rgba(255,255,255,0.15)', transition: 'transform 0.12s, border-color 0.12s', flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.25)'; e.currentTarget.style.borderColor = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${disabled ? '#252530' : '#32323e'}`, borderRadius: 5, color: disabled ? '#3a3a4a' : '#9898a8', fontSize: 12, cursor: disabled ? 'default' : 'pointer', transition: 'all 0.15s', minWidth: 26, textAlign: 'center' }}>
      {children}
    </button>
  )
}

function Divider(): React.ReactElement {
  return <div style={{ width: 1, background: '#2a2a33', height: 16, margin: '0 4px' }} />
}
