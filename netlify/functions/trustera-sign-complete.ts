import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { Resend } from 'resend'
import crypto from 'crypto'
import QRCode from 'qrcode'

// Trustera Supabase — primary
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://zkcvsewfqnukdkvcairk.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// DR7 Supabase — for customers_extended phone lookup (legacy fallback)
const supabaseDR7 = createClient(
  process.env.DR7_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co',
  process.env.DR7_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

async function sendSignedPdfEmail(
  to: string,
  documentName: string,
  signerNames: string,
  pdfBytes: Buffer,
  isOwner: boolean
): Promise<void> {
  try {
    const subject = isOwner
      ? `Documento firmato: ${documentName}`
      : `Hai firmato: ${documentName}`

    const bodyText = isOwner
      ? `Il documento "${documentName}" è stato firmato da tutti i firmatari (${signerNames}).\n\nIl PDF firmato è in allegato.\n\nTrustera - Infrastructure for Digital Trust\nhttps://trustera360.app`
      : `Hai firmato il documento "${documentName}".\n\nIl PDF firmato è in allegato.\n\nTrustera - Infrastructure for Digital Trust\nhttps://trustera360.app`

    const bodyHtml = `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f9fafb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:32px 40px 0;text-align:center;">
    <img src="https://trustera360.app/trustera-logo.jpeg" alt="Trustera" style="height:80px;width:auto;max-width:200px;" />
  </td></tr>
  <tr><td style="padding:24px 40px 0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;color:#333;line-height:1.6;">
    ${isOwner
      ? `<p style="margin:0 0 12px;">Il documento <strong>${documentName}</strong> è stato firmato da tutti i firmatari.</p><p style="margin:0 0 12px;">Firmatari: <strong>${signerNames}</strong></p>`
      : `<p style="margin:0 0 12px;">Hai firmato il documento <strong>${documentName}</strong>.</p>`}
    <p style="margin:0;">Il PDF firmato è in allegato a questa email.</p>
  </td></tr>
  <tr><td style="padding:28px 40px;text-align:center;">
    <div style="display:inline-block;background-color:#f0fdf4;color:#16a34a;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;border:1px solid #bbf7d0;">
      📎 PDF allegato
    </div>
  </td></tr>
  <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" /></td></tr>
  <tr><td style="padding:24px 40px 32px;text-align:center;">
    <p style="margin:0;color:#d1d5db;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:11px;">
      Trustera - Infrastructure for Digital Trust<br/>
      <a href="https://trustera360.app" style="color:#16a34a;text-decoration:none;">www.trustera360.app</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`

    const safeName = documentName.replace(/[^a-zA-Z0-9._-]/g, '_')

    await resend.emails.send({
      from: 'Trustera <info@trustera360.app>',
      replyTo: 'info@trustera360.app',
      to,
      subject,
      text: bodyText,
      html: bodyHtml,
      attachments: [{
        filename: `${safeName}_firmato.pdf`,
        content: pdfBytes,
      }],
    })
    console.log('[trustera-sign-complete] Signed PDF email sent to:', to)
  } catch (err: any) {
    console.warn('[trustera-sign-complete] Email send failed for', to, ':', err.message)
  }
}

function cleanPhoneForChatId(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '')
  if (cleaned.startsWith('+')) return cleaned.slice(1)
  if (cleaned.startsWith('00')) return cleaned.slice(2)
  if (cleaned.startsWith('3') && cleaned.length === 10) return '39' + cleaned
  return cleaned
}

async function sendWhatsAppPdf(phone: string, publicUrl: string, documentName: string, signerName: string): Promise<void> {
  const idInstance = process.env.GREEN_API_INSTANCE_ID
  const apiToken = process.env.GREEN_API_TOKEN
  if (!idInstance || !apiToken) return

  const chatId = cleanPhoneForChatId(phone) + '@c.us'
  try {
    await fetch(`https://api.green-api.com/waInstance${idInstance}/sendFileByUrl/${apiToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        urlFile: publicUrl,
        fileName: `${documentName}_firmato.pdf`,
        caption: `Documento firmato: ${documentName}\nFirmato da: ${signerName}\n\nTrustera - Infrastructure for Digital Trust`
      })
    })
  } catch (err: any) {
    console.warn('[trustera-sign-complete] WhatsApp PDF send failed for', phone, ':', err.message)
  }
}

interface AttestationSigner {
  name: string
  email: string
  signed_at: string
  signing_ip: string
  signing_user_agent: string
}

interface FieldValueEntry {
  field_type: string
  page_number: number
  x_percent: number
  y_percent: number
  width_percent: number
  height_percent: number
  label?: string
  value: string | boolean
}

async function buildSignedPdf(
  originalPdfBytes: ArrayBuffer,
  signers: AttestationSigner[],
  documentName: string,
  originalHash: string,
  fieldEntries?: FieldValueEntry[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // Embed field values on existing pages
  if (fieldEntries && fieldEntries.length > 0) {
    const existingPages = pdfDoc.getPages()
    for (const entry of fieldEntries) {
      const pageIndex = entry.page_number - 1
      if (pageIndex < 0 || pageIndex >= existingPages.length) continue

      const page = existingPages[pageIndex]
      const { width, height } = page.getSize()

      // Convert percentages to pdf-lib coordinates (bottom-left origin)
      const x = (entry.x_percent / 100) * width
      const y = height - (entry.y_percent / 100) * height - (entry.height_percent / 100) * height

      if (entry.field_type === 'checkbox') {
        if (entry.value === true) {
          // Draw a checkmark
          page.drawText('✓', { x: x + 2, y: y + 2, size: 12, font: boldFont, color: rgb(0.09, 0.64, 0.27) })
        }
      } else if (entry.field_type === 'signature') {
        // Draw signer name in bold as "signature"
        const textValue = typeof entry.value === 'string' && entry.value ? entry.value : signers[0]?.name || ''
        page.drawText(textValue, { x: x + 4, y: y + 6, size: 14, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
        page.drawText('Certificato da Trustera', { x: x + 4, y: y - 4, size: 6, font, color: rgb(0.09, 0.64, 0.27) })
      } else if (typeof entry.value === 'string' && entry.value) {
        page.drawText(entry.value, { x: x + 2, y: y + 4, size: 9, font, color: rgb(0.15, 0.15, 0.15) })
      }
    }
  }

  // Add footer with signer names + "Certificato da Trustera" on ALL existing pages
  const existingPages = pdfDoc.getPages()
  const signerNamesList = signers.map(s => s.name).join(', ')
  for (const existingPage of existingPages) {
    const { width } = existingPage.getSize()
    existingPage.drawText(`Firmato da: ${signerNamesList}`, {
      x: 50, y: 20, size: 7, font, color: rgb(0.4, 0.4, 0.4)
    })
    existingPage.drawText('Certificato da Trustera', {
      x: width - 150, y: 20, size: 7, font, color: rgb(0.09, 0.64, 0.27)
    })
  }

  // Add small QR code to the bottom-right corner of the last page
  const verifyUrl = `https://trustera360.app/verify/${originalHash}`
  const qrPng = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 120, margin: 0 })
  const qrImage = await pdfDoc.embedPng(qrPng)

  const lastPage = pdfDoc.getPage(pdfDoc.getPageCount() - 1)
  const { width: lastW } = lastPage.getSize()
  const qrSize = 50
  const margin = 20
  lastPage.drawImage(qrImage, {
    x: lastW - qrSize - margin,
    y: margin,
    width: qrSize,
    height: qrSize,
  })
  const verifyLabel = 'Verificato da Trustera'
  const labelWidth = font.widthOfTextAtSize(verifyLabel, 6)
  lastPage.drawText(verifyLabel, {
    x: lastW - qrSize - margin + (qrSize - labelWidth) / 2,
    y: margin - 8,
    size: 6,
    font,
    color: rgb(0.4, 0.4, 0.4),
  })

  return pdfDoc.save()
}

async function saveMarketingConsent(
  email: string,
  name: string,
  marketingConsent: boolean,
  source: string
): Promise<void> {
  // Upsert trustera_leads — never overwrite true with false
  const { data: existingLead } = await supabase
    .from('trustera_leads')
    .select('id, marketing_consent')
    .eq('email', email)
    .maybeSingle()

  const leadPayload: Record<string, any> = {
    email,
    name,
    last_seen_at: new Date().toISOString(),
    source
  }

  if (!existingLead || existingLead.marketing_consent !== true) {
    leadPayload.marketing_consent = marketingConsent
  }

  const { error: leadError } = await supabase
    .from('trustera_leads')
    .upsert(leadPayload, { onConflict: 'email' })

  if (leadError) {
    console.warn('[trustera-sign-complete] Lead upsert failed:', leadError.message)
  }

  // Upsert marketing_consents table
  const { error: consentError } = await supabase
    .from('marketing_consents')
    .upsert(
      {
        email,
        name,
        consent: marketingConsent,
        source,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'email' }
    )

  if (consentError) {
    console.warn('[trustera-sign-complete] marketing_consents upsert failed:', consentError.message)
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { token, marketingConsent, fieldValues } = JSON.parse(event.body || '{}')
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Token richiesto' }) }
    }

    const ip = event.headers['x-forwarded-for']?.split(',')[0].trim() || event.headers['client-ip'] || 'unknown'
    const userAgent = event.headers['user-agent'] || 'unknown'
    const signedAt = new Date().toISOString()

    // ===== NEW MULTI-SIGNER FLOW =====

    const { data: signerRow, error: signerLookupError } = await supabase
      .from('trustera_document_signers')
      .select('*')
      .eq('signing_token', token)
      .maybeSingle()

    if (signerLookupError) {
      console.error('[trustera-sign-complete] Signer lookup error:', signerLookupError.message)
    }

    if (signerRow) {
      // Verify OTP was completed (skip if OTP not required)
      if (signerRow.require_otp !== false && !signerRow.otp_verified) {
        return { statusCode: 400, body: JSON.stringify({ error: 'OTP non verificato' }) }
      }

      // Already signed — return early (idempotent)
      if (signerRow.status === 'signed') {
        // Fetch the document to get signed_pdf_url
        const { data: existingDoc } = await supabase
          .from('trustera_documents')
          .select('signed_pdf_url, signed_at')
          .eq('id', signerRow.document_id)
          .single()

        return {
          statusCode: 200,
          body: JSON.stringify({
            signedPdfUrl: existingDoc?.signed_pdf_url || null,
            signedAt: signerRow.signed_at,
            allDone: true
          })
        }
      }

      // Fetch full document info
      const { data: doc, error: docError } = await supabase
        .from('trustera_documents')
        .select('*')
        .eq('id', signerRow.document_id)
        .single()

      if (docError || !doc) {
        console.error('[trustera-sign-complete] Document not found for signer:', signerRow.document_id, docError?.message)
        return { statusCode: 404, body: JSON.stringify({ error: 'Documento non trovato' }) }
      }

      // Update signer record: status=signed, timestamps, ip, consent
      const { error: signerUpdateError } = await supabase
        .from('trustera_document_signers')
        .update({
          status: 'signed',
          signed_at: signedAt,
          signing_ip: ip,
          signing_user_agent: userAgent,
          marketing_consent: marketingConsent ?? false,
          otp_verified: false
        })
        .eq('id', signerRow.id)

      if (signerUpdateError) {
        console.error('[trustera-sign-complete] Signer update failed:', signerUpdateError.message)
        throw signerUpdateError
      }

      // Save marketing consent to leads + marketing_consents tables
      await saveMarketingConsent(signerRow.signer_email, signerRow.signer_name, marketingConsent ?? false, 'signing_complete')

      // Save field values for this signer
      if (fieldValues && typeof fieldValues === 'object') {
        for (const [fieldId, value] of Object.entries(fieldValues)) {
          await supabase
            .from('trustera_document_fields')
            .update({ value: String(value), filled_at: new Date().toISOString() })
            .eq('id', fieldId)
            .eq('signer_id', signerRow.id)
        }
      }

      // Check if ALL signers for this document have now signed
      const { data: allSigners, error: allSignersError } = await supabase
        .from('trustera_document_signers')
        .select('id, signer_name, signer_email, signer_phone, notification_channel, status, signed_at, signing_ip, signing_user_agent')
        .eq('document_id', doc.id)

      if (allSignersError) {
        console.error('[trustera-sign-complete] Failed to fetch all signers:', allSignersError.message)
        throw allSignersError
      }

      const allSigned = allSigners.every((s: any) => s.status === 'signed')

      if (!allSigned) {
        console.log('[trustera-sign-complete] Not all signers done yet for doc:', doc.id)
        return {
          statusCode: 200,
          body: JSON.stringify({ allDone: false })
        }
      }

      // All signers have signed — generate the final signed PDF

      // Fetch original PDF bytes
      const pdfResponse = await fetch(doc.pdf_url)
      if (!pdfResponse.ok) {
        throw new Error(`Failed to fetch original PDF: ${pdfResponse.status} ${pdfResponse.statusText}`)
      }
      const pdfBytes = await pdfResponse.arrayBuffer()

      // Calculate SHA-256 hash of original
      const originalHash = crypto.createHash('sha256').update(Buffer.from(pdfBytes)).digest('hex')

      // Build attestation data for each signer (in signing order)
      const attestationSigners: AttestationSigner[] = allSigners.map((s: any) => ({
        name: s.signer_name,
        email: s.signer_email,
        signed_at: s.signed_at,
        signing_ip: s.signing_ip || 'unknown',
        signing_user_agent: s.signing_user_agent || 'unknown'
      }))

      // Fetch all field definitions + values for this document
      let fieldEntries: FieldValueEntry[] = []
      const { data: docFields } = await supabase
        .from('trustera_document_fields')
        .select('*')
        .eq('document_id', doc.id)

      if (docFields && docFields.length > 0) {
        // Save current signer's field values to DB
        if (fieldValues && typeof fieldValues === 'object') {
          for (const [fieldId, value] of Object.entries(fieldValues)) {
            await supabase
              .from('trustera_document_fields')
              .update({ value: String(value), filled_at: new Date().toISOString() })
              .eq('id', fieldId)
          }
        }

        // Re-fetch with updated values
        const { data: updatedFields } = await supabase
          .from('trustera_document_fields')
          .select('*')
          .eq('document_id', doc.id)

        fieldEntries = (updatedFields || [])
          .filter((f: any) => f.value !== null && f.value !== undefined)
          .map((f: any) => ({
            field_type: f.field_type,
            page_number: f.page_number,
            x_percent: f.x_percent,
            y_percent: f.y_percent,
            width_percent: f.width_percent,
            height_percent: f.height_percent,
            label: f.label,
            value: f.field_type === 'checkbox' ? f.value === 'true' : f.value,
          }))
      }

      // Build signed PDF with field values + one attestation page per signer
      const signedPdfBytes = await buildSignedPdf(pdfBytes, attestationSigners, doc.name, originalHash, fieldEntries)

      // Upload signed PDF to storage
      const fileName = `signed/${doc.id}_signed_${Date.now()}.pdf`
      const { error: uploadError } = await supabase.storage
        .from('trustera')
        .upload(fileName, Buffer.from(signedPdfBytes), { contentType: 'application/pdf' })

      if (uploadError) {
        console.error('[trustera-sign-complete] Upload failed:', uploadError.message)
        throw uploadError
      }

      const { data: { publicUrl } } = supabase.storage.from('trustera').getPublicUrl(fileName)

      // Update document: status=signed, signed_pdf_url, signed_at, hash
      const { error: docUpdateError } = await supabase
        .from('trustera_documents')
        .update({
          status: 'signed',
          signed_at: signedAt,
          signed_pdf_url: publicUrl,
          pdf_hash: originalHash
        })
        .eq('id', doc.id)

      if (docUpdateError) {
        console.error('[trustera-sign-complete] Document update failed:', docUpdateError.message)
        throw docUpdateError
      }

      // Log to signed_documents_log
      try {
        await supabase.from('signed_documents_log').insert({
          source: 'trustera',
          document_name: doc.name,
          signer_name: allSigners.map((s: any) => s.signer_name).join(', '),
          signer_email: allSigners.map((s: any) => s.signer_email).join(', '),
          signed_pdf_url: publicUrl,
          signed_at: signedAt,
          original_pdf_hash: originalHash,
          signer_ip: ip,
          metadata: {
            trustera_document_id: doc.id,
            signers: allSigners.map((s: any) => ({
              name: s.signer_name,
              email: s.signer_email,
              signed_at: s.signed_at,
              ip: s.signing_ip
            }))
          }
        })
      } catch (logErr: any) {
        console.warn('[trustera-sign-complete] signed_documents_log insert failed:', logErr.message)
      }

      const signedPdfBuffer = Buffer.from(signedPdfBytes)

      // Send signed PDF to sender (document owner) via email with attachment
      if (doc.owner_id) {
        const { data: { user: ownerUser } } = await supabase.auth.admin.getUserById(doc.owner_id)
        if (ownerUser?.email) {
          const signerNamesList = allSigners.map((s: any) => s.signer_name).join(', ')
          await sendSignedPdfEmail(ownerUser.email, doc.name, signerNamesList, signedPdfBuffer, true)
        }
      }

      // Send signed PDF to each signer via the channel chosen by the sender
      for (const s of allSigners) {
        const channel = (s as any).notification_channel || 'email'
        if (channel === 'whatsapp' && s.signer_phone) {
          await sendWhatsAppPdf(s.signer_phone, publicUrl, doc.name, s.signer_name)
        } else {
          await sendSignedPdfEmail(s.signer_email, doc.name, s.signer_name, signedPdfBuffer, false)
        }
      }

      // Send signed PDF to approvers if any
      if (Array.isArray(doc.approvers) && doc.approvers.length > 0) {
        const signerNamesList = allSigners.map((s: any) => s.signer_name).join(', ')
        for (const approver of doc.approvers) {
          if (!approver.email) continue
          try {
            const approverSubject = `Documento firmato: ${doc.name}`
            const approverBodyText = `Ciao ${approver.name},\n\nIl documento "${doc.name}" che hai approvato è stato firmato da tutti i firmatari (${signerNamesList}).\n\nIl PDF firmato è in allegato.\n\nTrustera - Infrastructure for Digital Trust\nhttps://trustera360.app`
            await resend.emails.send({
              from: 'Trustera <info@trustera360.app>',
              replyTo: 'info@trustera360.app',
              to: approver.email,
              subject: approverSubject,
              text: approverBodyText,
              html: `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f9fafb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:32px 40px 0;text-align:center;">
    <img src="https://trustera360.app/trustera-logo.jpeg" alt="Trustera" style="height:80px;width:auto;max-width:200px;" />
  </td></tr>
  <tr><td style="padding:24px 40px 0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;color:#333;line-height:1.6;">
    <p style="margin:0 0 12px;">Ciao <strong>${approver.name}</strong>,</p>
    <p style="margin:0 0 12px;">Il documento <strong>${doc.name}</strong> che hai approvato è stato firmato da tutti i firmatari.</p>
    <p style="margin:0 0 12px;">Firmatari: <strong>${signerNamesList}</strong></p>
    <p style="margin:0;">Il PDF firmato è in allegato a questa email.</p>
  </td></tr>
  <tr><td style="padding:28px 40px;text-align:center;">
    <div style="display:inline-block;background-color:#f0fdf4;color:#16a34a;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;border:1px solid #bbf7d0;">
      PDF allegato
    </div>
  </td></tr>
  <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" /></td></tr>
  <tr><td style="padding:24px 40px 32px;text-align:center;">
    <p style="margin:0;color:#d1d5db;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:11px;">
      Trustera - Infrastructure for Digital Trust<br/>
      <a href="https://trustera360.app" style="color:#16a34a;text-decoration:none;">www.trustera360.app</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
              attachments: [{
                filename: `${doc.name.replace(/[^a-zA-Z0-9._-]/g, '_')}_firmato.pdf`,
                content: signedPdfBuffer,
              }]
            })
            console.log('[trustera-sign-complete] Approver signed PDF email sent to:', approver.email)
          } catch (approverEmailErr: any) {
            console.warn('[trustera-sign-complete] Approver email failed for', approver.email, ':', approverEmailErr.message)
          }
        }
      }

      console.log('[trustera-sign-complete] All signers done for doc:', doc.id, '— signed PDF uploaded:', fileName)

      return {
        statusCode: 200,
        body: JSON.stringify({
          signedPdfUrl: publicUrl,
          signedAt,
          allDone: true
        })
      }
    }

    // ===== OLD SINGLE-SIGNER FALLBACK (trustera_documents) =====

    const { data: doc, error: docError } = await supabase
      .from('trustera_documents')
      .select('*')
      .eq('signing_token', token)
      .maybeSingle()

    if (docError) {
      console.error('[trustera-sign-complete] Legacy doc lookup error:', docError.message)
    }

    if (!doc) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Documento non trovato' }) }
    }

    if (doc.require_otp !== false && !doc.otp_verified) {
      return { statusCode: 400, body: JSON.stringify({ error: 'OTP non verificato' }) }
    }

    // Already signed — idempotent return
    if (doc.status === 'signed') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          signedPdfUrl: doc.signed_pdf_url,
          signedAt: doc.signed_at,
          allDone: true
        })
      }
    }

    // Fetch original PDF bytes
    const pdfResponse = await fetch(doc.pdf_url)
    if (!pdfResponse.ok) {
      throw new Error(`Failed to fetch original PDF: ${pdfResponse.status} ${pdfResponse.statusText}`)
    }
    const pdfBytes = await pdfResponse.arrayBuffer()

    // Calculate SHA-256 hash of original
    const originalHash = crypto.createHash('sha256').update(Buffer.from(pdfBytes)).digest('hex')

    // Build single-signer attestation page
    const signedPdfBytes = await buildSignedPdf(
      pdfBytes,
      [{
        name: doc.signer_name,
        email: doc.signer_email,
        signed_at: signedAt,
        signing_ip: ip,
        signing_user_agent: userAgent
      }],
      doc.name,
      originalHash
    )

    // Upload signed PDF
    const fileName = `signed/${doc.id}_signed_${Date.now()}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('trustera')
      .upload(fileName, Buffer.from(signedPdfBytes), { contentType: 'application/pdf' })

    if (uploadError) {
      console.error('[trustera-sign-complete] Upload failed (legacy):', uploadError.message)
      throw uploadError
    }

    const { data: { publicUrl } } = supabase.storage.from('trustera').getPublicUrl(fileName)

    // Update document record
    const { error: docUpdateError } = await supabase
      .from('trustera_documents')
      .update({
        status: 'signed',
        signed_at: signedAt,
        signed_pdf_url: publicUrl,
        signing_ip: ip,
        signing_user_agent: userAgent,
        pdf_hash: originalHash,
        otp_verified: false,
        signing_token: null
      })
      .eq('id', doc.id)

    if (docUpdateError) {
      console.error('[trustera-sign-complete] Doc update failed (legacy):', docUpdateError.message)
      throw docUpdateError
    }

    // Log to signed_documents_log
    try {
      await supabase.from('signed_documents_log').insert({
        source: 'trustera',
        document_name: doc.name,
        signer_name: doc.signer_name,
        signer_email: doc.signer_email,
        signed_pdf_url: publicUrl,
        signed_at: signedAt,
        original_pdf_hash: originalHash,
        signer_ip: ip,
        metadata: { trustera_document_id: doc.id }
      })
    } catch (logErr: any) {
      console.warn('[trustera-sign-complete] signed_documents_log insert failed (legacy):', logErr.message)
    }

    // Save marketing consent
    await saveMarketingConsent(doc.signer_email, doc.signer_name, marketingConsent ?? false, 'signing_complete_legacy')

    const signedPdfBuffer = Buffer.from(signedPdfBytes)

    // Send signed PDF to sender (document owner) via email with attachment
    if (doc.owner_id) {
      const { data: { user: ownerUser } } = await supabase.auth.admin.getUserById(doc.owner_id)
      if (ownerUser?.email) {
        await sendSignedPdfEmail(ownerUser.email, doc.name, doc.signer_name, signedPdfBuffer, true)
      }
    }

    // Send signed PDF to signer via the channel chosen by the sender
    const channel = doc.notification_channel || 'email'
    if (channel === 'whatsapp' && doc.signer_phone) {
      await sendWhatsAppPdf(doc.signer_phone, publicUrl, doc.name, doc.signer_name)
    } else {
      await sendSignedPdfEmail(doc.signer_email, doc.name, doc.signer_name, signedPdfBuffer, false)
    }

    console.log('[trustera-sign-complete] Legacy signing complete for doc:', doc.id)

    return {
      statusCode: 200,
      body: JSON.stringify({
        signedPdfUrl: publicUrl,
        signedAt,
        allDone: true
      })
    }
  } catch (error: any) {
    console.error('[trustera-sign-complete] Unexpected error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Errore durante la firma' })
    }
  }
}
