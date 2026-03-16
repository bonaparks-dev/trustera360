export type FieldType = 'signature' | 'date' | 'name' | 'email' | 'text' | 'label' | 'checkbox' | 'radio'

export interface DocumentField {
  id: string
  document_id: string
  signer_id?: string
  signer_index?: number
  field_type: FieldType
  label?: string
  page_number: number
  x_percent: number
  y_percent: number
  width_percent: number
  height_percent: number
  required: boolean
  placeholder?: string
  radio_group?: string
  default_value?: string
  value?: string
  sort_order: number
}

export interface FieldTypeConfig {
  label: string
  defaultWidth: number
  defaultHeight: number
}

export const FIELD_TYPES: Record<FieldType, FieldTypeConfig> = {
  signature:  { label: 'Firma',                 defaultWidth: 25, defaultHeight: 6 },
  date:       { label: 'Data della firma',      defaultWidth: 20, defaultHeight: 4 },
  name:       { label: 'Nome del firmatario',   defaultWidth: 20, defaultHeight: 4 },
  email:      { label: 'Email del firmatario',  defaultWidth: 25, defaultHeight: 4 },
  text:       { label: 'Input di testo',        defaultWidth: 25, defaultHeight: 4 },
  label:      { label: 'Dicitura',              defaultWidth: 15, defaultHeight: 4 },
  checkbox:   { label: 'Casella da spuntare',   defaultWidth: 4,  defaultHeight: 4 },
  radio:      { label: 'Pulsante di opzione',   defaultWidth: 4,  defaultHeight: 4 },
}

// Colors assigned to signers (up to 8)
export const SIGNER_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-700', hex: '#3b82f6' },
  { bg: 'bg-purple-100', border: 'border-purple-400', text: 'text-purple-700', hex: '#8b5cf6' },
  { bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-700', hex: '#f97316' },
  { bg: 'bg-pink-100', border: 'border-pink-400', text: 'text-pink-700', hex: '#ec4899' },
  { bg: 'bg-teal-100', border: 'border-teal-400', text: 'text-teal-700', hex: '#14b8a6' },
  { bg: 'bg-red-100', border: 'border-red-400', text: 'text-red-700', hex: '#ef4444' },
  { bg: 'bg-indigo-100', border: 'border-indigo-400', text: 'text-indigo-700', hex: '#6366f1' },
  { bg: 'bg-amber-100', border: 'border-amber-400', text: 'text-amber-700', hex: '#f59e0b' },
]
