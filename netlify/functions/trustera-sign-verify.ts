import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co',
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

    const { data: doc, error } = await supabase
      .from('trustera_documents')
      .select('*')
      .eq('signing_token', token)
      .single()

    if (error || !doc) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Documento non trovato' }) }
    }

    // Check OTP expiration
    if (doc.otp_expires_at && new Date(doc.otp_expires_at) < new Date()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Codice scaduto. Richiedi un nuovo codice.' }) }
    }

    // Verify OTP
    if (doc.otp_code !== otp) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Codice non valido' }) }
    }

    // Mark OTP as verified
    await supabase
      .from('trustera_documents')
      .update({ otp_verified: true, otp_code: null })
      .eq('id', doc.id)

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    }
  } catch (error: any) {
    console.error('Error verifying OTP:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Errore nella verifica' })
    }
  }
}
