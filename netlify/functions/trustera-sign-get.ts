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

    // Check expiration
    if (doc.signing_token_expires_at && new Date(doc.signing_token_expires_at) < new Date()) {
      return { statusCode: 410, body: JSON.stringify({ error: 'Link scaduto' }) }
    }

    // Generate signed URL for the PDF (public URLs don't work if bucket isn't public)
    let pdfUrl = doc.pdf_url
    const trusteraMatch = doc.pdf_url?.match(/\/storage\/v1\/object\/(?:public|sign)\/trustera\/(.+)/)
    if (trusteraMatch) {
      const { data: signedData } = await supabase.storage.from('trustera').createSignedUrl(trusteraMatch[1], 3600)
      if (signedData?.signedUrl) pdfUrl = signedData.signedUrl
    }

    let signedPdfUrl = doc.signed_pdf_url
    if (doc.signed_pdf_url) {
      const signedMatch = doc.signed_pdf_url.match(/\/storage\/v1\/object\/(?:public|sign)\/trustera\/(.+)/)
      if (signedMatch) {
        const { data: signedData } = await supabase.storage.from('trustera').createSignedUrl(signedMatch[1], 3600)
        if (signedData?.signedUrl) signedPdfUrl = signedData.signedUrl
      }
    }

    const response: any = {
      signerName: doc.signer_name,
      documentName: doc.name,
      pdfUrl,
      status: doc.status
    }

    if (doc.status === 'signed') {
      response.signedPdfUrl = signedPdfUrl
      response.signedAt = doc.signed_at
    }

    return {
      statusCode: 200,
      body: JSON.stringify(response)
    }
  } catch (error: any) {
    console.error('Error getting document:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Errore interno' })
    }
  }
}
