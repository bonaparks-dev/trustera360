import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://zkcvsewfqnukdkvcairk.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { hash } = JSON.parse(event.body || '{}')
    if (!hash) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Hash richiesto' }) }
    }

    // Look up document by pdf_hash
    const { data: doc, error: docError } = await supabase
      .from('trustera_documents')
      .select('id, name, signed_at, pdf_hash, status')
      .eq('pdf_hash', hash)
      .eq('status', 'signed')
      .maybeSingle()

    if (docError) {
      console.error('[trustera-verify] Lookup error:', docError.message)
    }

    if (!doc) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Documento non trovato o non ancora firmato' }) }
    }

    // Fetch signers
    const { data: signers } = await supabase
      .from('trustera_document_signers')
      .select('signer_name, signer_email, signed_at, signing_ip')
      .eq('document_id', doc.id)
      .eq('status', 'signed')
      .order('signed_at', { ascending: true })

    const signerList = (signers || []).map((s: any) => ({
      name: s.signer_name,
      email: s.signer_email || '',
      signed_at: s.signed_at,
      signing_ip: s.signing_ip || 'N/A'
    }))

    // If no signers found in trustera_document_signers, check signed_documents_log
    if (signerList.length === 0) {
      const { data: logEntry } = await supabase
        .from('signed_documents_log')
        .select('signer_name, signer_email, signed_at, signer_ip, metadata')
        .eq('original_pdf_hash', hash)
        .maybeSingle()

      if (logEntry) {
        if (logEntry.metadata?.signers) {
          for (const s of logEntry.metadata.signers) {
            signerList.push({
              name: s.name,
              email: s.email || '',
              signed_at: s.signed_at,
              signing_ip: s.ip || 'N/A'
            })
          }
        } else {
          signerList.push({
            name: logEntry.signer_name,
            email: logEntry.signer_email || '',
            signed_at: logEntry.signed_at,
            signing_ip: logEntry.signer_ip || 'N/A'
          })
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        documentName: doc.name,
        signedAt: doc.signed_at,
        originalHash: doc.pdf_hash,
        signers: signerList
      })
    }
  } catch (error: any) {
    console.error('[trustera-verify] Error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Errore interno' })
    }
  }
}
