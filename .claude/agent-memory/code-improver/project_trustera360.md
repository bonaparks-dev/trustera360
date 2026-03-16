---
name: Trustera360 design conventions
description: Visual and code conventions used across the trustera360 React/TypeScript project
type: project
---

Trustera360 is a React + TypeScript + Tailwind CSS SPA (Vite-based).

**Why:** Recorded to stay consistent with existing pages when generating or reviewing code.
**How to apply:** Follow these conventions whenever writing or modifying pages in this project.

## Design tokens
- Primary dark green heading color: `text-[#0d3d2a]`
- Accent/interactive green: `green-600` (hover: `green-700`)
- Card border radius: `rounded-2xl` for cards, `rounded-xl` for buttons/inputs
- Max container widths: `max-w-6xl` (full layout), `max-w-5xl` (content sections), `max-w-3xl` (narrow/hero)
- Shadow style: `shadow-sm` + `shadow-md shadow-green-600/5` on hover for cards
- Button CTA: `bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-2.5 rounded-lg shadow-md shadow-green-600/20`
- Section padding: `py-16` to `py-24` vertical, `px-6` horizontal

## Layout
- `SiteLayout` in `src/components/SiteLayout.tsx` provides the sticky header, nav, and footer — all public pages should use it
- `LandingPage.tsx` is the exception — it has its own inline header/footer (legacy, do not replicate this pattern)
- Nav links: `/features`, `/pricing`, `/api`, `/security`, `/use-cases`

## Code conventions
- Functional components with named exports as default
- Data arrays extracted as module-level constants above components
- Small reusable sub-components defined in the same file when page-specific
- Italian-language UI throughout (labels, headings, descriptions)
- `Link` from `react-router-dom` for internal navigation, `<a href="mailto:...">` for email
- No emoji in UI text

## File locations
- Pages: `src/pages/*.tsx`
- Shared components: `src/components/*.tsx` (only `SiteLayout.tsx` confirmed so far)

## DashboardPage structure (after multi-signer rewrite 2026-03-16)
- Three sidebar sections: `documenti` | `contatti` | `lead`
- Desktop: left sidebar (`w-52`), mobile: horizontal tab bar at top
- Documents: fetched with `select('*, signers:trustera_document_signers(*)')` — backward compat with legacy `signer_email`/`signer_name` cols
- Expandable doc cards to show per-signer progress (`trustera_document_signers` rows)
- Contacts: `trustera_contacts` table, auto-populated by backend, no manual add
- Upload modal: dynamic `signerRows` array, contact autocomplete via onBlur-delayed hide, `onMouseDown` on suggestion buttons to beat blur
- Leads: fetched via `POST /.netlify/functions/trustera-get-leads` with `{ accessToken }`
- Multi-signer upload sends `{ documentId, signers: [{name, email, phone}] }` to `trustera-send-signing`

## SignPage marketing consent (added 2026-03-16)
- `marketingConsent: boolean | null` state (null = not selected, radio buttons)
- Passed to `trustera-sign-complete` as `{ token, marketingConsent }`
- NOT required — sign button only gated on `acceptedTerms`
- Rendered in step 3 (signing) between the terms checkbox and the sign button

## LoginPage marketing consent (added 2026-03-16)
- `marketingConsent: boolean` state (checkbox, default false)
- Signup-only — not shown in login mode
- Passed to `trustera-signup` Netlify function alongside `{ email, password, fullName }`
- Reset to `false` when toggling between login/signup
