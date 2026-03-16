import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'
import type { Session } from '@supabase/supabase-js'

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
  status: 'draft' | 'pending' | 'signed'
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

interface Lead {
  id: string
  nome?: string
  email?: string
  telefono?: string
  marketing_consent?: boolean
  prima_volta?: string
  ultima_volta?: string
}

interface SignerRow {
  name: string
  email: string
  phone: string
  channel: 'email' | 'whatsapp'
}

type SidebarSection = 'documenti' | 'contatti'
type DocTab = 'sent' | 'signed_by_me'

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

function IconLeads({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
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

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  draft: 'bg-gray-400',
  pending: 'bg-yellow-500',
  signed: 'bg-green-600',
}

const statusLabels: Record<string, string> = {
  draft: 'Bozza',
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

  // Upload modal
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [signerRows, setSignerRows] = useState<SignerRow[]>([{ name: '', email: '', phone: '', channel: 'email' }])
  const [contactSuggestions, setContactSuggestions] = useState<Contact[]>([])
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Contacts
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactSearch, setContactSearch] = useState('')

  // Leads
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [leadSearch, setLeadSearch] = useState('')

  const userName = session.user.user_metadata?.full_name || session.user.email || 'Utente'
  const userEmail = session.user.email || ''

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadDocuments()
  }, [])

  useEffect(() => {
    if (section === 'contatti') loadContacts()
    if (section === 'lead') loadLeads()
  }, [section])

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

  async function loadLeads() {
    setLeadsLoading(true)
    try {
      const res = await fetch('/.netlify/functions/trustera-get-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token })
      })
      if (res.ok) {
        const { leads: data } = await res.json()
        setLeads(data || [])
      } else {
        toast.error('Impossibile caricare i lead')
      }
    } catch (err) {
      console.error('Error loading leads:', err)
      toast.error('Errore nel caricamento dei lead')
    }
    setLeadsLoading(false)
  }

  // ── Upload modal ──────────────────────────────────────────────────────────

  function resetUploadModal() {
    setSelectedFile(null)
    setSignerRows([{ name: '', email: '', phone: '', channel: 'email' }])
    setContactSuggestions([])
    setActiveSuggestionIndex(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function addSignerRow() {
    setSignerRows(prev => [...prev, { name: '', email: '', phone: '', channel: 'email' }])
  }

  function removeSignerRow(index: number) {
    setSignerRows(prev => prev.filter((_, i) => i !== index))
  }

  function updateSignerRow(index: number, field: keyof SignerRow, value: string) {
    setSignerRows(prev => prev.map((row, i) => i === index ? { ...row, [field]: value } : row))

    if (field === 'email' && value.length >= 2) {
      const query = value.toLowerCase()
      const matches = contacts.filter(c =>
        c.email.toLowerCase().includes(query) || c.name.toLowerCase().includes(query)
      )
      setContactSuggestions(matches.slice(0, 6))
      setActiveSuggestionIndex(index)
    } else if (field === 'email') {
      setContactSuggestions([])
      setActiveSuggestionIndex(null)
    }
  }

  function applySuggestion(rowIndex: number, contact: Contact) {
    setSignerRows(prev => prev.map((row, i) =>
      i === rowIndex
        ? { name: contact.name, email: contact.email, phone: contact.phone || '', channel: contact.phone ? 'whatsapp' as const : 'email' as const }
        : row
    ))
    setContactSuggestions([])
    setActiveSuggestionIndex(null)
  }

  async function handleUploadAndSend(e: React.FormEvent) {
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

  // ── Contacts ──────────────────────────────────────────────────────────────

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
  const pendingCount = sentDocuments.filter(d => d.status === 'pending').length
  const signedSentCount = sentDocuments.filter(d => d.status === 'signed').length
  const signedByMeCount = signedByMeDocuments.length

  const activeDocuments = activeDocTab === 'sent' ? sentDocuments : signedByMeDocuments

  const filteredContacts = contacts.filter(c => {
    const q = contactSearch.toLowerCase()
    return !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  })

  const filteredLeads = leads.filter(l => {
    const q = leadSearch.toLowerCase()
    return !q ||
      (l.nome || '').toLowerCase().includes(q) ||
      (l.email || '').toLowerCase().includes(q)
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
            onClick={() => setSection(key)}
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
                onClick={() => setSection(key)}
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
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-xs text-gray-500 mb-1">Documenti inviati</p>
                  <p className="text-2xl font-bold text-gray-800">{totalSent}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-xs text-gray-500 mb-1">In attesa</p>
                  <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-xs text-gray-500 mb-1">Firmati (inviati)</p>
                  <p className="text-2xl font-bold text-green-600">{signedSentCount}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-xs text-gray-500 mb-1">Firmati da me</p>
                  <p className="text-2xl font-bold text-green-600">{signedByMeCount}</p>
                </div>
              </div>

              {/* Sub-tabs + action */}
              <div className="flex items-center justify-between mb-5 gap-3">
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setActiveDocTab('sent')}
                    className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                      activeDocTab === 'sent'
                        ? 'bg-white text-gray-800 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Inviati ({totalSent})
                  </button>
                  <button
                    onClick={() => setActiveDocTab('signed_by_me')}
                    className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                      activeDocTab === 'signed_by_me'
                        ? 'bg-white text-gray-800 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
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

              {/* Document list */}
              {docsLoading ? (
                <div className="text-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto" />
                </div>
              ) : activeDocuments.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                  {activeDocTab === 'sent' ? (
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
                <div className="space-y-3">
                  {activeDocuments.map(doc => {
                    const isExpanded = expandedDocIds.has(doc.id)
                    const hasMultipleSigners = doc.signers && doc.signers.length > 1
                    const progress = getSignerProgress(doc)

                    return (
                      <div key={doc.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        {/* Main row */}
                        <div className="p-5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <h3 className="font-semibold text-gray-800 truncate">{doc.name}</h3>
                                <span className={`text-xs text-white px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${statusColors[doc.status]}`}>
                                  {statusLabels[doc.status]}
                                </span>
                              </div>

                              {activeDocTab === 'sent' ? (
                                doc.signers && doc.signers.length > 0 ? (
                                  <p className="text-sm text-gray-500">
                                    {doc.signers.length === 1
                                      ? `${doc.signers[0].name} (${doc.signers[0].email})`
                                      : `${doc.signers.length} firmatari — ${progress.signed}/${progress.total} firmati`
                                    }
                                  </p>
                                ) : (
                                  <p className="text-sm text-gray-500">
                                    {doc.signer_name} ({doc.signer_email})
                                  </p>
                                )
                              ) : (
                                <p className="text-sm text-gray-500">
                                  {doc.source === 'dr7_contract' ? 'Contratto DR7 Empire' :
                                   doc.source === 'dr7_trustera' ? 'Documento DR7' :
                                   'Documento Trustera'}
                                </p>
                              )}

                              <p className="text-xs text-gray-400 mt-1">
                                {activeDocTab === 'sent'
                                  ? formatDateIT(doc.created_at)
                                  : doc.signed_at
                                    ? `Firmato il ${formatDateIT(doc.signed_at)}`
                                    : formatDateIT(doc.created_at)
                                }
                                {activeDocTab === 'sent' && doc.signed_at &&
                                  ` — Firmato il ${formatDateIT(doc.signed_at)}`
                                }
                              </p>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {(doc.signed_pdf_url || doc.pdf_url) && (
                                <a
                                  href={doc.signed_pdf_url || doc.pdf_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                                >
                                  {doc.signed_pdf_url ? 'PDF Firmato' : 'PDF'}
                                </a>
                              )}
                              {(hasMultipleSigners || (doc.signers && doc.signers.length === 1)) && (
                                <button
                                  onClick={() => setExpandedDocIds(prev => {
                                    const next = new Set(prev)
                                    if (next.has(doc.id)) next.delete(doc.id)
                                    else next.add(doc.id)
                                    return next
                                  })}
                                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                                  aria-label="Espandi firmatari"
                                >
                                  <IconChevron open={isExpanded} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Expanded signers */}
                        {isExpanded && doc.signers && doc.signers.length > 0 && (
                          <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 space-y-2">
                            {doc.signers.map(signer => (
                              <div key={signer.id} className="flex items-center justify-between gap-2">
                                <div>
                                  <span className="text-sm font-medium text-gray-700">{signer.name}</span>
                                  <span className="text-xs text-gray-400 ml-2">{signer.email}</span>
                                  {signer.phone && <span className="text-xs text-gray-400 ml-2">{signer.phone}</span>}
                                </div>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  signer.status === 'signed'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-yellow-100 text-yellow-700'
                                }`}>
                                  {signer.status === 'signed'
                                    ? `Firmato${signer.signed_at ? ` il ${formatDateIT(signer.signed_at)}` : ''}`
                                    : 'In attesa'
                                  }
                                </span>
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
          )}

          {/* ════════════════ CONTATTI ════════════════ */}
          {section === 'contatti' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-gray-800">Contatti</h2>
                <span className="text-sm text-gray-400">{contacts.length} totali</span>
              </div>

              <div className="mb-4">
                <input
                  type="text"
                  value={contactSearch}
                  onChange={e => setContactSearch(e.target.value)}
                  placeholder="Cerca per nome o email..."
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
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

          {/* ════════════════ LEAD ════════════════ */}
          {section === 'lead' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-gray-800">Lead</h2>
                <span className="text-sm text-gray-400">{leads.length} totali</span>
              </div>

              <div className="mb-4">
                <input
                  type="text"
                  value={leadSearch}
                  onChange={e => setLeadSearch(e.target.value)}
                  placeholder="Cerca per nome o email..."
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
                />
              </div>

              {leadsLoading ? (
                <div className="text-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto" />
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                  <p className="text-gray-400">
                    {leadSearch ? 'Nessun lead trovato' : 'Nessun lead ancora'}
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Telefono</th>
                        <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Marketing</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Prima volta</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Ultima volta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.map((lead, i) => (
                        <tr
                          key={lead.id || i}
                          className={i < filteredLeads.length - 1 ? 'border-b border-gray-50' : ''}
                        >
                          <td className="px-5 py-3 font-medium text-gray-800">{lead.nome || '—'}</td>
                          <td className="px-5 py-3 text-gray-500">{lead.email || '—'}</td>
                          <td className="px-5 py-3 text-gray-500 hidden sm:table-cell">{lead.telefono || '—'}</td>
                          <td className="px-5 py-3 text-center hidden md:table-cell">
                            {lead.marketing_consent === true ? (
                              <span className="inline-block bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">Si</span>
                            ) : lead.marketing_consent === false ? (
                              <span className="inline-block bg-gray-100 text-gray-500 text-xs font-semibold px-2 py-0.5 rounded-full">No</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-gray-400 text-xs hidden lg:table-cell">
                            {lead.prima_volta ? formatDateIT(lead.prima_volta) : '—'}
                          </td>
                          <td className="px-5 py-3 text-gray-400 text-xs hidden lg:table-cell">
                            {lead.ultima_volta ? formatDateIT(lead.ultima_volta) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </main>
      </div>

      {/* ── Upload Modal ──────────────────────────────────────────────────────── */}
      {showUploadModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => { setShowUploadModal(false); resetUploadModal() }}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-6">Nuovo Documento da Firmare</h2>

              <form onSubmit={handleUploadAndSend} className="space-y-5">

                {/* File */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Documento PDF</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-green-500"
                    required
                  />
                </div>

                {/* Destinatari */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">Destinatari</label>
                    <span className="text-xs text-gray-400">Min. 1 richiesto</span>
                  </div>

                  <div className="space-y-3">
                    {signerRows.map((row, index) => (
                      <div key={index} className="relative border border-gray-200 rounded-xl p-3 bg-gray-50/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Firmatario {index + 1}
                          </span>
                          {signerRows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeSignerRow(index)}
                              className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                              aria-label="Rimuovi firmatario"
                            >
                              <IconTrash className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="space-y-2">
                          <input
                            type="text"
                            value={row.name}
                            onChange={e => updateSignerRow(index, 'name', e.target.value)}
                            placeholder="Nome e Cognome"
                            required
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-green-500 bg-white"
                          />

                          <div className="relative">
                            <input
                              type="email"
                              value={row.email}
                              onChange={e => updateSignerRow(index, 'email', e.target.value)}
                              onFocus={() => {
                                if (row.email.length >= 2) {
                                  const q = row.email.toLowerCase()
                                  setContactSuggestions(contacts.filter(c =>
                                    c.email.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
                                  ).slice(0, 6))
                                  setActiveSuggestionIndex(index)
                                }
                              }}
                              onBlur={() => setTimeout(() => { setContactSuggestions([]); setActiveSuggestionIndex(null) }, 150)}
                              placeholder="email@esempio.com"
                              required
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-green-500 bg-white"
                            />
                            {activeSuggestionIndex === index && contactSuggestions.length > 0 && (
                              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 overflow-hidden">
                                {contactSuggestions.map(contact => (
                                  <button
                                    key={contact.id}
                                    type="button"
                                    onMouseDown={() => applySuggestion(index, contact)}
                                    className="w-full text-left px-3 py-2.5 hover:bg-green-50 transition-colors border-b border-gray-50 last:border-0"
                                  >
                                    <span className="text-sm font-medium text-gray-800 block">{contact.name}</span>
                                    <span className="text-xs text-gray-400">{contact.email}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <input
                            type="tel"
                            value={row.phone}
                            onChange={e => updateSignerRow(index, 'phone', e.target.value)}
                            placeholder="+39 347 1234567 (opzionale)"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-green-500 bg-white"
                          />

                          {/* Channel selector */}
                          <div className="flex gap-3 pt-1">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name={`channel-${index}`}
                                checked={row.channel === 'email'}
                                onChange={() => updateSignerRow(index, 'channel', 'email')}
                                className="h-3.5 w-3.5 text-green-600 border-gray-300"
                              />
                              <span className="text-xs text-gray-600">Email</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name={`channel-${index}`}
                                checked={row.channel === 'whatsapp'}
                                onChange={() => updateSignerRow(index, 'channel', 'whatsapp')}
                                className="h-3.5 w-3.5 text-green-600 border-gray-300"
                              />
                              <span className="text-xs text-gray-600">WhatsApp</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={addSignerRow}
                    className="mt-3 flex items-center gap-2 text-sm text-green-600 hover:text-green-700 font-medium transition-colors"
                  >
                    <IconPlus className="w-4 h-4" />
                    Aggiungi destinatario
                  </button>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={uploading}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-lg transition-colors"
                  >
                    {uploading ? 'Invio...' : 'Invia per Firma'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowUploadModal(false); resetUploadModal() }}
                    className="px-6 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-lg transition-colors"
                  >
                    Annulla
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
