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
  pdf_url: string
  signed_pdf_url?: string
  signed_at?: string
}

export default function DashboardPage({ session }: { session: Session }) {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const userName = session.user.user_metadata?.full_name || session.user.email || 'Utente'

  useEffect(() => {
    loadDocuments()
  }, [])

  async function loadDocuments() {
    setLoading(true)
    const { data, error } = await supabase
      .from('trustera_documents')
      .select('*')
      .eq('owner_id', session.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading documents:', error)
    } else {
      setDocuments(data || [])
    }
    setLoading(false)
  }

  async function handleUploadAndSend(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile || !signerEmail || !signerName) return

    setUploading(true)
    try {
      // Upload PDF to storage
      const fileName = `documents/${session.user.id}/${Date.now()}_${selectedFile.name}`
      const { error: uploadError } = await supabase.storage
        .from('trustera')
        .upload(fileName, selectedFile, { contentType: 'application/pdf' })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('trustera').getPublicUrl(fileName)

      // Create document record
      const { data: doc, error: insertError } = await supabase
        .from('trustera_documents')
        .insert({
          owner_id: session.user.id,
          name: selectedFile.name,
          pdf_url: publicUrl,
          signer_name: signerName,
          signer_email: signerEmail,
          status: 'pending'
        })
        .select()
        .single()

      if (insertError) throw insertError

      // Send signing request via Netlify function
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/trustera-logo.png" alt="Trustera" className="h-8" />
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
        {/* Actions */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-800">I miei documenti</h1>
          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
          >
            + Nuovo Documento
          </button>
        </div>

        {/* Documents List */}
        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto"></div>
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-400 text-lg mb-4">Nessun documento</p>
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
            >
              Carica il primo documento
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {documents.map(doc => (
              <div key={doc.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-gray-800">{doc.name}</h3>
                    <span className={`text-xs text-white px-2 py-0.5 rounded-full font-bold ${statusColors[doc.status]}`}>
                      {statusLabels[doc.status]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    Firmatario: {doc.signer_name} ({doc.signer_email})
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(doc.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
                    {doc.signed_at && ` — Firmato il ${new Date(doc.signed_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {doc.pdf_url && (
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
