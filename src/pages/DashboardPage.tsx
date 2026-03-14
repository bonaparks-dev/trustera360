import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'
import type { Session } from '@supabase/supabase-js'

interface Document {
  id: string
  name: string
  status: 'draft' | 'pending' | 'signed'
  created_at: string
  signer_email: string
  signer_name: string
  pdf_url?: string
  signed_pdf_url?: string
  signed_at?: string
  owner_id?: string
  source?: string
}

type Tab = 'sent' | 'signed_by_me'

export default function DashboardPage({ session }: { session: Session }) {
  const navigate = useNavigate()
  const [sentDocuments, setSentDocuments] = useState<Document[]>([])
  const [signedByMeDocuments, setSignedByMeDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [signerPhone, setSignerPhone] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('sent')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const userName = session.user.user_metadata?.full_name || session.user.email || 'Utente'
  const userEmail = session.user.email || ''

  useEffect(() => {
    loadDocuments()
  }, [])

  async function loadDocuments() {
    setLoading(true)

    const getSignedUrl = async (url: string | null) => {
      if (!url) return url
      const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/trustera\/(.+)/)
      if (!match) return url
      const { data: signed } = await supabase.storage.from('trustera').createSignedUrl(match[1], 3600)
      return signed?.signedUrl || url
    }

    const processDocUrls = async (docs: any[]) => {
      return Promise.all(docs.map(async (doc: any) => ({
        ...doc,
        pdf_url: await getSignedUrl(doc.pdf_url),
        signed_pdf_url: await getSignedUrl(doc.signed_pdf_url)
      })))
    }

    // Load sent documents (owned by user)
    const sentPromise = supabase
      .from('trustera_documents')
      .select('*')
      .eq('owner_id', session.user.id)
      .order('created_at', { ascending: false })

    // Load documents signed by me (where I'm the signer)
    const signedByMePromise = supabase
      .from('trustera_documents')
      .select('*')
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
      // Filter out documents I own (to avoid duplicates)
      const externalDocs = (signedResult.data || []).filter((d: any) => d.owner_id !== session.user.id)
      const trusteraDocs = await processDocUrls(externalDocs)

      // Also fetch signed documents from DR7 Supabase
      let dr7Docs: Document[] = []
      try {
        const accessToken = session.access_token
        const res = await fetch('/.netlify/functions/trustera-get-dr7-documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail, accessToken })
        })
        if (res.ok) {
          const { documents } = await res.json()
          dr7Docs = (documents || []).map((d: any) => ({
            ...d,
            pdf_url: d.pdf_url || d.signed_pdf_url || '',
          }))
        }
      } catch (err) {
        console.warn('Could not fetch DR7 documents:', err)
      }

      // Merge and deduplicate (by signed_pdf_url to avoid showing same doc twice)
      const seenUrls = new Set(trusteraDocs.map(d => d.signed_pdf_url).filter(Boolean))
      const uniqueDR7 = dr7Docs.filter(d => !d.signed_pdf_url || !seenUrls.has(d.signed_pdf_url))
      setSignedByMeDocuments([...trusteraDocs, ...uniqueDR7])
    }

    setLoading(false)
  }

  async function handleUploadAndSend(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile || !signerEmail || !signerName) return

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
          signer_name: signerName,
          signer_email: signerEmail,
          signer_phone: signerPhone || null,
          status: 'pending'
        })
        .select()
        .single()

      if (insertError) throw insertError

      const res = await fetch('/.netlify/functions/trustera-send-signing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: doc.id })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Errore invio')
      }

      toast.success(`Richiesta di firma inviata a ${signerEmail}`)
      setShowUploadModal(false)
      setSelectedFile(null)
      setSignerName('')
      setSignerEmail('')
      setSignerPhone('')
      loadDocuments()
    } catch (error: any) {
      toast.error(error.message || 'Errore nel caricamento')
    } finally {
      setUploading(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-500',
    pending: 'bg-yellow-500',
    signed: 'bg-green-600',
  }

  const statusLabels: Record<string, string> = {
    draft: 'Bozza',
    pending: 'In attesa',
    signed: 'Firmato',
  }

  const totalSent = sentDocuments.length
  const pendingCount = sentDocuments.filter(d => d.status === 'pending').length
  const signedSentCount = sentDocuments.filter(d => d.status === 'signed').length
  const signedByMeCount = signedByMeDocuments.length

  const activeDocuments = activeTab === 'sent' ? sentDocuments : signedByMeDocuments

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/trustera-logo.jpeg" alt="Trustera" className="h-8" />
            <span className="text-lg font-bold text-gray-800">TRUSTERA</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{userName}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-red-600 transition-colors"
            >
              Esci
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">Documenti inviati</p>
            <p className="text-2xl font-bold text-gray-800">{totalSent}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">In attesa di firma</p>
            <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">Firmati (inviati)</p>
            <p className="text-2xl font-bold text-green-600">{signedSentCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">Firmati da me</p>
            <p className="text-2xl font-bold text-green-600">{signedByMeCount}</p>
          </div>
        </div>

        {/* Tabs + Action */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('sent')}
              className={`px-5 py-2 rounded-md text-sm font-semibold transition-colors ${
                activeTab === 'sent'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Inviati ({totalSent})
            </button>
            <button
              onClick={() => setActiveTab('signed_by_me')}
              className={`px-5 py-2 rounded-md text-sm font-semibold transition-colors ${
                activeTab === 'signed_by_me'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Firmati da me ({signedByMeCount})
            </button>
          </div>
          {activeTab === 'sent' && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
            >
              + Nuovo Documento
            </button>
          )}
        </div>

        {/* Documents List */}
        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto"></div>
          </div>
        ) : activeDocuments.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            {activeTab === 'sent' ? (
              <>
                <p className="text-gray-400 text-lg mb-4">Nessun documento inviato</p>
                <button
                  onClick={() => setShowUploadModal(true)}
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
          <div className="grid gap-4">
            {activeDocuments.map(doc => (
              <div key={doc.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-gray-800">{doc.name}</h3>
                    <span className={`text-xs text-white px-2 py-0.5 rounded-full font-bold ${statusColors[doc.status]}`}>
                      {statusLabels[doc.status]}
                    </span>
                  </div>
                  {activeTab === 'sent' ? (
                    <p className="text-sm text-gray-500">
                      Firmatario: {doc.signer_name} ({doc.signer_email})
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500">
                      {doc.source === 'dr7_contract' ? 'Contratto DR7 Empire' :
                       doc.source === 'dr7_trustera' ? 'Documento DR7' :
                       'Documento Trustera'}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {activeTab === 'sent'
                      ? new Date(doc.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })
                      : doc.signed_at
                        ? `Firmato il ${new Date(doc.signed_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`
                        : new Date(doc.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })
                    }
                    {activeTab === 'sent' && doc.signed_at && ` — Firmato il ${new Date(doc.signed_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {(doc.signed_pdf_url || doc.pdf_url) && (
                    <a
                      href={doc.signed_pdf_url || doc.pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      {doc.signed_pdf_url ? 'PDF Firmato' : 'PDF'}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowUploadModal(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-800 mb-6">Nuovo Documento da Firmare</h2>
            <form onSubmit={handleUploadAndSend} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Documento PDF</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome Firmatario</label>
                <input
                  type="text"
                  value={signerName}
                  onChange={e => setSignerName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:border-green-500"
                  placeholder="Mario Rossi"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Firmatario</label>
                <input
                  type="email"
                  value={signerEmail}
                  onChange={e => setSignerEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:border-green-500"
                  placeholder="firmatario@email.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Firmatario <span className="text-gray-400 font-normal">(opzionale)</span></label>
                <input
                  type="tel"
                  value={signerPhone}
                  onChange={e => setSignerPhone(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:border-green-500"
                  placeholder="+39 347 1234567"
                />
              </div>
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
                  onClick={() => setShowUploadModal(false)}
                  className="px-6 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-lg transition-colors"
                >
                  Annulla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
