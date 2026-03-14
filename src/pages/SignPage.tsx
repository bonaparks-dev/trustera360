import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'

type SigningStatus = 'loading' | 'viewing' | 'otp_sending' | 'otp_sent' | 'otp_verifying' | 'signing' | 'signed' | 'expired' | 'error'

export default function SignPage() {
  const { token } = useParams<{ token: string }>()
  const [status, setStatus] = useState<SigningStatus>('loading')
  const [signerName, setSignerName] = useState('')
  const [documentName, setDocumentName] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null)
  const [signedAt, setSignedAt] = useState<string | null>(null)
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [otpChannel, setOtpChannel] = useState<'whatsapp' | 'email' | null>(null)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (token) loadData()
  }, [token])

  async function loadData() {
    try {
      const res = await fetch('/.netlify/functions/trustera-sign-get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
      if (res.status === 410) { setStatus('expired'); return }
      if (!res.ok) { const err = await res.json(); setError(err.error); setStatus('error'); return }
      const data = await res.json()
      setSignerName(data.signerName)
      setDocumentName(data.documentName)
      setPdfUrl(data.pdfUrl)
      if (data.status === 'signed') {
        setSignedPdfUrl(data.signedPdfUrl)
        setSignedAt(data.signedAt)
        setStatus('signed')
      } else {
        setStatus('viewing')
      }
    } catch {
      setError('Impossibile caricare i dati')
      setStatus('error')
    }
  }

  async function handleRequestOtp() {
    setStatus('otp_sending')
    setError('')
    try {
      const res = await fetch('/.netlify/functions/trustera-sign-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
      if (!res.ok) { const err = await res.json(); setError(err.error); setStatus('viewing'); return }
      const data = await res.json()
      if (data.channel) setOtpChannel(data.channel)
      setStatus('otp_sent')
      setOtp(['', '', '', '', '', ''])
      setTimeout(() => otpRefs.current[0]?.focus(), 100)
    } catch {
      setError('Errore nell\'invio del codice')
      setStatus('viewing')
    }
  }

  async function handleVerifyOtp() {
    const otpCode = otp.join('')
    if (otpCode.length !== 6) { setError('Inserisci il codice completo'); return }
    setStatus('otp_verifying')
    setError('')
    try {
      const res = await fetch('/.netlify/functions/trustera-sign-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, otp: otpCode })
      })
      const data = await res.json()
      if (!res.ok) { setError(data.debug ? `${data.error} (${data.debug})` : data.error); setStatus('otp_sent'); return }
      setStatus('signing')
    } catch {
      setError('Errore nella verifica')
      setStatus('otp_sent')
    }
  }

  async function handleSign() {
    if (!acceptedTerms) { setError('Devi accettare i termini'); return }
    setError('')
    try {
      const res = await fetch('/.netlify/functions/trustera-sign-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
      if (!res.ok) { const err = await res.json(); setError(err.error); return }
      const data = await res.json()
      setSignedPdfUrl(data.signedPdfUrl)
      setSignedAt(data.signedAt)
      setStatus('signed')
    } catch {
      setError('Errore durante la firma')
    }
  }

  function handleOtpChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value.slice(-1)
    setOtp(newOtp)
    if (value && index < 5) otpRefs.current[index + 1]?.focus()
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus()
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    const newOtp = [...otp]
    for (let i = 0; i < pasted.length; i++) newOtp[i] = pasted[i]
    setOtp(newOtp)
    otpRefs.current[Math.min(pasted.length, 5)]?.focus()
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    )
  }

  if (status === 'expired') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Link Scaduto</h1>
          <p className="text-gray-600">Il link di firma e scaduto. Contatta il mittente per un nuovo link.</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Errore</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 py-4 px-6 flex items-center justify-between">
        <div className="flex items-center">
          <img src="/trustera-logo.jpeg" alt="Trustera" className="h-12 w-auto" />
        </div>
        <span className="text-sm text-gray-400">Firma Elettronica</span>
      </div>

      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        {/* Document info */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h1 className="text-xl font-bold text-gray-800 mb-1">{documentName || 'Documento'}</h1>
          <p className="text-sm text-gray-500">Firmatario: {signerName}</p>
        </div>

        {/* PDF viewer — Google Docs Viewer for full multi-page support */}
        {pdfUrl && status !== 'signed' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
            <iframe
              src={`https://docs.google.com/gview?url=${encodeURIComponent(pdfUrl)}&embedded=true`}
              className="w-full border-0"
              style={{ height: '70vh', minHeight: '500px' }}
              title="Documento"
            />
          </div>
        )}

        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">{error}</div>}

        {/* Step 1: Request OTP */}
        {status === 'viewing' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
            <h2 className="text-lg font-bold text-gray-800 mb-2">Firma il Documento</h2>
            <p className="text-gray-600 text-sm mb-6">Invieremo un codice di verifica via WhatsApp o email.</p>
            <button onClick={handleRequestOtp} className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg transition-colors text-lg">
              Invia Codice di Verifica
            </button>
          </div>
        )}

        {status === 'otp_sending' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Invio codice di verifica...</p>
          </div>
        )}

        {/* Step 2: Enter OTP */}
        {(status === 'otp_sent' || status === 'otp_verifying') && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-2 text-center">Inserisci Codice OTP</h2>
            <p className="text-gray-600 text-sm mb-6 text-center">
              {otpChannel === 'whatsapp' ? 'Codice inviato via WhatsApp.' : 'Codice inviato via email.'}
            </p>
            <div className="flex justify-center gap-2 mb-6" onPaste={handleOtpPaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-300 rounded-lg focus:border-green-500 focus:outline-none"
                  disabled={status === 'otp_verifying'}
                />
              ))}
            </div>
            <div className="flex flex-col gap-3 items-center">
              <button onClick={handleVerifyOtp} disabled={otp.join('').length !== 6 || status === 'otp_verifying'} className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-3 px-8 rounded-lg transition-colors w-full max-w-xs">
                {status === 'otp_verifying' ? 'Verifica...' : 'Verifica Codice'}
              </button>
              <button onClick={handleRequestOtp} className="text-sm text-gray-500 hover:text-gray-700">Invia di nuovo</button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {status === 'signing' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4 text-center">Conferma Firma</h2>
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-6 text-sm text-green-700 text-center">
              Identita verificata con successo
            </div>
            <label className="flex items-start gap-3 mb-6 cursor-pointer">
              <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} className="mt-1 h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500" />
              <span className="text-sm text-gray-700">
                Confermo che i dati sono corretti e accetto di firmare elettronicamente questo documento.
              </span>
            </label>
            <button onClick={handleSign} disabled={!acceptedTerms} className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-4 rounded-lg transition-colors text-lg">
              Firma il Documento
            </button>
          </div>
        )}

        {/* Step 4: Signed */}
        {status === 'signed' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
            <h2 className="text-2xl font-bold text-green-700 mb-2">Documento Firmato</h2>
            <p className="text-gray-600 mb-6">
              {signedAt ? `Firmato il ${new Date(signedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}` : 'Firma completata.'}
            </p>
            {signedPdfUrl && (
              <a href={signedPdfUrl} target="_blank" rel="noreferrer" className="inline-block bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg transition-colors">
                Scarica Documento Firmato
              </a>
            )}
            <p className="text-xs text-gray-400 mt-6">Firma documenti in pochi secondi — <a href="https://trustera360.app" className="text-green-600 hover:underline">www.trustera360.app</a> — tutto gratuito.</p>
          </div>
        )}
      </div>

      <div className="text-center py-6 text-xs text-gray-400">
        Trustera - Infrastructure for Digital Trust
      </div>
    </div>
  )
}
