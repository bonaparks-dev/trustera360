import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    const accessToken = searchParams.get('access_token')
    const refreshToken = searchParams.get('refresh_token')

    if (accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) {
            toast.error('Sessione non valida. Richiedi un nuovo link.')
            navigate('/login')
          } else {
            setSessionReady(true)
          }
        })
    } else {
      // Check if already has a valid session (e.g. from Supabase redirect)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setSessionReady(true)
        } else {
          toast.error('Link non valido. Richiedi un nuovo link di recupero.')
          navigate('/login')
        }
      })
    }
  }, [searchParams, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (password !== confirmPassword) {
      toast.error('Le password non corrispondono')
      return
    }

    if (password.length < 6) {
      toast.error('La password deve avere almeno 6 caratteri')
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      toast.success('Password aggiornata! Ora puoi accedere.')
      await supabase.auth.signOut()
      navigate('/login')
    } catch (error: any) {
      toast.error(error.message || 'Errore nell\'aggiornamento della password')
    } finally {
      setLoading(false)
    }
  }

  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a2e1f] via-[#0d3d2a] to-[#0a2e1f] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a2e1f] via-[#0d3d2a] to-[#0a2e1f] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/">
            <img src="/trustera-logo.jpeg" alt="Trustera" className="h-12 mx-auto mb-3" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">Nuova Password</h1>
          <p className="text-gray-500 text-sm mt-1">Inserisci la tua nuova password</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nuova Password</label>
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Conferma Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:border-green-500 transition-colors"
              placeholder="Ripeti la password"
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-lg transition-colors text-lg"
          >
            {loading ? 'Aggiornamento...' : 'Aggiorna Password'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          <Link to="/login" className="text-green-600 font-semibold hover:underline">
            Torna al login
          </Link>
        </p>
      </div>
    </div>
  )
}
