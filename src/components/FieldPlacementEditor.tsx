import { useState, useRef, useCallback, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'
import { FieldType, FIELD_TYPES, SIGNER_COLORS, type DocumentField } from '../types/fields'

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
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function FieldPlacementEditor({ pdfUrl, signers, onComplete, onCancel }: FieldPlacementEditorProps) {
  const [numPages, setNumPages] = useState(0)
  const [fields, setFields] = useState<PlacedField[]>([])
  const [activeSignerIndex, setActiveSignerIndex] = useState(0)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [draggingType, setDraggingType] = useState<FieldType | null>(null)
  const [pdfLoading, setPdfLoading] = useState(true)
  const [showMobilePalette, setShowMobilePalette] = useState(false)
  const [tapPlaceType, setTapPlaceType] = useState<FieldType | null>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

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
    }
    setFields(prev => [...prev, newField])
    setSelectedFieldId(newField.tempId)
    setTapPlaceType(null)
    setShowMobilePalette(false)
  }, [activeSignerIndex])

  // ── Drag from palette (desktop) ────────────────────────────────────────────

  function handlePaletteDragStart(e: React.DragEvent, fieldType: FieldType) {
    setDraggingType(fieldType)
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
    setDraggingType(null)
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
      sort_order: i,
    }))
    onComplete(output as any)
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

  const fieldTypes = Object.entries(FIELD_TYPES) as [FieldType, typeof FIELD_TYPES[FieldType]][]

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

      {/* ── Signer selector bar ─────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex gap-2 overflow-x-auto flex-shrink-0">
        {signers.map((signer, i) => {
          const color = SIGNER_COLORS[i % SIGNER_COLORS.length]
          const count = fields.filter(f => f.signerIndex === i).length
          return (
            <button
              key={i}
              onClick={() => setActiveSignerIndex(i)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeSignerIndex === i
                  ? `${color.bg} ${color.text} ring-2 ring-offset-1`
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
              style={activeSignerIndex === i ? { '--tw-ring-color': color.hex } as any : undefined}
            >
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: color.hex }}>
                {signer.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
              </span>
              {signer.name}
              {count > 0 && (
                <span className={`${color.bg} ${color.text} text-xs font-bold px-1.5 py-0.5 rounded-full`}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Desktop sidebar (field palette) ──────────────────────────────── */}
        <aside className="hidden md:flex flex-col w-56 bg-white border-r border-gray-200 flex-shrink-0 overflow-y-auto">
          <div className="p-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">Campi</p>
            <div className="space-y-1">
              {fieldTypes.map(([type, config]) => (
                <div
                  key={type}
                  draggable
                  onDragStart={e => handlePaletteDragStart(e, type)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-blue-50 cursor-grab active:cursor-grabbing transition-colors border border-transparent hover:border-blue-200"
                >
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                      <circle cx="3" cy="3" r="1.2" /><circle cx="3" cy="9" r="1.2" />
                      <circle cx="9" cy="3" r="1.2" /><circle cx="9" cy="9" r="1.2" />
                    </svg>
                  </div>
                  <FieldIcon type={type} className="w-5 h-5 text-gray-500" />
                  <span className="text-sm text-gray-700 font-medium">{config.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Instructions */}
          <div className="mt-auto p-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 leading-relaxed">
              Trascina i campi sul documento per posizionarli. Seleziona il firmatario in alto per assegnare i campi.
            </p>
          </div>
        </aside>

        {/* ── PDF pages (center) ────────────────────────────────────────────── */}
        <div
          className="flex-1 overflow-y-auto px-4 py-6"
          onClick={() => setSelectedFieldId(null)}
        >
          {pdfLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
            </div>
          )}

          <Document
            file={pdfUrl}
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
                      onMouseDown={e => handleFieldMouseDown(e, field.tempId, pageNum)}
                      onTouchStart={e => handleFieldMouseDown(e, field.tempId, pageNum)}
                    >
                      <FieldIcon type={field.fieldType} className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{field.label || FIELD_TYPES[field.fieldType].label}</span>

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
          <div className="bg-white border-t border-gray-200 px-4 pb-6 pt-2 grid grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto">
            {fieldTypes.map(([type, config]) => (
              <button
                key={type}
                onClick={() => { setTapPlaceType(type); setShowMobilePalette(false) }}
                className="flex items-center gap-2.5 px-3 py-3 rounded-xl bg-gray-50 hover:bg-blue-50 transition-colors border border-gray-100 text-left"
              >
                <FieldIcon type={type} className="w-5 h-5 text-gray-500 flex-shrink-0" />
                <span className="text-sm text-gray-700 font-medium">{config.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
