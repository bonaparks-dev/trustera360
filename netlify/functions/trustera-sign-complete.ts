import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    if (!doc.otp_verified) {
      return { statusCode: 400, body: JSON.stringify({ error: 'OTP non verificato' }) }
    }

    if (doc.status === 'signed') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          signedPdfUrl: doc.signed_pdf_url,
          signedAt: doc.signed_at
        })
      }
    }

    const signedAt = new Date().toISOString()
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown'
    const userAgent = event.headers['user-agent'] || 'unknown'

    // Fetch original PDF
    const pdfResponse = await fetch(doc.pdf_url)
    const pdfBytes = await pdfResponse.arrayBuffer()

    // Calculate hash of original
    const originalHash = crypto.createHash('sha256').update(Buffer.from(pdfBytes)).digest('hex')

    // Add attestation page
    const pdfDoc = await PDFDocument.load(pdfBytes)
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

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

    const lines = [
      { label: 'Documento:', value: doc.name },
      { label: 'Firmatario:', value: doc.signer_name },
      { label: 'Email:', value: doc.signer_email },
      { label: 'Data e Ora:', value: new Date(signedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) },
      { label: 'Metodo:', value: 'OTP (One-Time Password)' },
      { label: 'Indirizzo IP:', value: ip },
      { label: 'User Agent:', value: userAgent.substring(0, 80) },
      { label: 'Hash SHA-256:', value: originalHash },
    ]

    for (const line of lines) {
      page.drawText(line.label, { x: 50, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) })
      page.drawText(line.value, { x: 180, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) })
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

    const signedPdfBytes = await pdfDoc.save()

    // Upload signed PDF
    const fileName = `signed/${doc.id}_signed_${Date.now()}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('trustera')
      .upload(fileName, Buffer.from(signedPdfBytes), { contentType: 'application/pdf' })

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabase.storage.from('trustera').getPublicUrl(fileName)

    // Update document
    await supabase
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

    // Send signed PDF via WhatsApp if phone available
    if (doc.signer_phone) {
      try {
        const idInstance = process.env.GREEN_API_INSTANCE_ID
        const apiToken = process.env.GREEN_API_TOKEN
        if (idInstance && apiToken) {
          const phone = doc.signer_phone.replace(/[\s\-\(\)]/g, '')
          const chatId = (phone.startsWith('+') ? phone.slice(1) : phone) + '@c.us'
          await fetch(`https://api.green-api.com/waInstance${idInstance}/sendFileByUrl/${apiToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId,
              urlFile: publicUrl,
              fileName: `${doc.name}_firmato.pdf`,
              caption: `Documento firmato: ${doc.name}\nFirmato da: ${doc.signer_name}\n\nTrustera - Infrastructure for Digital Trust`
            })
          })
        }
      } catch (e) {
        console.warn('WhatsApp PDF send failed:', e)
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        signedPdfUrl: publicUrl,
        signedAt
      })
    }
  } catch (error: any) {
    console.error('Error completing signing:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Errore durante la firma' })
    }
  }
}
