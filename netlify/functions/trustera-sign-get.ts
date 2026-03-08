import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

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

    // Check expiration
    if (doc.signing_token_expires_at && new Date(doc.signing_token_expires_at) < new Date()) {
      return { statusCode: 410, body: JSON.stringify({ error: 'Link scaduto' }) }
    }

    const response: any = {
      signerName: doc.signer_name,
      documentName: doc.name,
      pdfUrl: doc.pdf_url,
      status: doc.status
    }

    if (doc.status === 'signed') {
      response.signedPdfUrl = doc.signed_pdf_url
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
