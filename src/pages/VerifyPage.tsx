import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

interface SignerInfo {
  name: string
  email: string
  phone: string
  channel: string
  signed_at: string
  signing_ip: string
  user_agent: string
}

interface AuditEvent {
  action: string
  email: string
  ip: string
  userAgent: string
  timestamp: string
  metadata: Record<string, any>
}

interface VerificationData {
  documentName: string
  signedAt: string
  createdAt: string | null
  originalHash: string
  senderName: string
  signers: SignerInfo[]
  auditTrail: AuditEvent[]
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    otp_sent: 'Codice OTP inviato',
    otp_verified: 'Identità verificata (OTP)',
    otp_failed: 'Tentativo OTP fallito',
    otp_expired: 'Codice OTP scaduto',
    document_opened: 'Documento aperto dal firmatario',
    document_viewed: 'Documento visualizzato',
    signature_applied: 'Firma applicata',
    document_signed: 'Documento firmato',
    signing_completed: 'Processo di firma completato',
    email_sent: 'Richiesta di firma inviata via Email',
    whatsapp_sent: 'Richiesta di firma inviata via WhatsApp',
    signed_pdf_sent: 'PDF firmato consegnato',
    approval_requested: 'Richiesta di approvazione inviata',
    approval_approved: 'Documento approvato',
    approval_rejected: 'Documento rifiutato',
  }
  return map[action] || action.replace(/_/g, ' ')
}

function actionIcon(action: string): string {
  const icons: Record<string, string> = {
    otp_sent: '🔐',
    otp_verified: '✅',
    otp_failed: '❌',
    otp_expired: '⏰',
    document_opened: '📄',
    document_viewed: '👁',
    signature_applied: '✍️',
    document_signed: '📝',
    signing_completed: '🏁',
    email_sent: '📧',
    whatsapp_sent: '💬',
    signed_pdf_sent: '📤',
    approval_requested: '🔔',
    approval_approved: '👍',
    approval_rejected: '👎',
  }
  return icons[action] || '•'
}

function actionColor(action: string): string {
  if (['otp_verified', 'signature_applied', 'signing_completed', 'approval_approved'].includes(action)) return 'bg-green-500'
  if (['otp_failed', 'otp_expired', 'approval_rejected'].includes(action)) return 'bg-red-400'
  if (['email_sent', 'whatsapp_sent', 'signed_pdf_sent'].includes(action)) return 'bg-blue-400'
  if (['document_opened', 'document_viewed'].includes(action)) return 'bg-gray-400'
  return 'bg-green-500'
}

function parseBrowser(ua: string): string {
  if (!ua) return ''
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome'
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari'
  if (ua.includes('Edg')) return 'Edge'
  if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera'
  return 'Browser'
}

function parseOS(ua: string): string {
  if (!ua) return ''
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac OS')) return 'macOS'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('Linux')) return 'Linux'
  return ''
}

export default function VerifyPage() {
  const { hash } = useParams<{ hash: string }>()
  const [data, setData] = useState<VerificationData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAuditTrail, setShowAuditTrail] = useState(false)

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

  const fmtDate = (d: string) => new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'long', timeStyle: 'short' })
  const fmtDateShort = (d: string) => new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'medium' })

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
        </div>

        {/* Content */}
        <div className="px-8 py-6 space-y-5">
          {/* Document info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Documento</p>
              <p className="text-gray-900 font-semibold text-sm">{data.documentName}</p>
            </div>
            {data.senderName && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Inviato da</p>
                <p className="text-gray-700 text-sm">{data.senderName}</p>
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            {data.createdAt && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Creato il</p>
                <p className="text-gray-700 text-sm">{fmtDate(data.createdAt)}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Firmato il</p>
              <p className="text-gray-700 text-sm">{fmtDate(data.signedAt)}</p>
            </div>
          </div>

          {/* Signers */}
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Firmatari ({data.signers.length})</p>
            <div className="space-y-3">
              {data.signers.map((s, i) => {
                const browser = parseBrowser(s.user_agent)
                const os = parseOS(s.user_agent)
                const deviceInfo = [browser, os].filter(Boolean).join(' / ')
                return (
                  <div key={i} className="bg-gray-50 rounded-xl px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-green-700 font-bold text-sm">
                          {s.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 text-sm">{s.name}</p>
                        {s.email && <p className="text-xs text-gray-500">{s.email}</p>}
                        {s.phone && <p className="text-xs text-gray-500">{s.phone}</p>}
                      </div>
                      <div className="flex-shrink-0">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          s.channel === 'whatsapp' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {s.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
                        </span>
                      </div>
                    </div>
                    {/* Signer details */}
                    <div className="mt-2 pt-2 border-t border-gray-200/60 grid grid-cols-2 gap-x-4 gap-y-1">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase">Data firma</p>
                        <p className="text-xs text-gray-600">{fmtDateShort(s.signed_at)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase">Indirizzo IP</p>
                        <p className="text-xs text-gray-600 font-mono">{s.signing_ip}</p>
                      </div>
                      {deviceInfo && (
                        <div className="col-span-2">
                          <p className="text-[10px] text-gray-400 uppercase">Dispositivo</p>
                          <p className="text-xs text-gray-600">{deviceInfo}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Hash */}
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Impronta digitale (SHA-256)</p>
            <p className="text-xs text-gray-500 font-mono break-all bg-gray-50 rounded-lg px-3 py-2">{data.originalHash}</p>
          </div>

          {/* Audit Trail toggle */}
          {data.auditTrail.length > 0 && (
            <div>
              <button onClick={() => setShowAuditTrail(!showAuditTrail)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                <span className="text-sm font-semibold text-gray-700">Audit Trail ({data.auditTrail.length} eventi)</span>
                <svg className={`w-5 h-5 text-gray-400 transition-transform ${showAuditTrail ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {showAuditTrail && (
                <div className="mt-3 relative pl-5 border-l-2 border-gray-200 space-y-4">
                  {data.auditTrail.map((evt, i) => {
                    const color = actionColor(evt.action)
                    const icon = actionIcon(evt.action)
                    const browser = parseBrowser(evt.userAgent)
                    const os = parseOS(evt.userAgent)
                    const deviceInfo = [browser, os].filter(Boolean).join(' / ')
                    const signerName = evt.metadata?.signer_name || evt.metadata?.approver_name || ''
                    const channel = evt.metadata?.channel || ''
                    return (
                      <div key={i} className="relative">
                        <div className={`absolute -left-[23px] w-3.5 h-3.5 rounded-full ${color} border-2 border-white flex items-center justify-center`} />
                        <div className="ml-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{icon}</span>
                            <p className="text-sm font-medium text-gray-800">{formatAction(evt.action)}</p>
                          </div>
                          <div className="ml-6 space-y-0.5">
                            <p className="text-xs text-gray-400">{fmtDateShort(evt.timestamp)}</p>
                            {(evt.email || signerName) && (
                              <p className="text-xs text-gray-600">
                                {signerName && <span className="font-medium">{signerName}</span>}
                                {signerName && evt.email && ' — '}
                                {evt.email && <span>{evt.email}</span>}
                              </p>
                            )}
                            {channel && (
                              <p className="text-[10px] text-gray-400">
                                Canale: {channel === 'whatsapp' ? 'WhatsApp' : channel === 'email' ? 'Email' : channel}
                              </p>
                            )}
                            {evt.ip && <p className="text-[10px] text-gray-400 font-mono">IP: {evt.ip}</p>}
                            {deviceInfo && <p className="text-[10px] text-gray-400">{deviceInfo}</p>}
                            {evt.metadata?.reason && (
                              <p className="text-[10px] text-red-500">Motivo: {evt.metadata.reason}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="pt-2 border-t border-gray-100 text-center space-y-1">
            <p className="text-xs text-gray-400">
              Firma elettronica avanzata conforme al Regolamento eIDAS (UE) 910/2014
            </p>
            <p className="text-[10px] text-gray-400">
              Questo certificato attesta l'autenticità e l'integrità del documento firmato digitalmente tramite Trustera.
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
