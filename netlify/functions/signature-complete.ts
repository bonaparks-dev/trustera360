import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
// DR7 Supabase — primary (signature_requests, contracts, bookings, customers_extended)
const supabase = createClient(
    process.env.DR7_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co',
    process.env.DR7_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Trustera Supabase — secondary (copy signed docs + marketing consent)
const supabaseTrustera = createClient(
    process.env.SUPABASE_URL || 'https://zkcvsewfqnukdkvcairk.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { token, signatureImage, signatureImage2, marketingConsent } = JSON.parse(event.body || '{}')

        if (!token) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Token richiesto' }) }
        }

        const ipAddress = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown'
        const userAgent = event.headers['user-agent'] || 'unknown'

        // Fetch signature request
        const { data: sigRequest, error } = await supabase
            .from('signature_requests')
            .select('*')
            .eq('token', token)
            .single()

        if (error || !sigRequest) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Richiesta di firma non trovata' }) }
        }

        // Validate state
        if (sigRequest.status === 'signed') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Il documento e gia stato firmato' }) }
        }

        if (sigRequest.status !== 'otp_verified') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Verifica OTP richiesta prima della firma' }) }
        }

        if (new Date(sigRequest.token_expires_at) < new Date()) {
            await supabase
                .from('signature_requests')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('id', sigRequest.id)
            return { statusCode: 410, body: JSON.stringify({ error: 'Il link di firma e scaduto' }) }
        }

        // Look up which channel was used for OTP (WhatsApp or email) from audit trail
        let otpChannel: 'whatsapp' | 'email' = 'email'
        const { data: otpAudit } = await supabase
            .from('signature_audit_trail')
            .select('metadata')
            .eq('signature_request_id', sigRequest.id)
            .eq('event_type', 'otp_sent')
            .order('created_at', { ascending: false })
            .limit(1)
        if (otpAudit && otpAudit.length > 0 && otpAudit[0].metadata?.channel) {
            otpChannel = otpAudit[0].metadata.channel
        }

        // Fetch original document — either from contract or standalone document
        let contract: any = null
        let pdfUrl: string | null = null
        let docIdentifier: string = sigRequest.id

        if (sigRequest.contract_id) {
            const { data: contractData } = await supabase
                .from('contracts')
                .select('*')
                .eq('id', sigRequest.contract_id)
                .single()
            contract = contractData
            pdfUrl = contract?.pdf_url
            docIdentifier = contract?.contract_number || sigRequest.contract_id
        } else {
            // Standalone document
            pdfUrl = sigRequest.document_url
            docIdentifier = sigRequest.document_name || 'documento'
        }

        if (!pdfUrl) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Documento PDF non trovato' }) }
        }

        // Download original PDF
        const pdfResponse = await fetch(pdfUrl)
        if (!pdfResponse.ok) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Impossibile scaricare il PDF' }) }
        }
        const originalPdfBytes = new Uint8Array(await pdfResponse.arrayBuffer())

        // Verify PDF integrity (hash must match what was stored at init)
        const currentHash = crypto.createHash('sha256').update(Buffer.from(originalPdfBytes)).digest('hex')
        if (sigRequest.original_pdf_hash && currentHash !== sigRequest.original_pdf_hash) {
            await supabase.from('signature_audit_trail').insert({
                signature_request_id: sigRequest.id,
                event_type: 'integrity_check_failed',
                event_description: 'Hash del PDF non corrisponde. Il documento potrebbe essere stato modificato.',
                ip_address: ipAddress,
                user_agent: userAgent,
                metadata: { expected_hash: sigRequest.original_pdf_hash, actual_hash: currentHash }
            })
            return {
                statusCode: 409,
                body: JSON.stringify({ error: 'Il documento e stato modificato dopo la creazione della richiesta di firma. Genera una nuova richiesta.' })
            }
        }

        // Load and modify PDF — add attestation page
        const pdfDoc = await PDFDocument.load(originalPdfBytes)
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)


        const signedAt = new Date()
        const signedAtRome = signedAt.toLocaleString('it-IT', { timeZone: 'Europe/Rome' })

        // Add signer full name on footer right of ALL pages
        {
            const allPages = pdfDoc.getPages()
            const signerName = sigRequest.signer_name || 'N/A'

            for (const pg of allPages) {
                const { width: pageWidth } = pg.getSize()
                const nameSize = 8
                const nameWidth = font.widthOfTextAtSize(signerName, nameSize)
                pg.drawText(signerName, {
                    x: pageWidth - nameWidth - 30,
                    y: 15,
                    size: nameSize,
                    font,
                    color: rgb(0.3, 0.3, 0.3),
                })
            }

            console.log(`[signature-complete] Footer name added on ${allPages.length} pages for: ${signerName}`)
        }

        // Add attestation page
        const page = pdfDoc.addPage([595.28, 841.89]) // A4
        const { width, height } = page.getSize()

        const black = rgb(0, 0, 0)
        const gray = rgb(0.4, 0.4, 0.4)
        const gold = rgb(0.83, 0.69, 0.22) // DR7 gold
        const lightGray = rgb(0.95, 0.95, 0.95)

        let y = height - 60

        // Header
        page.drawText('ATTESTAZIONE DI FIRMA ELETTRONICA', {
            x: 50, y, size: 18, font: fontBold, color: black
        })
        y -= 8
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 2, color: gold })
        y -= 30

        // Document info section
        page.drawRectangle({ x: 45, y: y - 100, width: width - 90, height: 110, color: lightGray, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 1 })

        page.drawText('INFORMAZIONI DOCUMENTO', { x: 55, y, size: 10, font: fontBold, color: gray })
        y -= 20

        const infoLines = [
            ['Documento:', contract ? (contract.contract_number || 'N/A') : (sigRequest.document_name || 'Documento')],
            ['Cliente:', sigRequest.signer_name],
            ['Email:', sigRequest.signer_email],
            ['Data firma:', signedAtRome],
        ]

        for (const [label, value] of infoLines) {
            page.drawText(label, { x: 55, y, size: 10, font: fontBold, color: black })
            page.drawText(value, { x: 170, y, size: 10, font, color: black })
            y -= 18
        }
        y -= 25

        // Signature verification section
        page.drawRectangle({ x: 45, y: y - 120, width: width - 90, height: 130, color: lightGray, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 1 })

        page.drawText('VERIFICA FIRMA', { x: 55, y, size: 10, font: fontBold, color: gray })
        y -= 20

        const verifyLines = [
            ['Metodo:', signatureImage
                ? `Firma Elettronica Avanzata via OTP ${otpChannel === 'whatsapp' ? 'WhatsApp' : 'Email'} + Firma Autografa`
                : `Firma Elettronica Avanzata via OTP ${otpChannel === 'whatsapp' ? 'WhatsApp' : 'Email'}`],
            [otpChannel === 'whatsapp' ? 'WhatsApp OTP:' : 'Email OTP:', otpChannel === 'whatsapp' ? (sigRequest.signer_name || sigRequest.signer_email) : sigRequest.signer_email],
            ['IP firmatario:', ipAddress],
            ['User Agent:', (userAgent || '').substring(0, 70)],
            ['Hash SHA-256:', currentHash.substring(0, 32) + '...'],
        ]

        for (const [label, value] of verifyLines) {
            page.drawText(label, { x: 55, y, size: 9, font: fontBold, color: black })
            page.drawText(value, { x: 170, y, size: 9, font, color: black })
            y -= 18
        }
        y -= 30

        // Legal text
        page.drawText('DICHIARAZIONE', { x: 55, y, size: 10, font: fontBold, color: gray })
        y -= 18

        const legalLines = [
            `Il sottoscritto ${sigRequest.signer_name} dichiara di aver preso visione del`,
            `contratto sopra indicato e di approvarne integralmente il contenuto.`,
            ``,
            `La firma e stata apposta tramite verifica dell'identita via codice OTP`,
            `inviato via ${otpChannel === 'whatsapp' ? 'WhatsApp' : `email a ${sigRequest.signer_email}`}, in conformita`,
            `con il Regolamento eIDAS (UE) n. 910/2014 e il CAD (D.Lgs. 82/2005).`,
            ``,
            `Il presente documento e stato firmato elettronicamente e qualsiasi`,
            `modifica successiva ne invalida l'autenticita. L'integrita del`,
            `documento e garantita dall'hash SHA-256 sopra riportato.`,
        ]

        for (const line of legalLines) {
            page.drawText(line, { x: 55, y, size: 10, font, color: black })
            y -= 16
        }
        y -= 25

        // Hash box
        page.drawRectangle({ x: 45, y: y - 35, width: width - 90, height: 45, color: rgb(0.98, 0.96, 0.88), borderColor: gold, borderWidth: 1 })
        page.drawText('HASH SHA-256 DOCUMENTO ORIGINALE', { x: 55, y, size: 8, font: fontBold, color: gray })
        y -= 15
        page.drawText(currentHash, { x: 55, y, size: 8, font, color: black })
        y -= 40

        // Footer
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) })
        y -= 15
        page.drawText('Dubai rent 7.0 S.p.A. - Via del Fangario 25, 09122 Cagliari (CA) - P.IVA 04104640927', {
            x: 55, y, size: 8, font, color: gray
        })
        y -= 12
        page.drawText(`Documento generato automaticamente il ${signedAtRome} - Non modificabile`, {
            x: 55, y, size: 8, font, color: gray
        })

        // Serialize final PDF
        const signedPdfBytes = await pdfDoc.save()
        const signedPdfHash = crypto.createHash('sha256').update(Buffer.from(signedPdfBytes)).digest('hex')

        // Upload signed PDF to Supabase storage
        const fileName = `signed/${docIdentifier}_firmato_${Date.now()}.pdf`
        const { error: uploadError } = await supabase
            .storage
            .from('contracts')
            .upload(fileName, signedPdfBytes, {
                contentType: 'application/pdf',
                upsert: false
            })

        if (uploadError) {
            throw new Error(`Upload failed: ${uploadError.message}`)
        }

        const { data: publicUrl } = supabase.storage.from('contracts').getPublicUrl(fileName)
        const signedPdfUrl = publicUrl.publicUrl

        // Update signature request as signed
        await supabase
            .from('signature_requests')
            .update({
                status: 'signed',
                signed_pdf_url: signedPdfUrl,
                signed_pdf_hash: signedPdfHash,
                signer_ip: ipAddress,
                signer_user_agent: userAgent,
                signed_at: signedAt.toISOString(),
                updated_at: signedAt.toISOString()
            })
            .eq('id', sigRequest.id)

        // Update contract record (only if this is a contract-based signature)
        if (sigRequest.contract_id) {
            await supabase
                .from('contracts')
                .update({
                    signed_pdf_url: signedPdfUrl,
                    updated_at: signedAt.toISOString()
                })
                .eq('id', sigRequest.contract_id)
        }

        // Log final audit event
        await supabase.from('signature_audit_trail').insert({
            signature_request_id: sigRequest.id,
            event_type: 'document_signed',
            event_description: `Documento firmato da ${sigRequest.signer_name} (${sigRequest.signer_email})`,
            ip_address: ipAddress,
            user_agent: userAgent,
            metadata: {
                signed_at: signedAt.toISOString(),
                signed_at_rome: signedAtRome,
                original_pdf_hash: currentHash,
                signed_pdf_hash: signedPdfHash,
                signed_pdf_url: signedPdfUrl,
                document_identifier: docIdentifier,
                marketing_consent: !!marketingConsent
            }
        })

        // Save marketing consent on customer record — NEVER overwrite true with false (GDPR: consent once given is kept)
        if (marketingConsent !== undefined) {
            try {
                // Determine customer email — from booking (contract) or signer email (standalone doc)
                let customerEmail = sigRequest.signer_email || ''

                if (contract?.booking_id) {
                    const { data: booking } = await supabase
                        .from('bookings')
                        .select('customer_email, booking_details')
                        .eq('id', contract.booking_id)
                        .single()
                    customerEmail = booking?.customer_email || booking?.booking_details?.customer?.email || customerEmail
                }

                if (customerEmail) {
                    // Case-insensitive lookup
                    const { data: existingCustomer } = await supabase
                        .from('customers_extended')
                        .select('marketing_consent, email')
                        .ilike('email', customerEmail)
                        .maybeSingle()

                    const currentConsent = existingCustomer?.marketing_consent ?? null

                    // Only update if:
                    // - New consent is true (always record a yes)
                    // - OR current consent is null (no record yet — record even a no)
                    // NEVER overwrite true with false
                    if (existingCustomer && (currentConsent !== true || !!marketingConsent === true)) {
                        await supabase
                            .from('customers_extended')
                            .update({
                                marketing_consent: !!marketingConsent,
                                marketing_consent_date: signedAt.toISOString()
                            })
                            .ilike('email', customerEmail)
                        console.log(`[signature-complete] Marketing consent (${marketingConsent}) saved for ${customerEmail}`)
                    } else if (!existingCustomer) {
                        // CREATE the row so consent is persisted for future signings
                        await supabase
                            .from('customers_extended')
                            .insert({
                                email: customerEmail.toLowerCase(),
                                marketing_consent: !!marketingConsent,
                                marketing_consent_date: signedAt.toISOString()
                            })
                        console.log(`[signature-complete] Created customers_extended record for ${customerEmail} with marketing_consent=${!!marketingConsent}`)
                    } else {
                        console.log(`[signature-complete] Skipping consent update for ${customerEmail}: existing=true, new=false — kept as true`)
                    }
                }
            } catch (mcErr: any) {
                console.error('[signature-complete] Failed to save marketing consent:', mcErr.message)
            }
        }

        // Send signed document via WhatsApp
        const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
        const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN
        if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN && signedPdfUrl) {
            try {
                let customerPhone = sigRequest.signer_phone || ''

                if (!customerPhone && contract?.booking_id) {
                    const { data: booking } = await supabase
                        .from('bookings')
                        .select('customer_phone, booking_details')
                        .eq('id', contract.booking_id)
                        .single()
                    customerPhone = booking?.customer_phone || booking?.booking_details?.customer?.phone || ''
                }

                // For standalone documents, look up phone from customers_extended
                if (!customerPhone && sigRequest.signer_email) {
                    const { data: cust } = await supabase
                        .from('customers_extended')
                        .select('telefono')
                        .eq('email', sigRequest.signer_email)
                        .maybeSingle()
                    customerPhone = cust?.telefono || ''
                }
                if (customerPhone) {
                    let cleanPhone = customerPhone.replace(/[\s\-\+\(\)]/g, '')
                    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2)
                    if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone

                    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendFileByUrl/${GREEN_API_TOKEN}`
                    const waResponse = await fetch(greenApiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${cleanPhone}@c.us`,
                            urlFile: signedPdfUrl,
                            fileName: `${docIdentifier}_firmato.pdf`,
                            caption: `${contract ? 'Contratto' : 'Documento'} ${docIdentifier} firmato - DR7 Empire`
                        })
                    })

                    const waResult = await waResponse.json()
                    if (waResponse.ok && !waResult.error) {
                        console.log('[signature-complete] Signed contract sent via WhatsApp:', waResult.idMessage)
                    } else {
                        console.error('[signature-complete] WhatsApp send failed:', waResult)
                    }
                } else {
                    console.log('[signature-complete] No customer phone — skipping WhatsApp send')
                }
            } catch (waErr: any) {
                console.error('[signature-complete] WhatsApp send failed:', waErr.message)
            }
        }

        // Dual-write to Trustera Supabase — copy signed document + marketing consent
        try {
            await supabaseTrustera.from('signed_documents_log').insert({
                source: contract ? 'dr7_contract' : 'dr7_standalone',
                document_name: contract ? (contract.contract_number || 'N/A') : (sigRequest.document_name || 'documento'),
                signer_name: sigRequest.signer_name,
                signer_email: sigRequest.signer_email,
                signed_pdf_url: signedPdfUrl,
                signed_at: signedAt.toISOString(),
                original_pdf_hash: currentHash,
                signed_pdf_hash: signedPdfHash,
                signer_ip: ipAddress,
                marketing_consent: marketingConsent !== undefined ? !!marketingConsent : null,
                metadata: {
                    document_identifier: docIdentifier,
                    booking_id: contract?.booking_id || null,
                    contract_id: sigRequest.contract_id || null,
                }
            })
            console.log('[signature-complete] Signed doc copied to Trustera DB')

            // Mirror marketing consent to Trustera
            if (marketingConsent !== undefined && sigRequest.signer_email) {
                const email = sigRequest.signer_email.toLowerCase()
                const { data: existing } = await supabaseTrustera
                    .from('marketing_consents')
                    .select('marketing_consent')
                    .eq('email', email)
                    .maybeSingle()

                if (existing) {
                    // Never overwrite true with false (GDPR)
                    if (existing.marketing_consent !== true || !!marketingConsent === true) {
                        await supabaseTrustera.from('marketing_consents').update({
                            marketing_consent: !!marketingConsent,
                            consent_date: signedAt.toISOString(),
                            name: sigRequest.signer_name,
                            updated_at: signedAt.toISOString(),
                        }).eq('email', email)
                    }
                } else {
                    await supabaseTrustera.from('marketing_consents').insert({
                        email,
                        name: sigRequest.signer_name,
                        marketing_consent: !!marketingConsent,
                        consent_date: signedAt.toISOString(),
                        source: contract ? 'dr7_contract' : 'dr7_standalone',
                    })
                }
            }
        } catch (syncErr: any) {
            console.warn('[signature-complete] Trustera sync failed (non-blocking):', syncErr.message)
        }

        // Auto-send to CARGOS via admin panel (only for rental contracts with booking_id)
        if (contract?.booking_id) {
            try {
                const cargosRes = await fetch('https://admin.dr7empire.com/.netlify/functions/cargos-auto-trigger', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Cargos-Key': process.env.CARGOS_TRIGGER_KEY || 'dr7-cargos-auto-2024'
                    },
                    body: JSON.stringify({ bookingId: contract.booking_id })
                })
                const cargosResult = await cargosRes.json()
                if (cargosResult.success) {
                    console.log('[signature-complete] ✅ Contract auto-sent to CARGOS via admin')
                } else {
                    console.warn('[signature-complete] ⚠️ CARGOS auto-send failed:', cargosResult.error)
                }
            } catch (cargosErr: any) {
                console.error('[signature-complete] ⚠️ CARGOS trigger error:', cargosErr.message)
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Documento firmato con successo',
                signedPdfUrl,
                signedAt: signedAtRome
            })
        }
    } catch (error: any) {
        console.error('Error in signature-complete:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nella firma del documento', details: error.message })
        }
    }
}
