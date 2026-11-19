-- WhatsApp sends recorded before SHARE existed were logged as downloads; move them to their own type.
UPDATE "audit_logs" SET "action" = 'SHARE' WHERE "action" = 'DOWNLOAD' AND "afterSnapshot"->>'via' = 'Sent via WhatsApp';
