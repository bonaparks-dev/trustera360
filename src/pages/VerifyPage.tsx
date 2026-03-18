import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

interface SignerInfo {
  name: string
  email: string
  signed_at: string
  signing_ip: string
}

interface VerificationData {
  documentName: string
  signedAt: string
  originalHash: string
  signers: SignerInfo[]
}

export default function VerifyPage() {
  const { hash } = useParams<{ hash: string }>()
  const [data, setData] = useState<VerificationData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hash) { setError('Hash mancante'); setLoading(false); return }
    fetch('/.netlify/functions/trustera-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash })
    })
      .then(async res => {
        if (!res.ok) { const err = await res.json(); throw new Error(err.error) }
        return res.json()
      })
      .then(setData)
      .catch(err => setError(err.message || 'Documento non trovato'))
      .finally(() => setLoading(false))
  }, [hash])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Verifica non riuscita</h1>
          <p className="text-gray-500">{error || 'Documento non trovato'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="bg-white rounded-2xl shadow-lg max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-green-700 px-8 py-6 text-center">
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">Documento Verificato</h1>
          <p className="text-green-100 text-sm mt-1">Certificato da Trustera</p>
        </div>

        {/* Content */}
        <div className="px-8 py-6 space-y-5">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Documento</p>
            <p className="text-gray-900 font-semibold">{data.documentName}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Data firma</p>
            <p className="text-gray-700">
              {new Date(data.signedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'long', timeStyle: 'short' })}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Firmatari</p>
            <div className="space-y-3">
              {data.signers.map((s, i) => (
                <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3">
                  <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-green-700 font-bold text-sm">
                      {s.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{s.name}</p>
                    {s.email && <p className="text-xs text-gray-400">{s.email}</p>}
                    <p className="text-xs text-gray-400">
                      {new Date(s.signed_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                    <p className="text-xs text-gray-300 font-mono mt-0.5">IP: {s.signing_ip}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Hash SHA-256</p>
            <p className="text-xs text-gray-500 font-mono break-all bg-gray-50 rounded-lg px-3 py-2">{data.originalHash}</p>
          </div>

          <div className="pt-2 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">
              Firma conforme al Regolamento eIDAS (UE) 910/2014
            </p>
            <p className="text-xs text-green-600 font-medium mt-1">
              <a href="https://trustera360.app" target="_blank" rel="noreferrer">www.trustera360.app</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
