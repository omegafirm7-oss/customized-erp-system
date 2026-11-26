-- New document type for delivery notes (own migration: a new enum value cannot be used in the transaction that adds it).
ALTER TYPE "DocumentType" ADD VALUE 'DELIVERY_NOTE';
