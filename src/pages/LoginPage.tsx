import { useState, useEffect } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [showResend, setShowResend] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  useEffect(() => {
    if (searchParams.get('verified') === 'true') {
      toast.success('Email confermata! Ora puoi accedere.')
    }
    const error = searchParams.get('error')
    if (error) {
      toast.error(error)
    }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      if (isSignUp) {
        // Use our Netlify function that sends branded email via Resend
        const res = await fetch('/.netlify/functions/trustera-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, fullName })
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Errore nella registrazione')
        }

        toast.success('Account creato! Controlla la tua email per confermare.')
        setIsSignUp(false)
        setPassword('')
        setFullName('')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          if (error.message === 'Email not confirmed') {
            setShowResend(true)
            throw new Error('Email non confermata. Controlla la tua casella di posta.')
          }
          throw error
        }
        navigate('/dashboard')
      }
    } catch (error: any) {
      toast.error(error.message || 'Errore di autenticazione')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a2e1f] via-[#0d3d2a] to-[#0a2e1f] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/">
            <img src="/trustera-logo.jpeg" alt="Trustera" className="h-12 mx-auto mb-3" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">
            {isSignUp ? 'Crea Account' : 'Accedi'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {isSignUp ? 'Registrati per iniziare a firmare' : 'Accedi al tuo account Trustera'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome e Cognome</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:border-green-500 transition-colors"
                placeholder="Mario Rossi"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:border-green-500 transition-colors"
              placeholder="nome@email.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-12 text-gray-800 focus:outline-none focus:border-green-500 transition-colors"
                placeholder="Min. 6 caratteri"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-lg transition-colors text-lg"
          >
            {loading ? 'Caricamento...' : isSignUp ? 'Registrati' : 'Accedi'}
          </button>
        </form>

        {!isSignUp && !showForgot && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => { setShowForgot(true); setForgotEmail(email) }}
              className="text-sm text-gray-400 hover:text-green-600 transition-colors"
            >
              Password dimenticata?
            </button>
          </div>
        )}

        {showForgot && !isSignUp && (
          <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-sm text-gray-700 mb-3 font-medium">Recupera password</p>
            <input
              type="email"
              value={forgotEmail}
              onChange={e => setForgotEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-green-500 transition-colors mb-3"
              placeholder="La tua email"
            />
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!forgotEmail) { toast.error('Inserisci la tua email'); return }
                  setForgotLoading(true)
                  try {
                    const res = await fetch('/.netlify/functions/trustera-reset-password', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: forgotEmail })
                    })
                    const data = await res.json()
                    if (res.ok) {
                      toast.success(data.message || 'Email inviata!')
                      setShowForgot(false)
                    } else {
                      toast.error(data.error || 'Errore nell\'invio')
                    }
                  } catch {
                    toast.error('Errore nell\'invio dell\'email')
                  } finally {
                    setForgotLoading(false)
                  }
                }}
                disabled={forgotLoading}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold py-2 rounded-lg transition-colors text-sm"
              >
                {forgotLoading ? 'Invio...' : 'Invia link'}
              </button>
              <button
                onClick={() => setShowForgot(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm hover:bg-gray-100 transition-colors"
              >
                Annulla
              </button>
            </div>
          </div>
        )}

        {showResend && !isSignUp && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
            <p className="text-sm text-yellow-800 mb-2">Non hai ricevuto l'email di conferma?</p>
            <button
              onClick={async () => {
                setResendLoading(true)
                try {
                  const res = await fetch('/.netlify/functions/trustera-resend-verification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                  })
                  const data = await res.json()
                  if (res.ok) {
                    toast.success(data.message || 'Email inviata!')
                  } else {
                    toast.error(data.error || 'Errore nell\'invio')
                  }
                } catch {
                  toast.error('Errore nell\'invio dell\'email')
                } finally {
                  setResendLoading(false)
                }
              }}
              disabled={resendLoading}
              className="text-sm text-green-600 font-semibold hover:underline disabled:text-gray-400"
            >
              {resendLoading ? 'Invio in corso...' : 'Reinvia email di conferma'}
            </button>
          </div>
        )}

        <p className="text-center text-sm text-gray-500 mt-6">
          {isSignUp ? 'Hai gia un account?' : 'Non hai un account?'}{' '}
          <button
            onClick={() => { setIsSignUp(!isSignUp); setShowResend(false) }}
            className="text-green-600 font-semibold hover:underline"
          >
            {isSignUp ? 'Accedi' : 'Registrati gratis'}
          </button>
        </p>
      </div>
    </div>
  )
}
