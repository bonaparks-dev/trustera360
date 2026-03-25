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

async function logAudit(documentId: string, action: string, email?: string, ip?: string, userAgent?: string, metadata?: Record<string, any>) {
  try {
    await supabase.from('signature_audit_trail').insert({
      document_id: documentId,
      action,
      signer_email: email || null,
      ip_address: ip || null,
      user_agent: userAgent || null,
      metadata: metadata || null,
    })
  } catch (e) { /* non-blocking */ }
}

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

async function sendWhatsAppPdf(phone: string, publicUrl: string, documentName: string, signerName: string, source?: string): Promise<void> {
  // Use DR7's Green API for DR7-sourced documents (same number that sent the signing link)
  // Use Trustera's Green API for everything else
  let idInstance: string | undefined
  let apiToken: string | undefined

  if (source && source.startsWith('dr7') && process.env.DR7_GREEN_API_INSTANCE_ID && process.env.DR7_GREEN_API_TOKEN) {
    idInstance = process.env.DR7_GREEN_API_INSTANCE_ID
    apiToken = process.env.DR7_GREEN_API_TOKEN
    console.log('[trustera-sign-complete] Using DR7 Green API for WhatsApp (same conversation)')
  } else {
    idInstance = process.env.GREEN_API_INSTANCE_ID
    apiToken = process.env.GREEN_API_TOKEN
  }

  if (!idInstance || !apiToken) {
    console.warn('[trustera-sign-complete] GREEN_API credentials missing, cannot send WhatsApp PDF')
    return
  }

  const chatId = cleanPhoneForChatId(phone) + '@c.us'
  console.log('[trustera-sign-complete] Sending WhatsApp PDF to chatId:', chatId, 'url:', publicUrl)
  try {
    const res = await fetch(`https://api.green-api.com/waInstance${idInstance}/sendFileByUrl/${apiToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        urlFile: publicUrl,
        fileName: `${documentName.replace(/[^a-zA-Z0-9._-]/g, '_')}_firmato.pdf`,
        caption: `Documento firmato: ${documentName}\nFirmato da: ${signerName}\n\nTrustera - Infrastructure for Digital Trust`
      })
    })
    const data = await res.json()
    if (res.ok && data.idMessage) {
      console.log('[trustera-sign-complete] WhatsApp PDF sent successfully:', data.idMessage)
    } else {
      console.warn('[trustera-sign-complete] WhatsApp PDF response not OK:', JSON.stringify(data))
    }
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
  fieldEntries?: FieldValueEntry[],
  source?: string
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

      const fieldW = (entry.width_percent / 100) * width
      const fieldH = (entry.height_percent / 100) * height

      if (entry.field_type === 'checkbox') {
        if (entry.value === true) {
          page.drawText('✓', { x: x + 2, y: y + 2, size: 12, font: boldFont, color: rgb(0.09, 0.64, 0.27) })
        }
      } else if (entry.field_type === 'signature' || entry.field_type === 'initials') {
        const textValue = typeof entry.value === 'string' && entry.value ? entry.value : signers[0]?.name || ''
        if (entry.field_type === 'initials') {
          page.drawRectangle({ x, y, width: fieldW, height: fieldH, borderColor: rgb(0.09, 0.55, 0.27), borderWidth: 0.75, color: rgb(1, 1, 1) })
          page.drawText(textValue, { x: x + 4, y: y + fieldH / 2 - 4, size: 11, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
        }
        // Signature fields: the Verified Seal will be drawn on last page (below)
      } else if (typeof entry.value === 'string' && entry.value) {
        page.drawText(entry.value, { x: x + 2, y: y + fieldH / 2 - 3, size: 9, font, color: rgb(0.15, 0.15, 0.15) })
      }
    }
  }

  // ── Trustera Verified Seal on last page ──────────────────────────────────
  const verifyUrl = `https://trustera360.app/verify/${originalHash}`
  const qrPng = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 300, margin: 1 })
  const qrImage = await pdfDoc.embedPng(qrPng)

  // Embed Trustera logo (PNG with transparency) + icon
  let logoImage: any = null
  let iconImage: any = null
  try {
    const [logoPngResp, logoJpgResp, iconResp] = await Promise.all([
      fetch('https://trustera360.app/trustera-logo.png'),
      fetch('https://trustera360.app/trustera-logo.jpeg'),
      fetch('https://trustera360.app/trustera-icon.jpeg'),
    ])
    if (logoPngResp.ok) {
      logoImage = await pdfDoc.embedPng(new Uint8Array(await logoPngResp.arrayBuffer()))
    } else if (logoJpgResp.ok) {
      logoImage = await pdfDoc.embedJpg(new Uint8Array(await logoJpgResp.arrayBuffer()))
    }
    if (iconResp.ok) {
      iconImage = await pdfDoc.embedJpg(new Uint8Array(await iconResp.arrayBuffer()))
    }
  } catch (e) {
    console.warn('[buildSignedPdf] Could not embed logo/icon:', e)
  }

  const lastPage = pdfDoc.getPage(pdfDoc.getPageCount() - 1)
  const { width: lastW } = lastPage.getSize()

  // Generate certificate ID
  const year = new Date().getFullYear()
  const certId = `TR-${year}-${originalHash.slice(0, 8).toUpperCase()}`

  // Seal dimensions — compact to fit inside contract signature boxes
  const sealW = 130
  const sealH = 42

  const green = rgb(0.09, 0.55, 0.27)
  const darkGreen = rgb(0.06, 0.35, 0.18)
  const gray = rgb(0.35, 0.35, 0.35)
  const lightGray = rgb(0.75, 0.75, 0.75)

  // FIRMA LOCATORE seal for DR7 contracts (same format as guidatore)
  if (source && source.startsWith('dr7')) {
    try {
      const locSealX = 40
      const locSealY = 160

      lastPage.drawRectangle({
        x: locSealX, y: locSealY, width: sealW, height: sealH,
        borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.75, color: rgb(1, 1, 1),
      })
      const locHeaderY = locSealY + sealH - 12
      if (logoImage) {
        const hLogoH = 9
        const hLogoW = (logoImage.width / logoImage.height) * hLogoH
        lastPage.drawImage(logoImage, { x: locSealX + 4, y: locHeaderY - 1, width: hLogoW, height: hLogoH })
        lastPage.drawText('Verified Seal', { x: locSealX + 4 + hLogoW + 2, y: locHeaderY + 1, size: 4.5, font, color: lightGray })
      } else {
        lastPage.drawText('Trustera  Verified Seal', { x: locSealX + 4, y: locHeaderY + 1, size: 4.5, font: boldFont, color: gray })
      }
      const locInfoX = locSealX + 4
      const locInfoY = locHeaderY - 9
      lastPage.drawText('Ilenia Campagnola', { x: locInfoX, y: locInfoY, size: 5.5, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
      const now = new Date()
      const dd = String(now.getDate()).padStart(2, '0')
      const mo = String(now.getMonth() + 1).padStart(2, '0')
      const yy = now.getFullYear()
      const hh = String(now.getHours()).padStart(2, '0')
      const mi = String(now.getMinutes()).padStart(2, '0')
      lastPage.drawText(`${dd}/${mo}/${yy} — ${hh}:${mi} CET`, { x: locInfoX, y: locInfoY - 7, size: 4, font, color: gray })
      lastPage.drawText(`ID: ${certId}`, { x: locInfoX, y: locInfoY - 13, size: 3.5, font, color: lightGray })
      lastPage.drawImage(qrImage, { x: locSealX + sealW - 13 - 4, y: locInfoY - 3, width: 13, height: 13 })
      lastPage.drawText('Verifica ', { x: locSealX + 4, y: locSealY + 2, size: 3, font, color: lightGray })
      lastPage.drawText('AuditTrail', { x: locSealX + 4 + font.widthOfTextAtSize('Verifica ', 3), y: locSealY + 2, size: 3, font: boldFont, color: darkGreen })
      if (logoImage) {
        const lH = 6
        const lW = (logoImage.width / logoImage.height) * lH
        lastPage.drawImage(logoImage, { x: locSealX + sealW - lW - 4, y: locSealY + 1, width: lW, height: lH })
      }
    } catch (e) {
      console.warn('[buildSignedPdf] Failed to draw FIRMA LOCATORE seal:', e)
    }
  }

  // Guidatore / Garante seal positions
  // From screenshot: LOCATORE (~30-248), 1° guid (~248-438), 2° guid (~438-567)
  // Three-column row y≈105-235, garante row y≈30-105
  function getSealPosition(signerIndex: number): { x: number; y: number } {
    if (signerIndex === 0) {
      return { x: 260, y: 160 }   // 1° guidatore column
    } else if (signerIndex === 1) {
      return { x: 437, y: 160 }   // Center of 2° guidatore
    } else {
      return { x: (lastW - sealW) / 2, y: 45 }  // Inside garante row
    }
  }

  for (let si = 0; si < signers.length; si++) {
    const signer = signers[si]
    const { x: sealX, y: sealY } = getSealPosition(si)

    // Outer rectangle (white background, light gray border)
    lastPage.drawRectangle({
      x: sealX, y: sealY, width: sealW, height: sealH,
      borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.75,
      color: rgb(1, 1, 1),
    })

    // ── Header: Trustera logo + "Verified Seal" ──
    const headerY = sealY + sealH - 12
    if (logoImage) {
      const hLogoH = 9
      const hLogoW = (logoImage.width / logoImage.height) * hLogoH
      lastPage.drawImage(logoImage, { x: sealX + 4, y: headerY - 1, width: hLogoW, height: hLogoH })
      const vsX = sealX + 4 + hLogoW + 2
      lastPage.drawText('Verified Seal', { x: vsX, y: headerY + 1, size: 4.5, font, color: lightGray })
    } else {
      lastPage.drawText('Trustera  Verified Seal', { x: sealX + 4, y: headerY + 1, size: 4.5, font: boldFont, color: gray })
    }

    // ── Left side: signer info ──
    const infoX = sealX + 4
    const infoY = headerY - 9

    // Signer name (bold)
    const signerName = signer.name || 'Firmatario'
    lastPage.drawText(signerName, { x: infoX, y: infoY, size: 5.5, font: boldFont, color: rgb(0.1, 0.1, 0.1) })

    // Date + time
    const signDate = new Date(signer.signed_at || new Date().toISOString())
    const dd = String(signDate.getDate()).padStart(2, '0')
    const mo = String(signDate.getMonth() + 1).padStart(2, '0')
    const yy = signDate.getFullYear()
    const hh = String(signDate.getHours()).padStart(2, '0')
    const mi = String(signDate.getMinutes()).padStart(2, '0')
    const dateTimeStr = `${dd}/${mo}/${yy} — ${hh}:${mi} CET`
    lastPage.drawText(dateTimeStr, { x: infoX, y: infoY - 7, size: 4, font, color: gray })

    // Certificate ID
    lastPage.drawText(`ID: ${certId}`, { x: infoX, y: infoY - 13, size: 3.5, font, color: lightGray })

    // ── Right side: QR code ──
    const qrSize = 13
    lastPage.drawImage(qrImage, {
      x: sealX + sealW - qrSize - 4,
      y: infoY - 3,
      width: qrSize, height: qrSize,
    })

    // ── Footer ──
    const footerBarY = sealY
    const footerBarH = 8

    // Footer text left
    lastPage.drawText('Verifica ', { x: sealX + 4, y: footerBarY + 2, size: 3, font, color: lightGray })
    lastPage.drawText('AuditTrail', { x: sealX + 4 + font.widthOfTextAtSize('Verifica ', 3), y: footerBarY + 2, size: 3, font: boldFont, color: darkGreen })

    // Footer Trustera logo right
    if (logoImage) {
      const lH = 6
      const lW = (logoImage.width / logoImage.height) * lH
      lastPage.drawImage(logoImage, {
        x: sealX + sealW - lW - 4,
        y: footerBarY + (footerBarH - lH) / 2,
        width: lW, height: lH,
      })
    }
  }

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
          marketing_consent: marketingConsent ?? false
        })
        .eq('id', signerRow.id)

      if (signerUpdateError) {
        console.error('[trustera-sign-complete] Signer update failed:', signerUpdateError.message)
        throw signerUpdateError
      }

      // Log signature applied
      await logAudit(doc.id, 'signature_applied', signerRow.signer_email, ip, userAgent, { signer_name: signerRow.signer_name, signed_at: signedAt })

      // Save marketing consent to leads + marketing_consents tables
      await saveMarketingConsent(signerRow.signer_email, signerRow.signer_name, marketingConsent ?? false, 'signing_complete')

      // Save field values for this signer
      if (fieldValues && typeof fieldValues === 'object') {
        console.log('[trustera-sign-complete] Saving field values:', JSON.stringify(fieldValues))
        for (const [fieldId, value] of Object.entries(fieldValues)) {
          // Try with signer_id first, fallback to just fieldId
          const { data: updated, error: updateErr } = await supabase
            .from('trustera_document_fields')
            .update({ value: String(value), filled_at: new Date().toISOString() })
            .eq('id', fieldId)
            .select('id')

          if (updateErr) {
            console.warn('[trustera-sign-complete] Field update error for', fieldId, ':', updateErr.message)
          } else {
            console.log('[trustera-sign-complete] Field', fieldId, '=', String(value), 'saved:', updated?.length, 'rows')
          }
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
      const signedPdfBytes = await buildSignedPdf(pdfBytes, attestationSigners, doc.name, originalHash, fieldEntries, doc.source)

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
        try {
          const channel = (s as any).notification_channel || 'email'
          if (channel === 'whatsapp' && s.signer_phone) {
            console.log('[trustera-sign-complete] Sending signed PDF via WhatsApp to:', s.signer_phone)
            await sendWhatsAppPdf(s.signer_phone, publicUrl, doc.name, s.signer_name, doc.source)
            await logAudit(doc.id, 'signed_pdf_sent', s.signer_email, undefined, undefined, { channel: 'whatsapp', signer_name: s.signer_name })
          } else if (s.signer_email) {
            console.log('[trustera-sign-complete] Sending signed PDF via email to:', s.signer_email)
            await sendSignedPdfEmail(s.signer_email, doc.name, s.signer_name, signedPdfBuffer, false)
            await logAudit(doc.id, 'signed_pdf_sent', s.signer_email, undefined, undefined, { channel: 'email', signer_name: s.signer_name })
          } else {
            console.warn('[trustera-sign-complete] Signer has no email or phone, skipping:', s.signer_name)
          }
        } catch (sendErr: any) {
          console.error('[trustera-sign-complete] Failed to send signed PDF to signer:', s.signer_name, sendErr.message)
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

      // Log signing completed
      await logAudit(doc.id, 'signing_completed', undefined, ip, userAgent, {
        signed_at: signedAt,
        original_pdf_hash: originalHash,
        signed_pdf_url: publicUrl,
        signers: allSigners.map((s: any) => ({ name: s.signer_name, email: s.signer_email }))
      })

      // Send a copy of signed PDF to owner via WhatsApp (DR7 contracts only)
      // Uses Trustera's Green API (not DR7's) since DR7's Green API can't send to its own number
      if (doc.source && doc.source.startsWith('dr7')) {
        const ownerWhatsAppNumber = process.env.TRUSTERA_OWNER_WHATSAPP || '393457905205'
        try {
          const signerNamesList = allSigners.map((s: any) => s.signer_name).join(', ')
          // Pass no source so it uses Trustera's Green API for the owner copy
          await sendWhatsAppPdf(ownerWhatsAppNumber, publicUrl, doc.name, signerNamesList)
          console.log('[trustera-sign-complete] Owner WhatsApp copy sent to:', ownerWhatsAppNumber)
        } catch (ownerWaErr: any) {
          console.warn('[trustera-sign-complete] Owner WhatsApp copy failed:', ownerWaErr.message)
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
      originalHash,
      undefined,
      doc.source
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
      await sendWhatsAppPdf(doc.signer_phone, publicUrl, doc.name, doc.signer_name, doc.source)
    } else if (doc.signer_email) {
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
