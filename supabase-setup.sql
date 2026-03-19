-- ============================================================
-- Trustera360 — Required tables and columns
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- ============================================================

-- 1. trustera_document_fields table (for field placement on PDFs)
CREATE TABLE IF NOT EXISTS trustera_document_fields (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES trustera_documents(id) ON DELETE CASCADE,
  signer_id uuid REFERENCES trustera_document_signers(id) ON DELETE SET NULL,
  signer_index int NOT NULL DEFAULT 0,
  field_type text NOT NULL, -- signature, date, name, email, text, label, checkbox, radio
  label text,
  page_number int NOT NULL DEFAULT 1,
  x_percent numeric NOT NULL DEFAULT 0,
  y_percent numeric NOT NULL DEFAULT 0,
  width_percent numeric NOT NULL DEFAULT 20,
  height_percent numeric NOT NULL DEFAULT 5,
  required boolean NOT NULL DEFAULT true,
  placeholder text,
  radio_group text,
  default_value text,
  value text, -- filled by signer
  filled_at timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- RLS: allow service role full access (functions use service role key)
ALTER TABLE trustera_document_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on trustera_document_fields"
  ON trustera_document_fields
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. trustera_contacts table (auto-saved when sending documents)
CREATE TABLE IF NOT EXISTS trustera_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(owner_id, email)
);

ALTER TABLE trustera_contacts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage their own contacts
CREATE POLICY "Users can view own contacts"
  ON trustera_contacts FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own contacts"
  ON trustera_contacts FOR DELETE
  USING (auth.uid() = owner_id);

-- Service role can insert/update (from Netlify functions)
CREATE POLICY "Service role can manage contacts"
  ON trustera_contacts FOR ALL
  USING (true)
  WITH CHECK (true);

-- 3. Add notification_channel column to trustera_document_signers (if missing)
ALTER TABLE trustera_document_signers
  ADD COLUMN IF NOT EXISTS notification_channel text DEFAULT 'email';

-- 4. Add marketing_consent column to trustera_document_signers (if missing)
ALTER TABLE trustera_document_signers
  ADD COLUMN IF NOT EXISTS marketing_consent boolean DEFAULT false;

-- 5. trustera_leads table (for lead tracking)
CREATE TABLE IF NOT EXISTS trustera_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  phone text,
  marketing_consent boolean DEFAULT false,
  source text,
  last_seen_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE trustera_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on trustera_leads"
  ON trustera_leads FOR ALL
  USING (true)
  WITH CHECK (true);

-- 6. marketing_consents table
CREATE TABLE IF NOT EXISTS marketing_consents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  consent boolean DEFAULT false,
  source text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE marketing_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on marketing_consents"
  ON marketing_consents FOR ALL
  USING (true)
  WITH CHECK (true);

-- 7. signed_documents_log table
CREATE TABLE IF NOT EXISTS signed_documents_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text,
  document_name text,
  signer_name text,
  signer_email text,
  signed_pdf_url text,
  signed_at timestamptz,
  original_pdf_hash text,
  signer_ip text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE signed_documents_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on signed_documents_log"
  ON signed_documents_log FOR ALL
  USING (true)
  WITH CHECK (true);

-- 8. Make sure Supabase storage bucket 'trustera' exists and allows public reads
-- (This must be done via the Supabase Dashboard > Storage > Create bucket "trustera")
-- Set it to PUBLIC so PDFs can be accessed by react-pdf in the browser.

-- 9. PDF hash for QR code verification
ALTER TABLE trustera_documents
  ADD COLUMN IF NOT EXISTS pdf_hash text;

-- 10. Approver workflow columns on trustera_documents
-- approvers: jsonb array of { name, email, token, status: 'pending'|'approved'|'rejected', reason?, acted_at? }
-- approval_status: overall approval state
-- draft_signers: signers held until all approvers approve
ALTER TABLE trustera_documents
  ADD COLUMN IF NOT EXISTS approvers jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS approval_status text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS draft_signers jsonb DEFAULT NULL;

-- Optional: index on approval_status for the approval token lookup query
CREATE INDEX IF NOT EXISTS idx_trustera_documents_approval_status
  ON trustera_documents (approval_status)
  WHERE approval_status IS NOT NULL;
