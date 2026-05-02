import React, { useState, useEffect } from 'react'
import { UpdateStatus } from '../types'

const C = {
  bg: '#16161a',
  surface: '#1e1e24',
  card: '#22222b',
  border: '#2a2a33',
  borderLight: '#32323e',
  text: '#e2e2e8',
  textMuted: '#8888a0',
  textDim: '#4a4a5a',
  accent: '#4d94e8',
  accentDim: '#1a3560',
  success: '#4ec97e',
  warning: '#f0c040',
  danger: '#e05555',
}

interface Props {
  isFirstTime: boolean
  onClose: () => void
}

export default function Settings({ isFirstTime, onClose }: Props): React.ReactElement {
  const [vaultPath, setVaultPath] = useState<string>('')
  const [prevPath, setPrevPath] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [migrated, setMigrated] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const appVersion = '__APP_VERSION__'

  useEffect(() => {
    window.api.getVaultPath().then((p) => { setVaultPath(p ?? ''); setPrevPath(p ?? '') })
    window.api.onUpdateStatus(setUpdateStatus)
  }, [])

  async function handlePickFolder(): Promise<void> {
    setLoading(true)
    setMigrated(false)
    const p = await window.api.setVaultPath()
    setLoading(false)
    if (p) {
      if (prevPath && prevPath !== p) setMigrated(true)
      setVaultPath(p)
      setPrevPath(p)
    }
  }

  async function handleCheckUpdate(): Promise<void> {
    setUpdateStatus({ type: 'checking' })
    await window.api.checkForUpdates()
  }

  const canClose = !isFirstTime || !!vaultPath

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget && canClose) onClose() }}
    >
      <div style={{ background: C.card, borderRadius: 12, padding: '30px 32px', border: `1px solid ${C.border}`, width: 480, boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>

        {/* 헤더 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 6 }}>
            {isFirstTime ? 'PDF Vault 초기 설정' : '설정'}
          </div>
          {isFirstTime && (
            <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.7 }}>
              PDF를 보관할 전용 폴더를 지정해주세요.<br />
              앱에서 추가하는 모든 PDF가 이 폴더에 복사됩니다.
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: 22 }} />

        {/* 보관 폴더 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            보관 폴더 위치
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, padding: '8px 12px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, color: vaultPath ? C.text : C.textDim, fontSize: 11, fontFamily: 'Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.5 }}>
              {vaultPath || '선택된 폴더 없음'}
            </div>
            <button onClick={handlePickFolder} disabled={loading} style={{ padding: '8px 16px', background: loading ? C.accentDim : C.accent, color: '#fff', border: 'none', borderRadius: 7, cursor: loading ? 'default' : 'pointer', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
              {loading ? '이전 중...' : '폴더 선택'}
            </button>
          </div>
          <div style={{ marginTop: 7, minHeight: 18, fontSize: 11 }}>
            {loading && <span style={{ color: C.warning }}>⏳ 기존 파일을 새 위치로 이동 중입니다...</span>}
            {!loading && migrated && <span style={{ color: C.success }}>✓ 기존 파일이 새 위치로 이동되었습니다.</span>}
            {!loading && !migrated && vaultPath && <span style={{ color: C.success }}>✓ 이 폴더에 PDF가 복사되고, 폴더/파일명 변경도 동기화됩니다.</span>}
          </div>
        </div>

        {/* 업데이트 — 초기 설정 화면에서는 숨김 */}
        {!isFirstTime && (
          <>
            <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: 22 }} />
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                업데이트
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: C.textMuted, flex: 1 }}>
                  현재 버전: <span style={{ color: C.text, fontFamily: 'Consolas, monospace' }}>v{appVersion}</span>
                </span>
                {updateStatus?.type !== 'downloading' && updateStatus?.type !== 'downloaded' && (
                  <button
                    onClick={handleCheckUpdate}
                    disabled={updateStatus?.type === 'checking'}
                    style={{ padding: '7px 16px', background: 'transparent', border: `1px solid ${C.borderLight}`, borderRadius: 7, color: updateStatus?.type === 'checking' ? C.textDim : C.textMuted, fontSize: 12, cursor: updateStatus?.type === 'checking' ? 'default' : 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}
                    onMouseEnter={e => { if (updateStatus?.type !== 'checking') { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.text } }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderLight; e.currentTarget.style.color = C.textMuted }}
                  >
                    {updateStatus?.type === 'checking' ? '확인 중...' : '업데이트 확인'}
                  </button>
                )}
              </div>

              {/* 업데이트 상태 메시지 */}
              {updateStatus && (
                <div style={{ marginTop: 12 }}>
                  {updateStatus.type === 'not-available' && (
                    <div style={{ fontSize: 12, color: C.success }}>✓ 최신 버전입니다.</div>
                  )}
                  {updateStatus.type === 'available' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.accentDim, border: `1px solid ${C.accent}40`, borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>새 버전 v{updateStatus.version} 출시</div>
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>다운로드 후 설치할 수 있습니다.</div>
                      </div>
                      <button
                        onClick={() => { window.api.downloadUpdate(); setUpdateStatus({ type: 'downloading', percent: 0 }) }}
                        style={{ padding: '7px 16px', background: C.accent, border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}
                      >다운로드</button>
                    </div>
                  )}
                  {updateStatus.type === 'downloading' && (
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: C.text }}>다운로드 중...</span>
                        <span style={{ fontSize: 12, color: C.accent, fontFamily: 'Consolas, monospace' }}>{updateStatus.percent ?? 0}%</span>
                      </div>
                      <div style={{ background: C.border, borderRadius: 4, height: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: C.accent, borderRadius: 4, width: `${updateStatus.percent ?? 0}%`, transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  )}
                  {updateStatus.type === 'downloaded' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1a3a28', border: `1px solid ${C.success}40`, borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: C.success, fontWeight: 500 }}>다운로드 완료</div>
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>지금 재시작하면 업데이트가 설치됩니다.</div>
                      </div>
                      <button
                        onClick={() => window.api.installUpdate()}
                        style={{ padding: '7px 16px', background: C.success, border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}
                      >재시작 후 설치</button>
                    </div>
                  )}
                  {updateStatus.type === 'error' && (
                    <div style={{ fontSize: 12, color: C.danger }}>오류: {updateStatus.message}</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: 20 }} />

        {/* 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {!isFirstTime && (
            <button onClick={onClose}
              style={{ padding: '8px 20px', background: 'transparent', color: C.textMuted, border: `1px solid ${C.borderLight}`, borderRadius: 7, cursor: 'pointer', fontSize: 12, transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.text }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderLight; e.currentTarget.style.color = C.textMuted }}
            >닫기</button>
          )}
          <button onClick={onClose} disabled={!canClose}
            style={{ padding: '8px 22px', background: canClose ? C.accent : C.accentDim, color: canClose ? '#fff' : C.textDim, border: 'none', borderRadius: 7, cursor: canClose ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600 }}
          >{isFirstTime ? '시작하기' : '확인'}</button>
        </div>
      </div>
    </div>
  )
}
