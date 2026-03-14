import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://zkcvsewfqnukdkvcairk.supabase.co',
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

    // Get sender name from auth user
    let senderName = 'Un utente Trustera'
    if (doc.owner_id) {
      const { data: { user: ownerUser } } = await supabase.auth.admin.getUserById(doc.owner_id)
      if (ownerUser?.user_metadata?.full_name) {
        senderName = ownerUser.user_metadata.full_name
      } else if (ownerUser?.email) {
        senderName = ownerUser.email
      }
    }

    const signingUrl = `${process.env.SITE_URL || 'https://trustera360.app'}/sign/${token}`

    // Send signing link via WhatsApp if phone is available
    const signerPhone = doc.signer_phone || ''
    const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
    const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

    if (signerPhone && GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
      try {
        let cleanPhone = signerPhone.replace(/[\s\-\+\(\)]/g, '')
        if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2)
        if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone

        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`
        const waResponse = await fetch(greenApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: `${cleanPhone}@c.us`,
            message: `Ciao ${doc.signer_name},\n\n*${senderName}* ti ha inviato un documento da firmare: *${doc.name}*\n\nClicca qui per firmarlo:\n${signingUrl}\n\nIl link scade tra 7 giorni.\n\n_Trustera - Infrastructure for Digital Trust_`
          })
        })
        const waResult = await waResponse.json()
        if (waResponse.ok && !waResult.error) {
          console.log('[trustera-send-signing] WhatsApp sent:', waResult.idMessage)
        } else {
          console.warn('[trustera-send-signing] WhatsApp failed:', waResult)
        }
      } catch (waErr: any) {
        console.warn('[trustera-send-signing] WhatsApp error:', waErr.message)
      }
    }

    // Send email to signer
    await resend.emails.send({
      from: 'Trustera <info@trustera360.app>',
      replyTo: 'info@trustera360.app',
      to: doc.signer_email,
      subject: `${senderName} ti ha inviato un documento da firmare`,
      text: `Ciao ${doc.signer_name},\n\n${senderName} ti ha inviato un documento da firmare: ${doc.name}\n\nClicca qui per visualizzare e firmare il documento:\n${signingUrl}\n\nQuesto link scade tra 7 giorni.\n\nTrustera - Infrastructure for Digital Trust\nhttps://trustera360.app`,
      html: `<!DOCTYPE html>
<html lang="it" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Documento da firmare</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background: #ffffff; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 32px 40px 0; text-align: center;">
              <img src="https://trustera360.app/trustera-logo.jpeg" alt="Trustera" style="height: 80px; width: auto; max-width: 200px;" />
              <p style="margin: 8px 0 0; color: #666; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 14px;">Firma Elettronica</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; color: #333; line-height: 1.6;">
              <p style="margin: 0 0 12px;">Ciao <strong>${doc.signer_name}</strong>,</p>
              <p style="margin: 0 0 12px;"><strong>${senderName}</strong> ti ha inviato un documento da firmare: <strong>${doc.name}</strong></p>
              <p style="margin: 0;">Clicca il pulsante qui sotto per visualizzare e firmare il documento:</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 40px; text-align: center;">
              <a href="${signingUrl}" style="display: inline-block; background-color: #16a34a; color: #ffffff; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 16px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 8px;">
                Firma il Documento
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 24px; text-align: center;">
              <p style="margin: 0; color: #999; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 12px;">Questo link scade tra 7 giorni.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 32px; text-align: center;">
              <p style="margin: 0; color: #d1d5db; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 11px;">
                Trustera - Infrastructure for Digital Trust<br/>
                <a href="https://trustera360.app" style="color: #16a34a; text-decoration: none;">www.trustera360.app</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
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
