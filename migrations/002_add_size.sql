-- Add size_bytes column to documents for storage limit enforcement

ALTER TABLE documents ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows: compute byte length of the JSON content
UPDATE documents SET size_bytes = length(content);
