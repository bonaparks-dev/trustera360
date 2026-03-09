import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

function cleanPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '')
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.startsWith('00')) return '+' + cleaned.slice(2)
  if (cleaned.startsWith('3') && cleaned.length === 10) return '+39' + cleaned
  return '+' + cleaned
}

async function sendWhatsAppOtp(phone: string, otp: string): Promise<boolean> {
  const idInstance = process.env.GREEN_API_INSTANCE_ID
  const apiToken = process.env.GREEN_API_TOKEN
  if (!idInstance || !apiToken) return false

  const chatId = phone.replace('+', '') + '@c.us'
  const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        message: `Il tuo codice di verifica Trustera è: *${otp}*\n\nNon condividere questo codice con nessuno.\nScade tra 10 minuti.`
      })
    })
    const data = await res.json()
    return !!data.idMessage
  } catch {
    return false
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { token } = JSON.parse(event.body || '{}')
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Token richiesto' }) }
    }

    const { data: doc, error } = await supabase
      .from('trustera_documents')
      .select('*')
      .eq('signing_token', token)
      .single()

    if (error || !doc) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Documento non trovato' }) }
    }

    if (doc.signing_token_expires_at && new Date(doc.signing_token_expires_at) < new Date()) {
      return { statusCode: 410, body: JSON.stringify({ error: 'Link scaduto' }) }
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString()
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min

    await supabase
      .from('trustera_documents')
      .update({ otp_code: otp, otp_expires_at: otpExpires })
      .eq('id', doc.id)

    // Try WhatsApp first, fallback to email
    let channel: 'whatsapp' | 'email' = 'email'

    if (doc.signer_phone) {
      const phone = cleanPhone(doc.signer_phone)
      const sent = await sendWhatsAppOtp(phone, otp)
      if (sent) channel = 'whatsapp'
    }

    if (channel === 'email') {
      await resend.emails.send({
        from: 'Trustera <noreply@trustera360.app>',
        to: doc.signer_email,
        subject: 'Codice di verifica Trustera',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; text-align: center;">
            <h1 style="color: #0d3d2a;">TRUSTERA</h1>
            <p>Il tuo codice di verifica:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #16a34a; margin: 20px 0; padding: 16px; background: #f0fdf4; border-radius: 8px;">
              ${otp}
            </div>
            <p style="color: #999; font-size: 12px;">Scade tra 10 minuti. Non condividere questo codice.</p>
          </div>
        `
      })
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, channel })
    }
  } catch (error: any) {
    console.error('Error sending OTP:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Errore nell\'invio del codice' })
    }
  }
}
