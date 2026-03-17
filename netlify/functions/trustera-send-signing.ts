import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://zkcvsewfqnukdkvcairk.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const SITE_URL = process.env.SITE_URL || 'https://trustera360.app'

function cleanPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '')
  if (cleaned.startsWith('+')) return cleaned.slice(1) // return without + for chatId
  if (cleaned.startsWith('00')) return cleaned.slice(2)
  if (cleaned.startsWith('3') && cleaned.length === 10) return '39' + cleaned
  return cleaned
}

async function sendWhatsAppSigningLink(
  phone: string,
  signerName: string,
  senderName: string,
  documentName: string,
  signingUrl: string
): Promise<boolean> {
  const idInstance = process.env.GREEN_API_INSTANCE_ID
  const apiToken = process.env.GREEN_API_TOKEN
  if (!idInstance || !apiToken) return false

  const chatId = cleanPhone(phone) + '@c.us'
  const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        message: `Ciao ${signerName},\n\n*${senderName}* ti ha inviato un documento da firmare: *${documentName}*\n\nClicca qui per firmarlo:\n${signingUrl}\n\nIl link scade tra 12 ore.\n\n_Trustera - Infrastructure for Digital Trust_`
      })
    })
    const data = await res.json()
    if (res.ok && data.idMessage) {
      console.log('[trustera-send-signing] WhatsApp sent:', data.idMessage)
      return true
    }
    console.warn('[trustera-send-signing] WhatsApp response not OK:', data)
    return false
  } catch (err: any) {
    console.warn('[trustera-send-signing] WhatsApp error:', err.message)
    return false
  }
}

function buildSigningEmailHtml(signerName: string, senderName: string, documentName: string, signingUrl: string): string {
  return `<!DOCTYPE html>
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
              <p style="margin: 0 0 12px;">Ciao <strong>${signerName}</strong>,</p>
              <p style="margin: 0 0 12px;"><strong>${senderName}</strong> ti ha inviato un documento da firmare: <strong>${documentName}</strong></p>
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
              <p style="margin: 0; color: #999; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 12px;">Questo link scade tra 12 ore.</p>
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
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { documentId, signers, requireOtp = true } = JSON.parse(event.body || '{}')

    if (!documentId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'documentId richiesto' }) }
    }
    if (!Array.isArray(signers) || signers.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'signers richiesto (array non vuoto)' }) }
    }

    // Validate each signer has at least name + email
    for (const s of signers) {
      if (!s.name || !s.email) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Ogni firmatario deve avere name e email' }) }
      }
    }

    // Fetch document
    const { data: doc, error: docError } = await supabase
      .from('trustera_documents')
      .select('*')
      .eq('id', documentId)
      .single()

    if (docError || !doc) {
      console.error('[trustera-send-signing] Document not found:', docError?.message)
      return { statusCode: 404, body: JSON.stringify({ error: 'Documento non trovato' }) }
    }

    // Get sender name from document owner's auth profile
    let senderName = 'Un utente Trustera'
    if (doc.owner_id) {
      const { data: { user: ownerUser } } = await supabase.auth.admin.getUserById(doc.owner_id)
      if (ownerUser?.user_metadata?.full_name) {
        senderName = ownerUser.user_metadata.full_name
      } else if (ownerUser?.email) {
        senderName = ownerUser.email
      }
    }

    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() // 12 hours

    // Process each signer
    for (let signerIndex = 0; signerIndex < signers.length; signerIndex++) {
      const signer = signers[signerIndex]
      const token = crypto.randomBytes(32).toString('hex')
      const signingUrl = `${SITE_URL}/sign/${token}`

      // Insert signer record into trustera_document_signers
      const { data: insertedSigner, error: signerInsertError } = await supabase
        .from('trustera_document_signers')
        .insert({
          document_id: documentId,
          signer_name: signer.name,
          signer_email: signer.email,
          signer_phone: signer.phone || null,
          notification_channel: signer.channel || 'email',
          require_otp: requireOtp,
          signing_token: token,
          signing_token_expires_at: expiresAt,
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select('id')
        .single()

      if (signerInsertError) {
        console.error('[trustera-send-signing] Failed to insert signer:', signerInsertError.message)
        throw signerInsertError
      }

      // Link document fields (placed via field editor) to this signer
      if (insertedSigner) {
        const { error: fieldLinkError } = await supabase
          .from('trustera_document_fields')
          .update({ signer_id: insertedSigner.id })
          .eq('document_id', documentId)
          .eq('signer_index', signerIndex)

        if (fieldLinkError) {
          console.warn('[trustera-send-signing] Field link error:', fieldLinkError.message)
        }
      }

      // Upsert into trustera_contacts (by owner_id + email)
      if (doc.owner_id) {
        const { error: contactError } = await supabase
          .from('trustera_contacts')
          .upsert(
            {
              owner_id: doc.owner_id,
              email: signer.email,
              name: signer.name,
              phone: signer.phone || null,
              updated_at: new Date().toISOString()
            },
            { onConflict: 'owner_id,email' }
          )
        if (contactError) {
          console.warn('[trustera-send-signing] Contact upsert failed:', contactError.message)
        }
      }

      // Upsert into trustera_leads (by email, never overwrite marketing_consent=true with false)
      const { data: existingLead } = await supabase
        .from('trustera_leads')
        .select('id, marketing_consent')
        .eq('email', signer.email)
        .maybeSingle()

      const leadPayload: Record<string, any> = {
        email: signer.email,
        name: signer.name,
        phone: signer.phone || null,
        last_seen_at: new Date().toISOString(),
        source: 'signing_request'
      }

      // Never downgrade marketing_consent from true to false
      if (!existingLead || existingLead.marketing_consent !== true) {
        leadPayload.marketing_consent = false
      }

      const { error: leadError } = await supabase
        .from('trustera_leads')
        .upsert(leadPayload, { onConflict: 'email' })

      if (leadError) {
        console.warn('[trustera-send-signing] Lead upsert failed:', leadError.message)
      }

      // Send via chosen channel (or both if no channel specified)
      const channel = signer.channel || 'email'

      if (channel === 'whatsapp' && signer.phone) {
        await sendWhatsAppSigningLink(signer.phone, signer.name, senderName, doc.name, signingUrl)
      } else {
        // Default: send email
        try {
          await resend.emails.send({
            from: 'Trustera <info@trustera360.app>',
            replyTo: 'info@trustera360.app',
            to: signer.email,
            subject: `${senderName} ti ha inviato un documento da firmare`,
            text: `Ciao ${signer.name},\n\n${senderName} ti ha inviato un documento da firmare: ${doc.name}\n\nClicca qui per visualizzare e firmare il documento:\n${signingUrl}\n\nQuesto link scade tra 12 ore.\n\nTrustera - Infrastructure for Digital Trust\nhttps://trustera360.app`,
            html: buildSigningEmailHtml(signer.name, senderName, doc.name, signingUrl)
          })
        } catch (emailErr: any) {
          console.error('[trustera-send-signing] Email send failed for', signer.email, ':', emailErr.message)
          throw emailErr
        }
      }

      console.log('[trustera-send-signing] Signer processed:', signer.email)
    }

    // Update document status to pending
    const { error: statusError } = await supabase
      .from('trustera_documents')
      .update({ status: 'pending' })
      .eq('id', documentId)

    if (statusError) {
      console.error('[trustera-send-signing] Status update failed:', statusError.message)
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, signerCount: signers.length })
    }
  } catch (error: any) {
    console.error('[trustera-send-signing] Error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Errore interno' })
    }
  }
}
