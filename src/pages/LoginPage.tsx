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
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:border-green-500 transition-colors"
              placeholder="Min. 6 caratteri"
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-lg transition-colors text-lg"
          >
            {loading ? 'Caricamento...' : isSignUp ? 'Registrati' : 'Accedi'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          {isSignUp ? 'Hai gia un account?' : 'Non hai un account?'}{' '}
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-green-600 font-semibold hover:underline"
          >
            {isSignUp ? 'Accedi' : 'Registrati gratis'}
          </button>
        </p>
      </div>
    </div>
  )
}
