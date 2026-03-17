import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'
import type { Session } from '@supabase/supabase-js'
import type { DocumentField } from '../types/fields'

const FieldPlacementEditor = lazy(() => import('../components/FieldPlacementEditor'))

// ─── Types ───────────────────────────────────────────────────────────────────

interface Signer {
  id: string
  document_id: string
  name: string
  email: string
  phone?: string | null
  status: 'pending' | 'signed'
  signed_at?: string | null
}

interface Document {
  id: string
  name: string
  status: 'draft' | 'scheduled' | 'pending' | 'signed'
  created_at: string
  // legacy single-signer fields
  signer_email?: string
  signer_name?: string
  pdf_url?: string
  signed_pdf_url?: string
  signed_at?: string
  owner_id?: string
  source?: string
  // new multi-signer relation
  signers?: Signer[]
}

interface Contact {
  id: string
  owner_id: string
  name: string
  email: string
  phone?: string | null
  created_at: string
}

interface SignerRow {
  name: string
  email: string
  phone: string
  channel: 'email' | 'whatsapp'
}

type SidebarSection = 'documenti' | 'contatti'
type DocTab = 'sent' | 'signed_by_me'
type DocFilter = 'tutte' | 'in_corso' | 'completate' | 'bozza'
type SortOption = 'created_desc' | 'created_asc' | 'signed_desc' | 'signed_asc' | 'name_asc' | 'name_desc'

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconDocuments({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  )
}

function IconContacts({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
    </svg>
  )
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  draft: 'bg-gray-400',
  scheduled: 'bg-blue-500',
  pending: 'bg-yellow-500',
  signed: 'bg-green-600',
}

const statusLabels: Record<string, string> = {
  draft: 'Bozza',
  scheduled: 'Programmato',
  pending: 'In attesa',
  signed: 'Firmato',
}

function formatDateIT(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })
}

function getSignerProgress(doc: Document): { total: number; signed: number } {
  if (doc.signers && doc.signers.length > 0) {
    const signed = doc.signers.filter(s => s.status === 'signed').length
    return { total: doc.signers.length, signed }
  }
  // legacy single-signer
  return { total: 1, signed: doc.status === 'signed' ? 1 : 0 }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardPage({ session }: { session: Session }) {
  const navigate = useNavigate()

  // Sidebar
  const [section, setSection] = useState<SidebarSection>('documenti')

  // Documents
  const [sentDocuments, setSentDocuments] = useState<Document[]>([])
  const [signedByMeDocuments, setSignedByMeDocuments] = useState<Document[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [activeDocTab, setActiveDocTab] = useState<DocTab>('sent')
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set())
  const [docFilter, setDocFilter] = useState<DocFilter>('tutte')
  const [docSort, setDocSort] = useState<SortOption>('created_desc')
  const [docSearch, setDocSearch] = useState('')
  const [showSortMenu, setShowSortMenu] = useState(false)

  // Upload modal
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [signerRows, setSignerRows] = useState<SignerRow[]>([{ name: '', email: '', phone: '', channel: 'email' }])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Scheduled send
  const [showSchedulePicker, setShowSchedulePicker] = useState(false)
  const [scheduledDateTime, setScheduledDateTime] = useState('')

  // Field editor
  const [showFieldEditor, setShowFieldEditor] = useState(false)
  const [editorPdfUrl, setEditorPdfUrl] = useState('')
  const [editorDocumentId, setEditorDocumentId] = useState('')
  const [editorSigners, setEditorSigners] = useState<SignerRow[]>([])

  // Contacts
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactSearch, setContactSearch] = useState('')

  const userName = session.user.user_metadata?.full_name || session.user.email || 'Utente'
  const userEmail = session.user.email || ''

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadDocuments()
    loadContacts()
  }, [])

  async function getSignedUrl(url: string | null) {
    if (!url) return url
    const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/trustera\/(.+)/)
    if (!match) return url
    const { data: signed } = await supabase.storage.from('trustera').createSignedUrl(match[1], 3600)
    return signed?.signedUrl || url
  }

  function mapSigners(rawSigners: any[]): Signer[] {
    return (rawSigners || []).map((s: any) => ({
      id: s.id,
      document_id: s.document_id,
      name: s.signer_name || s.name,
      email: s.signer_email || s.email,
      phone: s.signer_phone || s.phone || null,
      status: s.status,
      signed_at: s.signed_at || null,
    }))
  }

  async function processDocUrls(docs: any[]): Promise<Document[]> {
    return Promise.all(docs.map(async (doc) => ({
      ...doc,
      signers: mapSigners(doc.signers),
      pdf_url: (await getSignedUrl(doc.pdf_url ?? null)) ?? undefined,
      signed_pdf_url: (await getSignedUrl(doc.signed_pdf_url ?? null)) ?? undefined,
    })))
  }

  async function loadDocuments() {
    setDocsLoading(true)

    const sentPromise = supabase
      .from('trustera_documents')
      .select('*, signers:trustera_document_signers(*)')
      .eq('owner_id', session.user.id)
      .order('created_at', { ascending: false })

    const signedByMePromise = supabase
      .from('trustera_documents')
      .select('*, signers:trustera_document_signers(*)')
      .eq('signer_email', userEmail)
      .eq('status', 'signed')
      .order('signed_at', { ascending: false })

    const [sentResult, signedResult] = await Promise.all([sentPromise, signedByMePromise])

    if (sentResult.error) {
      console.error('Error loading sent documents:', sentResult.error)
    } else {
      setSentDocuments(await processDocUrls(sentResult.data || []))
    }

    if (signedResult.error) {
      console.error('Error loading signed documents:', signedResult.error)
    } else {
      const externalDocs = (signedResult.data || []).filter((d: Document) => d.owner_id !== session.user.id)
      const trusteraDocs = await processDocUrls(externalDocs)

      let dr7Docs: Document[] = []
      try {
        const res = await fetch('/.netlify/functions/trustera-get-dr7-documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail, accessToken: session.access_token })
        })
        if (res.ok) {
          const { documents } = await res.json()
          dr7Docs = (documents || []).map((d: Document) => ({
            ...d,
            pdf_url: d.pdf_url || d.signed_pdf_url || '',
          }))
        }
      } catch (err) {
        console.warn('Could not fetch DR7 documents:', err)
      }

      const seenUrls = new Set(trusteraDocs.map(d => d.signed_pdf_url).filter(Boolean))
      const uniqueDR7 = dr7Docs.filter(d => !d.signed_pdf_url || !seenUrls.has(d.signed_pdf_url))
      setSignedByMeDocuments([...trusteraDocs, ...uniqueDR7])
    }

    setDocsLoading(false)
  }

  async function loadContacts() {
    setContactsLoading(true)
    const { data, error } = await supabase
      .from('trustera_contacts')
      .select('*')
      .eq('owner_id', session.user.id)
      .order('name')
    if (error) {
      console.error('Error loading contacts:', error)
    } else {
      setContacts(data || [])
    }
    setContactsLoading(false)
  }

  // ── Upload modal ──────────────────────────────────────────────────────────

  // ── Modal state ──
  const [signerCount, setSignerCount] = useState(0) // 0 = not yet chosen
  const [focusedSignerField, setFocusedSignerField] = useState<{ index: number; field: 'email' | 'name' } | null>(null)

  function resetUploadModal() {
    setSelectedFile(null)
    setSignerRows([])
    setSignerCount(0)
    setFocusedSignerField(null)
    setShowSchedulePicker(false)
    setScheduledDateTime('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleSelectSignerCount(count: number) {
    setSignerCount(count)
    // Initialize signer rows
    const rows: SignerRow[] = Array.from({ length: count }, () => ({
      name: '', email: '', phone: '', channel: 'email'
    }))
    setSignerRows(rows)
  }

  function updateSignerRow(index: number, field: keyof SignerRow, value: string) {
    setSignerRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  function applyContactToSigner(index: number, contact: Contact) {
    setSignerRows(prev => prev.map((r, i) => i === index ? {
      ...r,
      name: contact.name,
      email: contact.email,
      phone: contact.phone || '',
      channel: contact.phone ? 'whatsapp' : 'email'
    } : r))
    setFocusedSignerField(null)
  }

  function getContactSuggestions(query: string, currentIndex: number): Contact[] {
    if (query.length < 1) return []
    const q = query.toLowerCase()
    return contacts.filter(c => {
      const usedByOther = signerRows.some((s, i) => i !== currentIndex && s.email.toLowerCase() === c.email.toLowerCase())
      return !usedByOther && (c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
    }).slice(0, 5)
  }

  async function handleUploadAndOpenEditor(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile) { toast.error('Seleziona un file PDF'); return }

    const validSigners = signerRows.filter(s => s.email.trim() && s.name.trim())
    if (validSigners.length === 0) {
      toast.error('Aggiungi almeno un destinatario con nome e email')
      return
    }

    setUploading(true)
    try {
      const fileName = `documents/${session.user.id}/${Date.now()}_${selectedFile.name}`
      const { error: uploadError } = await supabase.storage
        .from('trustera')
        .upload(fileName, selectedFile, { contentType: 'application/pdf' })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('trustera').getPublicUrl(fileName)

      const { data: doc, error: insertError } = await supabase
        .from('trustera_documents')
        .insert({
          owner_id: session.user.id,
          name: selectedFile.name,
          pdf_url: publicUrl,
          status: 'draft',
        })
        .select()
        .single()
      if (insertError) throw insertError

      // Generate a signed URL for the PDF so react-pdf can load it
      const signedUrl = await getSignedUrl(publicUrl)

      // Open field placement editor
      setEditorPdfUrl(signedUrl || publicUrl)
      setEditorDocumentId(doc.id)
      setEditorSigners(validSigners)
      setShowUploadModal(false)
      setShowFieldEditor(true)
    } catch (error: any) {
      toast.error(error.message || 'Errore nel caricamento')
    } finally {
      setUploading(false)
    }
  }

  async function handleSendWithoutFields() {
    const validSigners = signerRows.filter(s => s.email.trim() && s.name.trim())
    if (!selectedFile || validSigners.length === 0) return

    setUploading(true)
    try {
      const fileName = `documents/${session.user.id}/${Date.now()}_${selectedFile.name}`
      const { error: uploadError } = await supabase.storage
        .from('trustera')
        .upload(fileName, selectedFile, { contentType: 'application/pdf' })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('trustera').getPublicUrl(fileName)

      const { data: doc, error: insertError } = await supabase
        .from('trustera_documents')
        .insert({
          owner_id: session.user.id,
          name: selectedFile.name,
          pdf_url: publicUrl,
          status: 'pending',
        })
        .select()
        .single()
      if (insertError) throw insertError

      const res = await fetch('/.netlify/functions/trustera-send-signing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: doc.id,
          signers: validSigners.map(s => ({
            name: s.name.trim(),
            email: s.email.trim(),
            phone: s.phone.trim() || null,
            channel: s.channel,
          }))
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Errore invio')
      }

      toast.success(`Richiesta di firma inviata a ${validSigners.length} destinatario${validSigners.length > 1 ? 'i' : ''}`)
      setShowUploadModal(false)
      resetUploadModal()
      loadDocuments()
    } catch (error: any) {
      toast.error(error.message || 'Errore nel caricamento')
    } finally {
      setUploading(false)
    }
  }

  async function handleSaveDraft() {
    if (!selectedFile) { toast.error('Seleziona un file PDF'); return }
    const validSigners = signerRows.filter(s => s.email.trim() && s.name.trim())

    setUploading(true)
    try {
      const fileName = `documents/${session.user.id}/${Date.now()}_${selectedFile.name}`
      const { error: uploadError } = await supabase.storage
        .from('trustera')
        .upload(fileName, selectedFile, { contentType: 'application/pdf' })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('trustera').getPublicUrl(fileName)

      const { error: insertError } = await supabase
        .from('trustera_documents')
        .insert({
          owner_id: session.user.id,
          name: selectedFile.name,
          pdf_url: publicUrl,
          status: 'draft',
          draft_signers: validSigners.length > 0 ? validSigners : null,
        })
        .select()
        .single()
      if (insertError) throw insertError

      toast.success('Bozza salvata')
      setShowUploadModal(false)
      resetUploadModal()
      loadDocuments()
    } catch (error: any) {
      toast.error(error.message || 'Errore nel salvataggio')
    } finally {
      setUploading(false)
    }
  }

  async function handleScheduledSend() {
    if (!selectedFile) { toast.error('Seleziona un file PDF'); return }
    if (!scheduledDateTime) { toast.error('Seleziona data e ora'); return }

    const validSigners = signerRows.filter(s => s.email.trim() && s.name.trim())
    if (validSigners.length === 0) {
      toast.error('Aggiungi almeno un firmatario con nome e email')
      return
    }

    const scheduledDate = new Date(scheduledDateTime)
    if (scheduledDate <= new Date()) {
      toast.error('La data deve essere nel futuro')
      return
    }

    setUploading(true)
    try {
      const fileName = `documents/${session.user.id}/${Date.now()}_${selectedFile.name}`
      const { error: uploadError } = await supabase.storage
        .from('trustera')
        .upload(fileName, selectedFile, { contentType: 'application/pdf' })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('trustera').getPublicUrl(fileName)

      const { error: insertError } = await supabase
        .from('trustera_documents')
        .insert({
          owner_id: session.user.id,
          name: selectedFile.name,
          pdf_url: publicUrl,
          status: 'scheduled',
          scheduled_at: scheduledDate.toISOString(),
          draft_signers: validSigners,
        })
        .select()
        .single()
      if (insertError) throw insertError

      toast.success(`Invio programmato per ${scheduledDate.toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`)
      setShowUploadModal(false)
      resetUploadModal()
      loadDocuments()
    } catch (error: any) {
      toast.error(error.message || 'Errore nella programmazione')
    } finally {
      setUploading(false)
    }
  }

  async function handleFieldEditorComplete(fields: Omit<DocumentField, 'id' | 'document_id' | 'signer_id'>[]) {
    try {
      // Save fields
      if (fields.length > 0) {
        const res = await fetch('/.netlify/functions/trustera-save-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentId: editorDocumentId,
            fields,
            accessToken: session.access_token,
          })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Errore salvataggio campi')
        }
      }

      // Send signing requests
      const res = await fetch('/.netlify/functions/trustera-send-signing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: editorDocumentId,
          signers: editorSigners.map(s => ({
            name: s.name.trim(),
            email: s.email.trim(),
            phone: s.phone.trim() || null,
            channel: s.channel,
          }))
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Errore invio')
      }

      toast.success(`Richiesta di firma inviata a ${editorSigners.length} destinatario${editorSigners.length > 1 ? 'i' : ''}`)
      setShowFieldEditor(false)
      resetUploadModal()
      loadDocuments()
    } catch (error: any) {
      toast.error(error.message || 'Errore nell\'invio')
    }
  }

  // ── Contacts ──────────────────────────────────────────────────────────────

  const importFileRef = useRef<HTMLInputElement>(null)

  function handleExportContacts() {
    if (contacts.length === 0) { toast.error('Nessun contatto da esportare'); return }
    const header = 'Nome,Email,Telefono'
    const rows = contacts.map(c => {
      const name = c.name.replace(/"/g, '""')
      const email = c.email.replace(/"/g, '""')
      const phone = (c.phone || '').replace(/"/g, '""')
      return `"${name}","${email}","${phone}"`
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contatti_trustera_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`${contacts.length} contatti esportati`)
  }

  async function handleImportContacts(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so same file can be re-selected
    if (importFileRef.current) importFileRef.current.value = ''

    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) { toast.error('File vuoto o senza dati'); return }

      // Parse CSV (skip header)
      const imported: { name: string; email: string; phone: string }[] = []
      for (let i = 1; i < lines.length; i++) {
        // Handle quoted CSV fields
        const match = lines[i].match(/(?:"([^"]*(?:""[^"]*)*)"|([^,]*))(?:,(?:"([^"]*(?:""[^"]*)*)"|([^,]*)))?(?:,(?:"([^"]*(?:""[^"]*)*)"|([^,]*)))?/)
        if (!match) continue
        const name = (match[1] || match[2] || '').replace(/""/g, '"').trim()
        const email = (match[3] || match[4] || '').replace(/""/g, '"').trim()
        const phone = (match[5] || match[6] || '').replace(/""/g, '"').trim()
        if (name && email && email.includes('@')) {
          imported.push({ name, email, phone })
        }
      }

      if (imported.length === 0) { toast.error('Nessun contatto valido trovato nel file'); return }

      // Upsert each contact
      const rows = imported.map(c => ({
        owner_id: session.user.id,
        name: c.name,
        email: c.email,
        phone: c.phone || null,
        updated_at: new Date().toISOString(),
      }))

      const { error } = await supabase
        .from('trustera_contacts')
        .upsert(rows, { onConflict: 'owner_id,email' })

      if (error) {
        console.error('Import error:', error)
        toast.error('Errore durante l\'importazione')
      } else {
        toast.success(`${imported.length} contatti importati`)
        loadContacts()
      }
    } catch (err: any) {
      toast.error('Errore nella lettura del file')
    }
  }

  async function handleDeleteContact(id: string) {
    if (!confirm('Eliminare questo contatto?')) return
    const { error } = await supabase.from('trustera_contacts').delete().eq('id', id)
    if (error) {
      toast.error('Errore nell\'eliminazione')
    } else {
      setContacts(prev => prev.filter(c => c.id !== id))
      toast.success('Contatto eliminato')
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const totalSent = sentDocuments.length
  const draftCount = sentDocuments.filter(d => d.status === 'draft' || d.status === 'scheduled').length
  const pendingCount = sentDocuments.filter(d => d.status === 'pending').length
  const signedSentCount = sentDocuments.filter(d => d.status === 'signed').length
  const signedByMeCount = signedByMeDocuments.length

  // Filter documents
  const baseDocuments = activeDocTab === 'sent' ? sentDocuments : signedByMeDocuments
  const filteredDocuments = baseDocuments.filter(doc => {
    // Status filter
    if (docFilter === 'in_corso' && doc.status !== 'pending') return false
    if (docFilter === 'completate' && doc.status !== 'signed') return false
    if (docFilter === 'bozza' && doc.status !== 'draft' && doc.status !== 'scheduled') return false
    // Search
    if (docSearch) {
      const q = docSearch.toLowerCase()
      const nameMatch = doc.name.toLowerCase().includes(q)
      const signerMatch = doc.signers?.some(s => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
      const legacyMatch = doc.signer_name?.toLowerCase().includes(q) || doc.signer_email?.toLowerCase().includes(q)
      if (!nameMatch && !signerMatch && !legacyMatch) return false
    }
    return true
  })

  // Sort documents
  const activeDocuments = [...filteredDocuments].sort((a, b) => {
    switch (docSort) {
      case 'created_desc': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case 'created_asc': return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      case 'signed_desc': return (b.signed_at ? new Date(b.signed_at).getTime() : 0) - (a.signed_at ? new Date(a.signed_at).getTime() : 0)
      case 'signed_asc': return (a.signed_at ? new Date(a.signed_at).getTime() : 0) - (b.signed_at ? new Date(b.signed_at).getTime() : 0)
      case 'name_asc': return a.name.localeCompare(b.name)
      case 'name_desc': return b.name.localeCompare(a.name)
      default: return 0
    }
  })

  const sortLabels: Record<SortOption, string> = {
    created_desc: 'Data di creazione (recente)',
    created_asc: 'Data di creazione (vecchia)',
    signed_desc: 'Data della firma (recente)',
    signed_asc: 'Data della firma (vecchia)',
    name_asc: 'Nome (A-Z)',
    name_desc: 'Nome (Z-A)',
  }

  const filteredContacts = contacts.filter(c => {
    const q = contactSearch.toLowerCase()
    return !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  })

  // ── Sidebar nav items ─────────────────────────────────────────────────────

  const navItems: { key: SidebarSection; label: string; Icon: React.FC<{ className?: string }> }[] = [
    { key: 'documenti', label: 'Documenti', Icon: IconDocuments },
    { key: 'contatti', label: 'Contatti', Icon: IconContacts },
  ]

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <img src="/trustera-logo.jpeg" alt="Trustera" className="h-16 w-auto" />
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:block">{userName}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-red-600 transition-colors"
            >
              Esci
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile top tabs ─────────────────────────────────────────────────── */}
      <nav className="md:hidden bg-white border-b border-gray-200 px-4 flex gap-1 overflow-x-auto flex-shrink-0">
        {navItems.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => { setSection(key); if (key === 'contatti') loadContacts() }}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              section === key
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>

      {/* ── Body (sidebar + content) ─────────────────────────────────────────── */}
      <div className="flex flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 py-6 gap-6">

        {/* Desktop sidebar */}
        <aside className="hidden md:flex flex-col w-52 flex-shrink-0">
          <nav className="bg-white rounded-xl border border-gray-200 p-2 space-y-1">
            {navItems.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => { setSection(key); if (key === 'contatti') loadContacts() }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  section === key
                    ? 'bg-green-50 text-green-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-4 bg-white rounded-xl border border-gray-200 p-2 space-y-1">
            <a href="/pricing" className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors">
              Pricing
            </a>
            <a href="/privacy" className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors">
              Privacy & GDPR
            </a>
            <a href="/terms" className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors">
              Termini
            </a>
          </div>
        </aside>

        {/* ── Main content ───────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0">

          {/* ════════════════ DOCUMENTI ════════════════ */}
          {section === 'documenti' && (
            <div>
              {/* Sent / Signed by me tabs + new button */}
              <div className="flex items-center justify-between mb-4 gap-3">
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setActiveDocTab('sent')}
                    className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                      activeDocTab === 'sent' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Inviati ({totalSent})
                  </button>
                  <button
                    onClick={() => setActiveDocTab('signed_by_me')}
                    className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                      activeDocTab === 'signed_by_me' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Firmati da me ({signedByMeCount})
                  </button>
                </div>
                {activeDocTab === 'sent' && (
                  <button
                    onClick={() => { resetUploadModal(); setShowUploadModal(true) }}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-5 rounded-lg text-sm transition-colors flex-shrink-0"
                  >
                    + Nuovo Documento
                  </button>
                )}
              </div>

              {/* Filter tabs (YouSign-style) */}
              {activeDocTab === 'sent' && (
                <div className="flex gap-0 border-b border-gray-200 mb-4">
                  {([
                    { key: 'tutte' as DocFilter, label: 'Tutte', count: totalSent },
                    { key: 'in_corso' as DocFilter, label: 'In corso', count: pendingCount },
                    { key: 'completate' as DocFilter, label: 'Completate', count: signedSentCount },
                    { key: 'bozza' as DocFilter, label: 'Bozza', count: draftCount },
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setDocFilter(tab.key)}
                      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                        docFilter === tab.key
                          ? 'border-green-600 text-green-700'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label} {tab.count > 0 && <span className="text-xs ml-1 opacity-60">({tab.count})</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* Search + Sort bar */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                  </svg>
                  <input
                    type="text"
                    value={docSearch}
                    onChange={e => setDocSearch(e.target.value)}
                    placeholder="Cerca per nome documento o firmatario..."
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20 transition-all"
                  />
                </div>

                {/* Sort dropdown */}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setShowSortMenu(!showSortMenu)}
                    className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 bg-white hover:bg-gray-50 transition-colors"
                  >
                    Ordina per
                    <svg className={`w-3.5 h-3.5 transition-transform ${showSortMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                    </svg>
                  </button>

                  {showSortMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 w-72 overflow-hidden">
                      {(Object.entries(sortLabels) as [SortOption, string][]).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => { setDocSort(key); setShowSortMenu(false) }}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 transition-colors flex items-center justify-between border-b border-gray-50 last:border-0"
                        >
                          <span className={docSort === key ? 'text-green-700 font-medium' : 'text-gray-700'}>{label}</span>
                          {docSort === key && (
                            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Count */}
              <p className="text-xs text-gray-400 mb-3">{activeDocuments.length} di {baseDocuments.length} documenti</p>

              {/* Document list */}
              {docsLoading ? (
                <div className="text-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto" />
                </div>
              ) : activeDocuments.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                  {docFilter !== 'tutte' || docSearch ? (
                    <p className="text-gray-400 text-lg">Nessun risultato</p>
                  ) : activeDocTab === 'sent' ? (
                    <>
                      <p className="text-gray-400 text-lg mb-4">Nessun documento inviato</p>
                      <button
                        onClick={() => { resetUploadModal(); setShowUploadModal(true) }}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                      >
                        Carica il primo documento
                      </button>
                    </>
                  ) : (
                    <p className="text-gray-400 text-lg">Nessun documento firmato da te</p>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                  {activeDocuments.map(doc => {
                    const isExpanded = expandedDocIds.has(doc.id)
                    const signers = doc.signers && doc.signers.length > 0
                      ? doc.signers
                      : doc.signer_name
                        ? [{ id: 'legacy', document_id: doc.id, name: doc.signer_name!, email: doc.signer_email!, status: doc.status === 'signed' ? 'signed' as const : 'pending' as const, signed_at: doc.signed_at }]
                        : []

                    return (
                      <div key={doc.id}>
                        <div
                          className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50/50 transition-colors cursor-pointer"
                          onClick={() => setExpandedDocIds(prev => {
                            const next = new Set(prev)
                            if (next.has(doc.id)) next.delete(doc.id)
                            else next.add(doc.id)
                            return next
                          })}
                        >
                          {/* Left: doc info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <h3 className="font-semibold text-gray-800 truncate text-sm">{doc.name}</h3>
                              {doc.signers && doc.signers.length > 0 && (
                                <span className="text-xs text-gray-400 flex-shrink-0">{doc.signers.length}</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">
                              {formatDateIT(doc.created_at)}
                              {activeDocTab === 'sent' && <span className="mx-1.5">|</span>}
                              {activeDocTab === 'sent' && <span>Da me</span>}
                            </p>
                          </div>

                          {/* Center: signer status icons */}
                          <div className="hidden md:flex items-center gap-2 flex-shrink-0">
                            {signers.map((signer, si) => (
                              <div key={signer.id || si} className="flex items-center gap-1" title={`${signer.name} — ${signer.status === 'signed' ? 'Firmato' : 'In attesa'}`}>
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                                  signer.status === 'signed' ? 'bg-green-500' : 'bg-yellow-400'
                                }`}>
                                  {signer.status === 'signed' ? (
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                                  ) : (
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>
                                  )}
                                </span>
                                <span className="text-xs text-gray-500 max-w-[100px] truncate">
                                  {signer.name.split(' ').map(w => w[0] + '.').join(' ')}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Right: status + actions */}
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${statusColors[doc.status]}`} />
                              <span className="text-sm font-medium text-gray-600">{statusLabels[doc.status]}</span>
                            </div>
                            {doc.signed_pdf_url && (
                              <a
                                href={doc.signed_pdf_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Scarica PDF firmato"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                </svg>
                              </a>
                            )}
                            <IconChevron open={isExpanded} />
                          </div>
                        </div>

                        {/* Expanded: signer details */}
                        {isExpanded && signers.length > 0 && (
                          <div className="border-t border-gray-100 bg-gray-50/80 px-5 py-3 space-y-2">
                            {signers.map((signer, si) => (
                              <div key={signer.id || si} className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${
                                    signer.status === 'signed' ? 'bg-green-500' : 'bg-yellow-400'
                                  }`}>
                                    {signer.status === 'signed' ? (
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                                    ) : (
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                                    )}
                                  </span>
                                  <div className="min-w-0">
                                    <span className="text-sm font-medium text-gray-700">{signer.name}</span>
                                    <span className="text-xs text-gray-400 ml-2">{signer.email}</span>
                                  </div>
                                </div>
                                <span className="text-xs text-gray-400 flex-shrink-0">
                                  {signer.status === 'signed'
                                    ? signer.signed_at ? `Firmato il ${formatDateIT(signer.signed_at)}` : 'Firmato'
                                    : 'In attesa'
                                  }
                                </span>
                              </div>
                            ))}

                            {/* Document actions */}
                            <div className="flex gap-2 pt-2 border-t border-gray-200 mt-2">
                              {doc.pdf_url && (
                                <a
                                  href={doc.pdf_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-gray-500 hover:text-green-600 font-medium transition-colors"
                                >
                                  Vedi originale
                                </a>
                              )}
                              {doc.signed_pdf_url && (
                                <a
                                  href={doc.signed_pdf_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-green-600 hover:text-green-700 font-medium transition-colors"
                                >
                                  Scarica firmato
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ════════════════ CONTATTI ════════════════ */}
          {section === 'contatti' && (
            <div>
              <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold text-gray-800">Contatti</h2>
                  <span className="text-sm text-gray-400">{contacts.length} totali</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => importFileRef.current?.click()}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                    </svg>
                    Importa
                  </button>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".csv"
                    onChange={handleImportContacts}
                    className="hidden"
                  />
                  <button
                    onClick={handleExportContacts}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Esporta
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <input
                  type="text"
                  value={contactSearch}
                  onChange={e => setContactSearch(e.target.value)}
                  placeholder="Cerca per nome o email..."
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                />
              </div>

              {contactsLoading ? (
                <div className="text-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto" />
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                  <p className="text-gray-400">
                    {contactSearch ? 'Nessun contatto trovato' : 'Nessun contatto ancora — vengono salvati automaticamente quando invii un documento'}
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {filteredContacts.map((contact, i) => (
                    <div
                      key={contact.id}
                      className={`flex items-center justify-between px-5 py-4 gap-3 ${
                        i < filteredContacts.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 text-sm">{contact.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{contact.email}</p>
                        {contact.phone && <p className="text-xs text-gray-400">{contact.phone}</p>}
                      </div>
                      <button
                        onClick={() => handleDeleteContact(contact.id)}
                        className="p-2 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                        aria-label="Elimina contatto"
                      >
                        <IconTrash className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </main>
      </div>

      {/* ── Upload Modal (Apple-style) ──────────────────────────────────────── */}
      {showUploadModal && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
          onClick={() => { setShowUploadModal(false); resetUploadModal() }}
        >
          <div
            className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto"
            style={{ boxShadow: '0 -4px 40px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-[17px] font-semibold text-gray-900">Nuovo Documento</h2>
              <button
                onClick={() => { setShowUploadModal(false); resetUploadModal() }}
                className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleUploadAndOpenEditor} className="px-5 pb-5">

              {/* File upload */}
              <div className="py-4 border-b border-gray-100">
                <label className="block text-[13px] font-medium text-gray-500 uppercase tracking-wide mb-2">Documento PDF</label>
                {!selectedFile ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-8 flex flex-col items-center gap-2 hover:border-green-400 hover:bg-green-50/30 transition-all"
                  >
                    <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <span className="text-sm text-gray-400">Tocca per selezionare un PDF</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-3 bg-green-50 rounded-xl px-4 py-3">
                    <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                    <span className="text-sm text-green-800 font-medium truncate flex-1">{selectedFile.name}</span>
                    <button type="button" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="text-green-600 hover:text-red-500 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept=".pdf" onChange={e => setSelectedFile(e.target.files?.[0] || null)} className="hidden" />
              </div>

              {/* Firmatari section */}
              <div className="py-4">
                <label className="block text-[13px] font-medium text-gray-500 uppercase tracking-wide mb-3">Firmatari</label>

                {/* Step 1: Select number of signers */}
                {signerCount === 0 ? (
                  <div>
                    <p className="text-sm text-gray-600 mb-3">Quanti firmatari?</p>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => handleSelectSignerCount(n)}
                          className="flex-1 py-3 rounded-xl text-sm font-semibold bg-gray-50 hover:bg-green-50 hover:text-green-700 border border-gray-200 hover:border-green-300 text-gray-700 transition-all"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Change count */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{signerCount} firmatari{signerCount > 1 ? 'o' : ''}</span>
                      <button type="button" onClick={() => { setSignerCount(0); setSignerRows([]) }} className="text-xs text-gray-400 hover:text-gray-600">
                        Cambia
                      </button>
                    </div>

                    {/* Step 2+3: For each signer — channel, then email (with autocomplete), name, phone */}
                    {signerRows.map((signer, i) => (
                      <div key={i} className="border border-gray-200 rounded-2xl p-4 bg-gray-50/50 space-y-3">
                        <p className="text-[13px] font-semibold text-gray-700">Firmatario {i + 1}</p>

                        {/* Channel toggle */}
                        <div className="flex gap-2">
                          <button type="button" onClick={() => updateSignerRow(i, 'channel', 'email')}
                            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${signer.channel === 'email' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                          >Email</button>
                          <button type="button" onClick={() => updateSignerRow(i, 'channel', 'whatsapp')}
                            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${signer.channel === 'whatsapp' ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                          >WhatsApp</button>
                        </div>

                        {/* Email with autocomplete */}
                        <div className="relative">
                          <input
                            type="email"
                            value={signer.email}
                            onChange={e => updateSignerRow(i, 'email', e.target.value)}
                            onFocus={() => setFocusedSignerField({ index: i, field: 'email' })}
                            onBlur={() => setTimeout(() => setFocusedSignerField(null), 200)}
                            placeholder="email@esempio.com"
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-[15px] text-gray-800 bg-white focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                          />
                          {/* Contact suggestions dropdown */}
                          {focusedSignerField?.index === i && focusedSignerField?.field === 'email' && (() => {
                            const suggestions = getContactSuggestions(signer.email, i)
                            if (suggestions.length === 0) return null
                            return (
                              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden">
                                {suggestions.map(contact => (
                                  <button
                                    key={contact.id}
                                    type="button"
                                    onMouseDown={e => { e.preventDefault(); applyContactToSigner(i, contact) }}
                                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3 border-b border-gray-50 last:border-0"
                                  >
                                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                                      <span className="text-xs font-bold text-gray-500">
                                        {contact.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                                      </span>
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-gray-800 truncate">{contact.name}</p>
                                      <p className="text-xs text-gray-400 truncate">{contact.email}{contact.phone ? ` · ${contact.phone}` : ''}</p>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )
                          })()}
                        </div>

                        {/* Name */}
                        <input
                          type="text"
                          value={signer.name}
                          onChange={e => updateSignerRow(i, 'name', e.target.value)}
                          placeholder="Nome e Cognome"
                          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-[15px] text-gray-800 bg-white focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                        />

                        {/* Phone (show always for WhatsApp, optional for email) */}
                        <input
                          type="tel"
                          value={signer.phone}
                          onChange={e => updateSignerRow(i, 'phone', e.target.value)}
                          placeholder={signer.channel === 'whatsapp' ? '+39 347 1234567' : '+39 347 1234567 (opzionale)'}
                          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-[15px] text-gray-800 bg-white focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit buttons */}
              {signerCount > 0 && (
                <div className="space-y-2 mt-2">
                  {/* Primary: place fields and send */}
                  <button
                    type="submit"
                    disabled={uploading || !selectedFile || signerRows.some(s => !s.name.trim() || !s.email.trim())}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-4 rounded-2xl transition-all text-[16px]"
                  >
                    {uploading ? (
                      <span className="inline-flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        Caricamento...
                      </span>
                    ) : `Posiziona Campi e Invia (${signerCount})`}
                  </button>

                  {/* Send without fields */}
                  <button
                    type="button"
                    onClick={handleSendWithoutFields}
                    disabled={uploading || !selectedFile || signerRows.some(s => !s.name.trim() || !s.email.trim())}
                    className="w-full text-gray-500 hover:text-gray-700 disabled:text-gray-300 text-sm font-medium py-2 transition-colors"
                  >
                    Invia senza campi
                  </button>

                  <div className="border-t border-gray-100 pt-3 mt-3 flex gap-2">
                    {/* Save draft */}
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      disabled={uploading || !selectedFile}
                      className="flex-1 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 disabled:bg-gray-50 disabled:text-gray-300 text-gray-700 text-sm font-medium py-3 rounded-xl transition-all"
                    >
                      Salva Bozza
                    </button>

                    {/* Scheduled send */}
                    <button
                      type="button"
                      onClick={() => setShowSchedulePicker(!showSchedulePicker)}
                      disabled={uploading || !selectedFile || signerRows.some(s => !s.name.trim() || !s.email.trim())}
                      className="flex-1 border border-gray-200 hover:border-blue-300 bg-white hover:bg-blue-50 disabled:bg-gray-50 disabled:text-gray-300 text-gray-700 text-sm font-medium py-3 rounded-xl transition-all"
                    >
                      Invio Programmato
                    </button>
                  </div>

                  {/* Schedule datetime picker */}
                  {showSchedulePicker && (
                    <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4 space-y-3">
                      <p className="text-[13px] font-semibold text-gray-700">Programma invio</p>
                      <input
                        type="datetime-local"
                        value={scheduledDateTime}
                        onChange={e => setScheduledDateTime(e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-[15px] text-gray-800 bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      />
                      <button
                        type="button"
                        onClick={handleScheduledSend}
                        disabled={uploading || !scheduledDateTime}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition-colors"
                      >
                        Conferma Invio Programmato
                      </button>
                    </div>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ── Field Placement Editor ─────────────────────────────────────────── */}
      {showFieldEditor && (
        <Suspense fallback={
          <div className="fixed inset-0 bg-gray-100 z-50 flex items-center justify-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
          </div>
        }>
          <FieldPlacementEditor
            pdfUrl={editorPdfUrl}
            signers={editorSigners.map(s => ({ name: s.name, email: s.email }))}
            onComplete={handleFieldEditorComplete}
            onCancel={() => setShowFieldEditor(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
