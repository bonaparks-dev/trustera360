import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SITE_URL = process.env.SITE_URL || 'https://trustera360.app'

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { email, password, fullName } = JSON.parse(event.body || '{}')

        if (!email || !password || !fullName) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email, password e nome sono obbligatori' }) }
        }

        if (password.length < 6) {
            return { statusCode: 400, body: JSON.stringify({ error: 'La password deve avere almeno 6 caratteri' }) }
        }

        // Create user via admin API (does NOT send Supabase's default email)
        const { data: userData, error: createError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: false,
            user_metadata: { full_name: fullName }
        })

        if (createError) {
            // Handle duplicate email
            if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
                return { statusCode: 409, body: JSON.stringify({ error: 'Questa email e gia registrata. Prova ad accedere.' }) }
            }
            console.error('[trustera-signup] Create user error:', createError.message)
            return { statusCode: 400, body: JSON.stringify({ error: createError.message }) }
        }

        if (!userData.user) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Errore nella creazione dell\'account' }) }
        }

        // Generate email confirmation link via admin API
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'signup',
            email,
            password,
            options: {
                redirectTo: `${SITE_URL}/dashboard`
            }
        })

        if (linkError) {
            console.error('[trustera-signup] Generate link error:', linkError.message)
            // User is created but link failed — still try to send a basic link
        }

        // Extract the token from the generated link
        // Supabase generates: https://project.supabase.co/auth/v1/verify?token=xxx&type=signup&redirect_to=...
        // We want to send our own branded email with a link to our verify endpoint
        let verifyUrl = `${SITE_URL}/login` // fallback
        if (linkData?.properties?.hashed_token) {
            verifyUrl = `${SITE_URL}/.netlify/functions/trustera-verify-email?token_hash=${linkData.properties.hashed_token}&type=signup&redirect_to=${encodeURIComponent(`${SITE_URL}/dashboard`)}`
        } else if (linkData?.properties?.action_link) {
            // Use the action link directly but route through our function
            const url = new URL(linkData.properties.action_link)
            const tokenHash = url.searchParams.get('token_hash') || url.searchParams.get('token')
            if (tokenHash) {
                verifyUrl = `${SITE_URL}/.netlify/functions/trustera-verify-email?token_hash=${tokenHash}&type=signup&redirect_to=${encodeURIComponent(`${SITE_URL}/dashboard`)}`
            } else {
                verifyUrl = linkData.properties.action_link
            }
        }

        // Send branded verification email via Resend
        const resendApiKey = process.env.RESEND_API_KEY
        if (!resendApiKey) {
            console.error('[trustera-signup] RESEND_API_KEY not set')
            return { statusCode: 500, body: JSON.stringify({ error: 'Errore di configurazione email' }) }
        }

        const resend = new Resend(resendApiKey)

        const { error: emailError } = await resend.emails.send({
            from: 'Trustera <noreply@trustera360.app>',
            to: email,
            subject: 'Conferma il tuo account Trustera',
            html: `
                <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
                    <div style="text-align: center; margin-bottom: 40px;">
                        <img src="https://trustera360.app/trustera-logo.jpeg" alt="Trustera" style="height: 48px;" />
                    </div>

                    <h1 style="color: #111827; font-size: 24px; font-weight: 700; text-align: center; margin-bottom: 8px;">
                        Benvenuto su Trustera
                    </h1>
                    <p style="color: #6b7280; font-size: 16px; text-align: center; margin-bottom: 32px;">
                        Ciao ${fullName}, conferma il tuo indirizzo email per attivare il tuo account.
                    </p>

                    <div style="text-align: center; margin-bottom: 32px;">
                        <a href="${verifyUrl}"
                           style="display: inline-block; background: #16a34a; color: #ffffff; font-size: 16px; font-weight: 700; text-decoration: none; padding: 14px 40px; border-radius: 8px;">
                            Conferma Email
                        </a>
                    </div>

                    <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-bottom: 8px;">
                        Se non hai creato un account su Trustera, ignora questa email.
                    </p>
                    <p style="color: #9ca3af; font-size: 13px; text-align: center;">
                        Il link scade tra 24 ore.
                    </p>

                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />

                    <p style="color: #d1d5db; font-size: 11px; text-align: center;">
                        Trustera - Infrastructure for Digital Trust<br/>
                        <a href="https://trustera360.app" style="color: #16a34a; text-decoration: none;">www.trustera360.app</a>
                    </p>
                </div>
            `
        })

        if (emailError) {
            console.error('[trustera-signup] Resend error:', emailError)
            return { statusCode: 500, body: JSON.stringify({ error: 'Errore nell\'invio dell\'email di conferma' }) }
        }

        console.log(`[trustera-signup] Verification email sent to ${email}`)

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Account creato! Controlla la tua email per confermare.' })
        }
    } catch (error: any) {
        console.error('[trustera-signup] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Errore nella registrazione' })
        }
    }
}
