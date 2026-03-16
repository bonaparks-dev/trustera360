import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import crypto from 'crypto'

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

async function buildSignedPdf(
  originalPdfBytes: ArrayBuffer,
  signers: AttestationSigner[],
  documentName: string,
  originalHash: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

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

  // Add one attestation page per signer
  for (const signer of signers) {
    const page = pdfDoc.addPage([595, 842]) // A4
    const { height } = page.getSize()
    let y = height - 60

    // Title
    page.drawText('ATTESTAZIONE DI FIRMA ELETTRONICA', {
      x: 50, y, size: 16, font: boldFont, color: rgb(0.05, 0.24, 0.16)
    })
    y -= 30

    page.drawText('Certificato da Trustera', {
      x: 50, y, size: 11, font, color: rgb(0.4, 0.4, 0.4)
    })
    y -= 40

    const signedAtFormatted = new Date(signer.signed_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })

    const lines = [
      { label: 'Documento:', value: documentName },
      { label: 'Firmatario:', value: signer.name },
      { label: 'Email:', value: signer.email },
      { label: 'Data e Ora:', value: signedAtFormatted },
      { label: 'Metodo:', value: 'OTP (One-Time Password)' },
      { label: 'Indirizzo IP:', value: signer.signing_ip },
      { label: 'User Agent:', value: signer.signing_user_agent.substring(0, 80) },
      { label: 'Hash SHA-256:', value: originalHash }
    ]

    for (const line of lines) {
      page.drawText(line.label, { x: 50, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) })
      // Long values may overflow — split at 80 chars
      const value = line.value || 'N/A'
      if (value.length > 60) {
        page.drawText(value.substring(0, 60), { x: 180, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) })
        y -= 16
        page.drawText(value.substring(60, 120), { x: 180, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) })
      } else {
        page.drawText(value, { x: 180, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) })
      }
      y -= 22
    }

    y -= 20
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) })
    y -= 25

    page.drawText('Questo documento è stato firmato elettronicamente tramite la piattaforma Trustera.', {
      x: 50, y, size: 9, font, color: rgb(0.5, 0.5, 0.5)
    })
    y -= 16
    page.drawText('La firma è conforme al Regolamento eIDAS (UE) 910/2014 per firme elettroniche semplici.', {
      x: 50, y, size: 9, font, color: rgb(0.5, 0.5, 0.5)
    })
    y -= 16
    page.drawText('Il documento originale non è stato alterato dopo la firma.', {
      x: 50, y, size: 9, font, color: rgb(0.5, 0.5, 0.5)
    })

    // Footer
    page.drawText('www.trustera360.app', {
      x: 50, y: 40, size: 8, font, color: rgb(0.09, 0.64, 0.27)
    })
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
    const { token, marketingConsent } = JSON.parse(event.body || '{}')
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
      // Verify OTP was completed
      if (!signerRow.otp_verified) {
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

      // Check if ALL signers for this document have now signed
      const { data: allSigners, error: allSignersError } = await supabase
        .from('trustera_document_signers')
        .select('id, signer_name, signer_email, signer_phone, status, signed_at, signing_ip, signing_user_agent')
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

      // Build signed PDF with one attestation page per signer
      const signedPdfBytes = await buildSignedPdf(pdfBytes, attestationSigners, doc.name, originalHash)

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

      // Send signed PDF via WhatsApp to all signers who have phones
      for (const s of allSigners) {
        if (s.signer_phone) {
          await sendWhatsAppPdf(s.signer_phone, publicUrl, doc.name, s.signer_name)
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

    if (!doc.otp_verified) {
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

    // Send signed PDF via WhatsApp if phone available
    let signerPhone = doc.signer_phone || ''
    if (!signerPhone && doc.signer_email) {
      const { data: customer } = await supabaseDR7
        .from('customers_extended')
        .select('telefono')
        .eq('email', doc.signer_email)
        .maybeSingle()
      if (customer?.telefono) signerPhone = customer.telefono
    }

    if (signerPhone) {
      await sendWhatsAppPdf(signerPhone, publicUrl, doc.name, doc.signer_name)
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
