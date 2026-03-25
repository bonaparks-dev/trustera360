import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import QRCode from 'qrcode'
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

        // ── Trustera Verified Seals with QR code on last page ──
        // FIRMA LOCATORE gets a seal too (Ilenia Campagnola), same format as guidatore
        {
            const verifyUrl = `https://trustera360.app/verify/${currentHash}`
            const qrPng = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 300, margin: 1 })
            const qrImage = await pdfDoc.embedPng(qrPng)

            // Embed Trustera logo
            let logoImage: any = null
            try {
                const logoResp = await fetch('https://trustera360.app/trustera-logo.png')
                if (logoResp.ok) {
                    logoImage = await pdfDoc.embedPng(new Uint8Array(await logoResp.arrayBuffer()))
                }
            } catch (e) {
                console.warn('[signature-complete] Could not embed logo:', e)
            }

            const pages = pdfDoc.getPages()
            const sealPage = pages[pages.length - 1]
            const { width: pageWidth } = sealPage.getSize()

            const certId = `TR-${new Date().getFullYear()}-${currentHash.slice(0, 8).toUpperCase()}`

            // Seal dimensions — compact to fit inside contract signature boxes
            const sealW = 130
            const sealH = 42

            const darkGreen = rgb(0.06, 0.35, 0.18)
            const sealGray = rgb(0.35, 0.35, 0.35)
            const sealLightGray = rgb(0.75, 0.75, 0.75)

            // Determine signer position for guidatore seal
            let signerIndex = 0
            if (sigRequest.contract_id) {
                const { data: allRequests } = await supabase
                    .from('signature_requests')
                    .select('id, created_at')
                    .eq('contract_id', sigRequest.contract_id)
                    .in('status', ['signed', 'otp_verified', 'otp_sent', 'pending'])
                    .order('created_at', { ascending: true })
                if (allRequests) {
                    signerIndex = allRequests.findIndex((r: any) => r.id === sigRequest.id)
                    if (signerIndex < 0) signerIndex = 0
                }
                console.log(`[signature-complete] Signer index: ${signerIndex} of ${allRequests?.length || 1} for contract ${sigRequest.contract_id}`)
            }

            // Contract last page layout (A4 = 595pt, y=0 at bottom):
            //   Row 1 (y≈105–235): FIRMA LOCATORE (x 30–208) | 1° guidatore (x 208–388) | 2° guidatore (x 388–567)
            //   Row 2 (y≈30–105):  Firma del garante (full width x 30–567)
            // From screenshot: three-column row bottom border ≈ y=105, top ≈ y=235

            // ── FIRMA LOCATORE seal (always drawn for DR7 contracts) ──
            if (contract) {
                const locSealX = 40  // Left side of LOCATORE column
                const locSealY = 160 // Middle of LOCATORE box

                // Draw seal for Ilenia Campagnola
                sealPage.drawRectangle({
                    x: locSealX, y: locSealY, width: sealW, height: sealH,
                    borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.75,
                    color: rgb(1, 1, 1),
                })
                const locHeaderY = locSealY + sealH - 12
                if (logoImage) {
                    const hLogoH = 9
                    const hLogoW = (logoImage.width / logoImage.height) * hLogoH
                    sealPage.drawImage(logoImage, { x: locSealX + 4, y: locHeaderY - 1, width: hLogoW, height: hLogoH })
                    sealPage.drawText('Verified Seal', { x: locSealX + 4 + hLogoW + 2, y: locHeaderY + 1, size: 4.5, font, color: sealLightGray })
                } else {
                    sealPage.drawText('Trustera  Verified Seal', { x: locSealX + 4, y: locHeaderY + 1, size: 4.5, font: fontBold, color: sealGray })
                }
                const locInfoX = locSealX + 4
                const locInfoY = locHeaderY - 9
                sealPage.drawText('Ilenia Campagnola', { x: locInfoX, y: locInfoY, size: 5.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
                const dd = String(signedAt.getDate()).padStart(2, '0')
                const mo = String(signedAt.getMonth() + 1).padStart(2, '0')
                const yy = signedAt.getFullYear()
                const hh = String(signedAt.getHours()).padStart(2, '0')
                const mi = String(signedAt.getMinutes()).padStart(2, '0')
                sealPage.drawText(`${dd}/${mo}/${yy} — ${hh}:${mi} CET`, { x: locInfoX, y: locInfoY - 7, size: 4, font, color: sealGray })
                sealPage.drawText(`ID: ${certId}`, { x: locInfoX, y: locInfoY - 13, size: 3.5, font, color: sealLightGray })
                const locQrSize = 13
                sealPage.drawImage(qrImage, { x: locSealX + sealW - locQrSize - 4, y: locInfoY - 3, width: locQrSize, height: locQrSize })
                const locFooterY = locSealY
                sealPage.drawText('Verifica ', { x: locSealX + 4, y: locFooterY + 2, size: 3, font, color: sealLightGray })
                sealPage.drawText('AuditTrail', { x: locSealX + 4 + font.widthOfTextAtSize('Verifica ', 3), y: locFooterY + 2, size: 3, font: fontBold, color: darkGreen })
                if (logoImage) {
                    const lH = 6
                    const lW = (logoImage.width / logoImage.height) * lH
                    sealPage.drawImage(logoImage, { x: locSealX + sealW - lW - 4, y: locFooterY + 1, width: lW, height: lH })
                }
                console.log('[signature-complete] FIRMA LOCATORE seal placed')
            }

            // ── Guidatore / Garante seal positions ──
            // From screenshot: LOCATORE col wider (~30-248), 1° guid (~248-438), 2° guid (~438-567)
            let sealX: number
            let sealYPos: number
            if (signerIndex === 0) {
                sealX = 280   // Center of 1° guidatore: (248+438)/2 - 65
                sealYPos = 160 // Middle of three-column row
            } else if (signerIndex === 1) {
                sealX = 437   // Center of 2° guidatore: (438+567)/2 - 65
                sealYPos = 160 // Middle of three-column row
            } else {
                sealX = (pageWidth - sealW) / 2  // Centered for garante
                sealYPos = 45  // Inside garante row
            }

            // Outer rectangle
            sealPage.drawRectangle({
                x: sealX, y: sealYPos, width: sealW, height: sealH,
                borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.75,
                color: rgb(1, 1, 1),
            })

            // Header: logo + "Verified Seal"
            const headerY = sealYPos + sealH - 12
            if (logoImage) {
                const hLogoH = 9
                const hLogoW = (logoImage.width / logoImage.height) * hLogoH
                sealPage.drawImage(logoImage, { x: sealX + 4, y: headerY - 1, width: hLogoW, height: hLogoH })
                const vsX = sealX + 4 + hLogoW + 2
                sealPage.drawText('Verified Seal', { x: vsX, y: headerY + 1, size: 4.5, font, color: sealLightGray })
            } else {
                sealPage.drawText('Trustera  Verified Seal', { x: sealX + 4, y: headerY + 1, size: 4.5, font: fontBold, color: sealGray })
            }

            // Signer info
            const infoX = sealX + 4
            const infoY = headerY - 9
            const signerDisplayName = sigRequest.signer_name || 'Firmatario'
            sealPage.drawText(signerDisplayName, { x: infoX, y: infoY, size: 5.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) })

            // Date + time
            const dd = String(signedAt.getDate()).padStart(2, '0')
            const mo = String(signedAt.getMonth() + 1).padStart(2, '0')
            const yy = signedAt.getFullYear()
            const hh = String(signedAt.getHours()).padStart(2, '0')
            const mi = String(signedAt.getMinutes()).padStart(2, '0')
            sealPage.drawText(`${dd}/${mo}/${yy} — ${hh}:${mi} CET`, { x: infoX, y: infoY - 7, size: 4, font, color: sealGray })

            // Certificate ID
            sealPage.drawText(`ID: ${certId}`, { x: infoX, y: infoY - 13, size: 3.5, font, color: sealLightGray })

            // QR code (right side)
            const qrSize = 13
            sealPage.drawImage(qrImage, {
                x: sealX + sealW - qrSize - 4,
                y: infoY - 3,
                width: qrSize, height: qrSize,
            })

            // Footer bar
            const footerBarY = sealYPos
            const footerBarH = 8
            sealPage.drawText('Verifica ', { x: sealX + 4, y: footerBarY + 2, size: 3, font, color: sealLightGray })
            sealPage.drawText('AuditTrail', { x: sealX + 4 + font.widthOfTextAtSize('Verifica ', 3), y: footerBarY + 2, size: 3, font: fontBold, color: darkGreen })

            if (logoImage) {
                const lH = 6
                const lW = (logoImage.width / logoImage.height) * lH
                sealPage.drawImage(logoImage, {
                    x: sealX + sealW - lW - 4,
                    y: footerBarY + (footerBarH - lH) / 2,
                    width: lW, height: lH,
                })
            }

            console.log(`[signature-complete] Trustera verified seal placed at x=${sealX}, y=${sealYPos}`)
        }

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

        // No extra attestation page — the Trustera verified seal with QR code
        // on the contract's last page IS the attestation (same as /sign/ flow)

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

        // Send signed document via WhatsApp using DR7's Green API (same conversation as signing link)
        const GREEN_API_INSTANCE_ID = process.env.DR7_GREEN_API_INSTANCE_ID || process.env.GREEN_API_INSTANCE_ID
        const GREEN_API_TOKEN = process.env.DR7_GREEN_API_TOKEN || process.env.GREEN_API_TOKEN
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

            // Also send a copy to owner via Trustera's Green API (arrives in Trustera chat)
            const TRUSTERA_INSTANCE = process.env.GREEN_API_INSTANCE_ID
            const TRUSTERA_TOKEN = process.env.GREEN_API_TOKEN
            const ownerPhone = process.env.TRUSTERA_OWNER_WHATSAPP || '393457905205'
            if (TRUSTERA_INSTANCE && TRUSTERA_TOKEN && TRUSTERA_INSTANCE !== GREEN_API_INSTANCE_ID) {
                try {
                    const trusteraUrl = `https://api.green-api.com/waInstance${TRUSTERA_INSTANCE}/sendFileByUrl/${TRUSTERA_TOKEN}`
                    const ownerRes = await fetch(trusteraUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${ownerPhone}@c.us`,
                            urlFile: signedPdfUrl,
                            fileName: `${docIdentifier}_firmato.pdf`,
                            caption: `✅ Contratto ${docIdentifier} firmato da ${sigRequest.signer_name || 'cliente'}`
                        })
                    })
                    const ownerResult = await ownerRes.json()
                    if (ownerRes.ok && ownerResult.idMessage) {
                        console.log('[signature-complete] Owner copy sent via Trustera WhatsApp:', ownerResult.idMessage)
                    } else {
                        console.warn('[signature-complete] Trustera owner copy failed:', ownerResult)
                    }
                } catch (ownerErr: any) {
                    console.warn('[signature-complete] Trustera owner copy error:', ownerErr.message)
                }
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
