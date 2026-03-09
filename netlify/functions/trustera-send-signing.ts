import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { documentId } = JSON.parse(event.body || '{}')
    if (!documentId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'documentId richiesto' }) }
    }

    const { data: doc, error: docError } = await supabase
      .from('trustera_documents')
      .select('*')
      .eq('id', documentId)
      .single()

    if (docError || !doc) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Documento non trovato' }) }
    }

    // Generate signing token
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    const { error: updateError } = await supabase
      .from('trustera_documents')
      .update({
        signing_token: token,
        signing_token_expires_at: expiresAt,
        status: 'pending'
      })
      .eq('id', documentId)

    if (updateError) throw updateError

    // Send email to signer
    const signingUrl = `${process.env.SITE_URL || 'https://trustera360.app'}/sign/${token}`

    await resend.emails.send({
      from: 'Trustera <noreply@trustera360.app>',
      to: doc.signer_email,
      subject: `Documento da firmare: ${doc.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0d3d2a; margin: 0;">TRUSTERA</h1>
            <p style="color: #666; margin: 5px 0;">Firma Elettronica</p>
          </div>
          <p>Ciao <strong>${doc.signer_name}</strong>,</p>
          <p>Hai ricevuto un documento da firmare: <strong>${doc.name}</strong></p>
          <p>Clicca il pulsante qui sotto per visualizzare e firmare il documento:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${signingUrl}" style="background-color: #16a34a; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
              Firma il Documento
            </a>
          </div>
          <p style="color: #999; font-size: 12px;">Questo link scade tra 7 giorni.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #999; font-size: 12px; text-align: center;">
            Trustera - Infrastructure for Digital Trust<br/>
            <a href="https://trustera360.app" style="color: #16a34a;">www.trustera360.app</a>
          </p>
        </div>
      `
    })

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    }
  } catch (error: any) {
    console.error('Error sending signing request:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Errore interno' })
    }
  }
}
