import { apiClient } from "../api/client";

/** Uploads (or replaces) the evidence file on a purchase-invoice line. */
export async function replaceLineEvidence(lineId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await apiClient.post(`/ap/invoices/lines/${lineId}/attachment`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}
