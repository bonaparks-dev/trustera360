---
name: Netlify signing functions architecture
description: Multi-signer flow, backward compat pattern, and key decisions for trustera360 signing Netlify functions
type: project
---

## Tables
- `trustera_documents` — master document record; old docs have signer_* fields directly
- `trustera_document_signers` — per-signer rows (new flow); joined to trustera_documents via document_id
- `trustera_contacts` — address book; upsert on (owner_id, email)
- `trustera_leads` — all leads; upsert on email; NEVER overwrite marketing_consent=true with false
- `marketing_consents` — consent log; upsert on email
- `signed_documents_log` — immutable audit log of completed signings

## Backward compat pattern (used in sign-get, sign-otp, sign-verify, sign-complete)
1. Query `trustera_document_signers` by `signing_token` (.maybeSingle())
2. If found, use new multi-signer flow
3. If not found, query `trustera_documents` by `signing_token` — old single-signer flow
Use `.maybeSingle()` not `.single()` for the first lookup to avoid throwing on miss.

## trustera-send-signing
- Input: `{ documentId, signers: [{name, email, phone?}] }`
- Inserts one row per signer into `trustera_document_signers` with unique token (crypto.randomBytes(32).toString('hex'))
- Upserts trustera_contacts (onConflict: 'owner_id,email') and trustera_leads (onConflict: 'email')
- Sets document status='pending' after all signers processed
- Sends email via Resend + WhatsApp via Green API per signer

## trustera-sign-complete (multi-signer)
- Updates signer row: status='signed', signed_at, signing_ip, signing_user_agent, marketing_consent
- After each signer, checks if ALL signers for that document_id have status='signed'
- Only when ALL signed: downloads original PDF, builds attestation pages (one per signer), uploads signed PDF, updates document, logs, notifies
- Returns `{ allDone: boolean, signedPdfUrl?, signedAt? }`
- Idempotent: if signer already status='signed', returns early with allDone=true

## Phone cleaning for Green API chatId
- Strip: spaces, dashes, parens, +
- Italian 10-digit starting with 3 → prepend '39'
- Result appended with '@c.us' for chatId

## PDF attestation
- One page per signer appended to original PDF
- Includes: name, email, data/ora (Europe/Rome), IP, user agent (truncated 80), OTP method, SHA-256 hash of original
- Long values split across lines at 60 chars to avoid overflow

## Why:
Multi-signer support was added while keeping full backward compat for old documents that store signer info on trustera_documents directly.
