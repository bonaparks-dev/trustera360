import { useState, useRef, useCallback, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { FIELD_TYPES, SIGNER_COLORS } from '../types/fields'
import type { FieldType, DocumentField } from '../types/fields'

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

interface SignerInfo {
  name: string
  email: string
}

interface FieldPlacementEditorProps {
  pdfUrl: string
  signers: SignerInfo[]
  onComplete: (fields: Omit<DocumentField, 'id' | 'document_id' | 'signer_id'>[]) => void
  onCancel: () => void
}

interface PlacedField {
  tempId: string
  fieldType: FieldType
  signerIndex: number
  pageNumber: number
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
  label?: string
  required: boolean
  radioGroup?: string
  placeholder?: string
  fontSize?: number
  fontStyle?: string
  defaultValue?: string
}

// Font options for signature fields
const FONT_STYLES = [
  { value: 'handwriting', label: 'Handwriting', css: "'Caveat', 'Dancing Script', cursive" },
  { value: 'serif', label: 'Serif', css: "'Georgia', 'Times New Roman', serif" },
  { value: 'sans-serif', label: 'Sans-serif', css: "'Helvetica', 'Arial', sans-serif" },
  { value: 'monospace', label: 'Monospace', css: "'Courier New', monospace" },
]

function getFontCss(style?: string) {
  return FONT_STYLES.find(f => f.value === style)?.css || FONT_STYLES[0].css
}

let fieldCounter = 0
function nextTempId() {
  return `field_${++fieldCounter}_${Date.now()}`
}

// ─── Field type icons (inline SVGs) ─────────────────────────────────────────

function FieldIcon({ type, className }: { type: FieldType; className?: string }) {
  const cls = className || 'w-5 h-5'
  switch (type) {
    case 'signature':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
    case 'date':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
    case 'name':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
    case 'email':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
    case 'text':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" /></svg>
    case 'label':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor"><text x="4" y="18" fontSize="16" fontWeight="bold" fill="currentColor" stroke="none">99</text></svg>
    case 'checkbox':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    case 'radio':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" /></svg>
    case 'initials':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor"><text x="3" y="18" fontSize="14" fontWeight="bold" fontStyle="italic" fill="currentColor" stroke="none">A.B.</text></svg>
    case 'readonly':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.2 48.2 0 0 0 5.166-.479c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

// Field types split into categories
const GLOBAL_FIELD_TYPES: FieldType[] = ['readonly', 'initials']
const SIGNER_FIELD_TYPES: FieldType[] = ['signature', 'date', 'name', 'email', 'text', 'label', 'checkbox', 'radio']

export default function FieldPlacementEditor({ pdfUrl, signers, onComplete, onCancel }: FieldPlacementEditorProps) {
  const [numPages, setNumPages] = useState(0)
  const [fields, setFields] = useState<PlacedField[]>([])
  const [activeSignerIndex, setActiveSignerIndex] = useState(0)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(true)
  const [showMobilePalette, setShowMobilePalette] = useState(false)
  const [tapPlaceType, setTapPlaceType] = useState<FieldType | null>(null)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [expandedSignerIndex, setExpandedSignerIndex] = useState<number | null>(0)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  function toggleSection(key: string) {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Fetch PDF as blob to avoid CORS issues with Supabase storage
  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false
    async function loadPdf() {
      try {
        const res = await fetch(pdfUrl)
        if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
        const blob = await res.blob()
        if (!cancelled) {
          const url = URL.createObjectURL(blob)
          setPdfBlobUrl(url)
        }
      } catch (err: any) {
        console.error('[FieldPlacementEditor] PDF load error:', err)
        if (!cancelled) setPdfError(err.message)
      }
    }
    loadPdf()
    return () => { cancelled = true }
  }, [pdfUrl])

  // Drag state for repositioning existing fields
  const dragRef = useRef<{
    fieldId: string
    startX: number
    startY: number
    startFieldX: number
    startFieldY: number
    pageEl: HTMLDivElement
  } | null>(null)

  function onDocumentLoadSuccess({ numPages: n }: { numPages: number }) {
    setNumPages(n)
    setPdfLoading(false)
  }

  // ── Add field from drop or tap ─────────────────────────────────────────────

  const addFieldAtPosition = useCallback((fieldType: FieldType, pageNumber: number, xPercent: number, yPercent: number) => {
    const config = FIELD_TYPES[fieldType]
    const signer = signers[activeSignerIndex]
    const newField: PlacedField = {
      tempId: nextTempId(),
      fieldType,
      signerIndex: activeSignerIndex,
      pageNumber,
      xPercent: Math.max(0, Math.min(100 - config.defaultWidth, xPercent)),
      yPercent: Math.max(0, Math.min(100 - config.defaultHeight, yPercent)),
      widthPercent: config.defaultWidth,
      heightPercent: config.defaultHeight,
      required: true,
      // Smart defaults
      ...(fieldType === 'initials' && signer ? {
        defaultValue: signer.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3),
      } : {}),
      ...(fieldType === 'signature' ? { fontStyle: 'handwriting', fontSize: 18 } : {}),
      ...(fieldType === 'name' && signer ? { defaultValue: signer.name } : {}),
    }
    setFields(prev => [...prev, newField])
    setSelectedFieldId(newField.tempId)
    setTapPlaceType(null)
    setShowMobilePalette(false)
  }, [activeSignerIndex, signers])

  // ── Drag from palette (desktop) ────────────────────────────────────────────

  function handlePaletteDragStart(e: React.DragEvent, fieldType: FieldType) {

    e.dataTransfer.setData('fieldType', fieldType)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handlePageDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handlePageDrop(e: React.DragEvent, pageNumber: number) {
    e.preventDefault()
    const fieldType = e.dataTransfer.getData('fieldType') as FieldType
    if (!fieldType) return

    const pageEl = pageRefs.current.get(pageNumber)
    if (!pageEl) return

    const rect = pageEl.getBoundingClientRect()
    const xPercent = ((e.clientX - rect.left) / rect.width) * 100
    const yPercent = ((e.clientY - rect.top) / rect.height) * 100

    addFieldAtPosition(fieldType, pageNumber, xPercent, yPercent)

  }

  // ── Tap to place (mobile) ──────────────────────────────────────────────────

  function handlePageTap(e: React.MouseEvent, pageNumber: number) {
    if (!tapPlaceType) return
    const pageEl = pageRefs.current.get(pageNumber)
    if (!pageEl) return

    const rect = pageEl.getBoundingClientRect()
    const xPercent = ((e.clientX - rect.left) / rect.width) * 100
    const yPercent = ((e.clientY - rect.top) / rect.height) * 100

    addFieldAtPosition(tapPlaceType, pageNumber, xPercent, yPercent)
  }

  // ── Drag to reposition existing field ──────────────────────────────────────

  function handleFieldMouseDown(e: React.MouseEvent | React.TouchEvent, fieldId: string, pageNumber: number) {
    e.stopPropagation()
    e.preventDefault()
    setSelectedFieldId(fieldId)

    const field = fields.find(f => f.tempId === fieldId)
    if (!field) return

    const pageEl = pageRefs.current.get(pageNumber)
    if (!pageEl) return

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    dragRef.current = {
      fieldId,
      startX: clientX,
      startY: clientY,
      startFieldX: field.xPercent,
      startFieldY: field.yPercent,
      pageEl,
    }
  }

  useEffect(() => {
    function handleMove(e: MouseEvent | TouchEvent) {
      if (!dragRef.current) return
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

      const { fieldId, startX, startY, startFieldX, startFieldY, pageEl } = dragRef.current
      const rect = pageEl.getBoundingClientRect()
      const dx = ((clientX - startX) / rect.width) * 100
      const dy = ((clientY - startY) / rect.height) * 100

      setFields(prev => prev.map(f => {
        if (f.tempId !== fieldId) return f
        return {
          ...f,
          xPercent: Math.max(0, Math.min(100 - f.widthPercent, startFieldX + dx)),
          yPercent: Math.max(0, Math.min(100 - f.heightPercent, startFieldY + dy)),
        }
      }))
    }

    function handleUp() {
      dragRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('touchmove', handleMove, { passive: false })
    window.addEventListener('touchend', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleUp)
    }
  }, [])

  // ── Delete field ───────────────────────────────────────────────────────────

  function deleteField(fieldId: string) {
    setFields(prev => prev.filter(f => f.tempId !== fieldId))
    if (selectedFieldId === fieldId) setSelectedFieldId(null)
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  function handleSubmit() {
    const output = fields.map((f, i) => ({
      signer_index: f.signerIndex,
      field_type: f.fieldType,
      label: f.label || FIELD_TYPES[f.fieldType].label,
      page_number: f.pageNumber,
      x_percent: f.xPercent,
      y_percent: f.yPercent,
      width_percent: f.widthPercent,
      height_percent: f.heightPercent,
      required: f.required,
      placeholder: f.placeholder,
      radio_group: f.radioGroup,
      default_value: f.defaultValue,
      font_size: f.fontSize,
      font_style: f.fontStyle,
      sort_order: i,
    }))
    onComplete(output as any)
  }

  function updateField(fieldId: string, updates: Partial<PlacedField>) {
    setFields(prev => prev.map(f => f.tempId === fieldId ? { ...f, ...updates } : f))
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFieldId && !(e.target instanceof HTMLInputElement)) {
          deleteField(selectedFieldId)
        }
      }
      if (e.key === 'Escape') {
        setSelectedFieldId(null)
        setTapPlaceType(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedFieldId])

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-gray-100 z-50 flex flex-col">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0 z-20">
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 font-medium">
          Annulla
        </button>
        <h2 className="text-[15px] font-semibold text-gray-900">Posiziona i campi</h2>
        <button
          onClick={handleSubmit}
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
        >
          Invia per Firma ({fields.length})
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Desktop sidebar (YouSign-style) ──────────────────────────────── */}
        <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200 flex-shrink-0 overflow-y-auto">

          {/* ── Campi (global fields) ── */}
          <div className="border-b border-gray-100">
            <button
              onClick={() => toggleSection('campi')}
              className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              <span className="text-sm font-semibold text-gray-800 flex-1 text-left">Campi</span>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${collapsedSections['campi'] ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
              </svg>
            </button>
            {!collapsedSections['campi'] && (
              <div className="px-3 pb-3 space-y-1">
                {GLOBAL_FIELD_TYPES.map(type => (
                  <div
                    key={type}
                    draggable
                    onDragStart={e => handlePaletteDragStart(e, type)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-blue-50/50 hover:bg-blue-100/60 cursor-grab active:cursor-grabbing transition-colors"
                  >
                    <svg className="w-3 h-3 text-gray-300" viewBox="0 0 12 12" fill="currentColor">
                      <circle cx="3" cy="3" r="1.2" /><circle cx="3" cy="9" r="1.2" />
                      <circle cx="9" cy="3" r="1.2" /><circle cx="9" cy="9" r="1.2" />
                    </svg>
                    <FieldIcon type={type} className="w-5 h-5 text-gray-500" />
                    <span className="text-sm text-gray-700 font-medium">{FIELD_TYPES[type].label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Firmatari ── */}
          <div className="border-b border-gray-100">
            <button
              onClick={() => toggleSection('firmatari')}
              className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              <span className="text-sm font-semibold text-gray-800 flex-1 text-left">Firmatari</span>
              <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{signers.length}</span>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${collapsedSections['firmatari'] ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
              </svg>
            </button>
            {!collapsedSections['firmatari'] && (
              <div className="pb-2">
                {signers.map((signer, i) => {
                  const color = SIGNER_COLORS[i % SIGNER_COLORS.length]
                  const count = fields.filter(f => f.signerIndex === i).length
                  const isExpanded = expandedSignerIndex === i
                  const initials = signer.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

                  return (
                    <div key={i}>
                      {/* Signer header */}
                      <button
                        onClick={() => { setActiveSignerIndex(i); setExpandedSignerIndex(isExpanded ? null : i) }}
                        className={`w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 transition-colors ${
                          activeSignerIndex === i ? 'bg-gray-50' : ''
                        }`}
                      >
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ backgroundColor: color.hex }}>
                          {initials}
                        </span>
                        <span className="text-sm font-medium text-gray-800 flex-1 text-left uppercase truncate">{signer.name}</span>
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: color.hex + '20', color: color.hex }}>
                          {count}
                        </span>
                        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Signer's field palette */}
                      {isExpanded && (
                        <div className="px-3 pb-2 space-y-1">
                          {SIGNER_FIELD_TYPES.map(type => (
                            <div
                              key={type}
                              draggable
                              onDragStart={e => { setActiveSignerIndex(i); handlePaletteDragStart(e, type) }}
                              className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-blue-50/50 hover:bg-blue-100/60 cursor-grab active:cursor-grabbing transition-colors"
                            >
                              <svg className="w-3 h-3 text-gray-300" viewBox="0 0 12 12" fill="currentColor">
                                <circle cx="3" cy="3" r="1.2" /><circle cx="3" cy="9" r="1.2" />
                                <circle cx="9" cy="3" r="1.2" /><circle cx="9" cy="9" r="1.2" />
                              </svg>
                              <FieldIcon type={type} className="w-5 h-5 text-gray-500" />
                              <span className="text-sm text-gray-700 font-medium">{FIELD_TYPES[type].label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="mt-auto p-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 leading-relaxed">
              Trascina i campi sul documento per posizionarli. Espandi un firmatario per assegnare i campi.
            </p>
          </div>
        </aside>

        {/* ── PDF pages (center) ────────────────────────────────────────────── */}
        <div
          className="flex-1 overflow-y-auto px-4 py-6"
          onClick={() => setSelectedFieldId(null)}
        >
          {(pdfLoading || !pdfBlobUrl) && !pdfError && (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
            </div>
          )}

          {pdfError && (
            <div className="flex items-center justify-center py-20 text-red-500 text-sm">
              Errore nel caricamento del PDF: {pdfError}
            </div>
          )}

          <Document
            file={pdfBlobUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading=""
            className="flex flex-col items-center gap-6"
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
              <div
                key={pageNum}
                className="relative shadow-lg bg-white"
                ref={el => { if (el) pageRefs.current.set(pageNum, el) }}
                onDragOver={handlePageDragOver}
                onDrop={e => handlePageDrop(e, pageNum)}
                onClick={e => handlePageTap(e, pageNum)}
                style={{ cursor: tapPlaceType ? 'crosshair' : 'default' }}
              >
                <Page
                  pageNumber={pageNum}
                  width={Math.min(700, window.innerWidth - (window.innerWidth >= 768 ? 280 : 32))}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />

                {/* Page number label */}
                <div className="absolute bottom-2 right-3 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                  {pageNum} / {numPages}
                </div>

                {/* Placed fields on this page */}
                {fields.filter(f => f.pageNumber === pageNum).map(field => {
                  const color = SIGNER_COLORS[field.signerIndex % SIGNER_COLORS.length]
                  const isSelected = selectedFieldId === field.tempId
                  return (
                    <div
                      key={field.tempId}
                      className={`absolute flex items-center gap-1 px-1.5 rounded-md border-2 transition-shadow text-xs font-medium truncate select-none ${
                        isSelected ? 'ring-2 ring-offset-1 shadow-lg z-10' : 'shadow-sm z-[5]'
                      }`}
                      style={{
                        left: `${field.xPercent}%`,
                        top: `${field.yPercent}%`,
                        width: `${field.widthPercent}%`,
                        height: `${field.heightPercent}%`,
                        backgroundColor: color.hex + '20',
                        borderColor: color.hex,
                        color: color.hex,
                        cursor: 'grab',
                        '--tw-ring-color': color.hex,
                      } as any}
                      onClick={e => { e.stopPropagation(); setSelectedFieldId(field.tempId) }}
                      onDoubleClick={e => { e.stopPropagation(); setEditingFieldId(field.tempId) }}
                      onMouseDown={e => handleFieldMouseDown(e, field.tempId, pageNum)}
                      onTouchStart={e => handleFieldMouseDown(e, field.tempId, pageNum)}
                    >
                      <FieldIcon type={field.fieldType} className="w-3.5 h-3.5 flex-shrink-0" />
                      <span
                        className="truncate"
                        style={field.fieldType === 'signature' || field.fieldType === 'initials' ? {
                          fontFamily: getFontCss(field.fontStyle),
                          fontSize: field.fontSize ? `${Math.min(field.fontSize, 14)}px` : undefined,
                          fontStyle: field.fieldType === 'initials' ? 'italic' : undefined,
                        } : undefined}
                      >
                        {field.defaultValue || field.label || FIELD_TYPES[field.fieldType].label}
                      </span>

                      {/* Delete button when selected */}
                      {isSelected && (
                        <button
                          onClick={e => { e.stopPropagation(); deleteField(field.tempId) }}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 shadow z-20"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </Document>
        </div>
      </div>

      {/* ── Field Settings Modal (double-click) ─────────────────────────── */}
      {editingFieldId && (() => {
        const field = fields.find(f => f.tempId === editingFieldId)
        if (!field) return null
        const signer = signers[field.signerIndex]
        return (
          <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => setEditingFieldId(null)}>
            <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-gray-900">Impostazioni campo</h3>
                <button onClick={() => setEditingFieldId(null)} className="text-gray-400 hover:text-gray-600 p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Field type indicator */}
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl">
                  <FieldIcon type={field.fieldType} className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">{FIELD_TYPES[field.fieldType].label}</span>
                  {signer && <span className="ml-auto text-xs text-gray-400">{signer.name}</span>}
                </div>

                {/* Label */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Etichetta</label>
                  <input
                    type="text"
                    value={field.label || ''}
                    onChange={e => updateField(field.tempId, { label: e.target.value })}
                    placeholder={FIELD_TYPES[field.fieldType].label}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                  />
                </div>

                {/* Default value — for initials, name, readonly, label */}
                {['initials', 'name', 'readonly', 'label', 'signature'].includes(field.fieldType) && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">
                      {field.fieldType === 'initials' ? 'Iniziali' : field.fieldType === 'signature' ? 'Nome completo' : 'Valore predefinito'}
                    </label>
                    <input
                      type="text"
                      value={field.defaultValue || ''}
                      onChange={e => updateField(field.tempId, { defaultValue: e.target.value })}
                      placeholder={
                        field.fieldType === 'initials' ? (signer ? signer.name.split(' ').map(w => w[0]).join('').toUpperCase() : 'A.B.')
                        : field.fieldType === 'signature' ? (signer?.name || 'Nome Cognome')
                        : 'Testo...'
                      }
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                    />
                  </div>
                )}

                {/* Placeholder — for text input */}
                {field.fieldType === 'text' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Placeholder</label>
                    <input
                      type="text"
                      value={field.placeholder || ''}
                      onChange={e => updateField(field.tempId, { placeholder: e.target.value })}
                      placeholder="Testo suggerito..."
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                    />
                  </div>
                )}

                {/* Font style — for signature and initials */}
                {(field.fieldType === 'signature' || field.fieldType === 'initials') && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Stile font</label>
                    <div className="grid grid-cols-2 gap-2">
                      {FONT_STYLES.map(fs => (
                        <button
                          key={fs.value}
                          onClick={() => updateField(field.tempId, { fontStyle: fs.value })}
                          className={`px-3 py-2.5 rounded-xl border text-sm transition-all ${
                            (field.fontStyle || 'handwriting') === fs.value
                              ? 'border-green-500 bg-green-50 text-green-700 font-medium'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <span style={{ fontFamily: fs.css }}>{field.fieldType === 'initials' ? 'A.B.' : 'Mario R.'}</span>
                          <span className="block text-[10px] text-gray-400 mt-0.5">{fs.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Font size */}
                {['signature', 'initials', 'name', 'text', 'label', 'readonly'].includes(field.fieldType) && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">
                      Dimensione font: {field.fontSize || 14}px
                    </label>
                    <input
                      type="range"
                      min={8}
                      max={32}
                      value={field.fontSize || 14}
                      onChange={e => updateField(field.tempId, { fontSize: parseInt(e.target.value) })}
                      className="w-full accent-green-600"
                    />
                    <div className="flex justify-between text-[10px] text-gray-300 mt-0.5">
                      <span>8px</span><span>32px</span>
                    </div>
                  </div>
                )}

                {/* Required toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Obbligatorio</span>
                  <button
                    onClick={() => updateField(field.tempId, { required: !field.required })}
                    className={`w-10 h-6 rounded-full transition-colors ${field.required ? 'bg-green-500' : 'bg-gray-200'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${field.required ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Radio group — for radio buttons */}
                {field.fieldType === 'radio' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Gruppo radio</label>
                    <input
                      type="text"
                      value={field.radioGroup || ''}
                      onChange={e => updateField(field.tempId, { radioGroup: e.target.value })}
                      placeholder="gruppo_1"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                    />
                  </div>
                )}

                {/* Preview */}
                {(field.fieldType === 'signature' || field.fieldType === 'initials') && (
                  <div className="bg-gray-50 rounded-xl p-4 text-center">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide block mb-2">Anteprima</span>
                    <span
                      style={{
                        fontFamily: getFontCss(field.fontStyle),
                        fontSize: `${field.fontSize || 18}px`,
                        fontStyle: field.fieldType === 'initials' ? 'italic' : undefined,
                      }}
                      className="text-gray-800"
                    >
                      {field.defaultValue || (field.fieldType === 'initials'
                        ? (signer?.name.split(' ').map(w => w[0]).join('').toUpperCase() || 'A.B.')
                        : (signer?.name || 'Mario Rossi')
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => setEditingFieldId(null)}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  Salva
                </button>
                <button
                  onClick={() => { deleteField(field.tempId); setEditingFieldId(null) }}
                  className="px-4 py-2.5 border border-red-200 text-red-500 hover:bg-red-50 rounded-xl transition-colors text-sm font-medium"
                >
                  Elimina
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Mobile bottom sheet (field palette) ────────────────────────────── */}
      <div className="md:hidden">
        {/* Tap place indicator */}
        {tapPlaceType && (
          <div className="bg-blue-50 border-t border-blue-200 px-4 py-2.5 flex items-center justify-between">
            <p className="text-sm text-blue-700 font-medium">
              Tocca il documento per posizionare: {FIELD_TYPES[tapPlaceType].label}
            </p>
            <button onClick={() => setTapPlaceType(null)} className="text-blue-600 text-sm font-semibold">Annulla</button>
          </div>
        )}

        {/* Toggle button */}
        {!tapPlaceType && (
          <button
            onClick={() => setShowMobilePalette(!showMobilePalette)}
            className="w-full bg-white border-t border-gray-200 px-4 py-3 flex items-center justify-between"
          >
            <span className="text-sm font-semibold text-gray-700">Aggiungi campo</span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${showMobilePalette ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          </button>
        )}

        {/* Mobile palette sheet */}
        {showMobilePalette && !tapPlaceType && (
          <div className="bg-white border-t border-gray-200 px-4 pb-6 pt-2 max-h-[50vh] overflow-y-auto">
            {/* Signer selector */}
            <div className="flex gap-2 overflow-x-auto pb-3 mb-2 border-b border-gray-100">
              {signers.map((signer, i) => {
                const color = SIGNER_COLORS[i % SIGNER_COLORS.length]
                return (
                  <button
                    key={i}
                    onClick={() => setActiveSignerIndex(i)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                      activeSignerIndex === i ? 'text-white' : 'bg-gray-100 text-gray-500'
                    }`}
                    style={activeSignerIndex === i ? { backgroundColor: color.hex } : undefined}
                  >
                    {signer.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[...GLOBAL_FIELD_TYPES, ...SIGNER_FIELD_TYPES].map(type => (
                <button
                  key={type}
                  onClick={() => { setTapPlaceType(type); setShowMobilePalette(false) }}
                  className="flex items-center gap-2.5 px-3 py-3 rounded-xl bg-gray-50 hover:bg-blue-50 transition-colors border border-gray-100 text-left"
                >
                  <FieldIcon type={type} className="w-5 h-5 text-gray-500 flex-shrink-0" />
                  <span className="text-sm text-gray-700 font-medium">{FIELD_TYPES[type].label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
