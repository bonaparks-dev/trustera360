import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://zkcvsewfqnukdkvcairk.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { token, otp } = JSON.parse(event.body || '{}')
    if (!token || !otp) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Token e OTP richiesti' }) }
    }

    console.log('[trustera-sign-verify] Looking up token:', token.substring(0, 8) + '...')

    const { data: doc, error } = await supabase
      .from('trustera_documents')
      .select('*')
      .eq('signing_token', token)
      .single()

    if (error) {
      console.error('[trustera-sign-verify] Supabase error:', error.message, error.code, error.details)
      return { statusCode: 404, body: JSON.stringify({ error: 'Documento non trovato', debug: error.message }) }
    }

    if (!doc) {
      console.error('[trustera-sign-verify] No document found for token')
      return { statusCode: 404, body: JSON.stringify({ error: 'Documento non trovato' }) }
    }

    console.log('[trustera-sign-verify] Found doc:', doc.id, 'otp_code:', doc.otp_code ? 'SET' : 'NULL', 'otp_expires_at:', doc.otp_expires_at)

    // Check OTP expiration
    if (doc.otp_expires_at && new Date(doc.otp_expires_at) < new Date()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Codice scaduto. Richiedi un nuovo codice.' }) }
    }

    // Verify OTP
    if (doc.otp_code !== otp) {
      console.log('[trustera-sign-verify] OTP mismatch. Expected:', doc.otp_code ? 'exists' : 'NULL', 'Got:', otp)
      return { statusCode: 400, body: JSON.stringify({ error: 'Codice non valido' }) }
    }

    // Mark OTP as verified
    const { error: updateError } = await supabase
      .from('trustera_documents')
      .update({ otp_verified: true, otp_code: null })
      .eq('id', doc.id)

    if (updateError) {
      console.error('[trustera-sign-verify] Update failed:', updateError.message)
      return { statusCode: 500, body: JSON.stringify({ error: 'Errore nel salvataggio della verifica' }) }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    }
  } catch (error: any) {
    console.error('[trustera-sign-verify] Error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Errore nella verifica' })
    }
  }
}
