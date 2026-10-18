import { apiClient } from "../api/client";

/** POSTs a file as multipart form data to an evidence/receipt/attachment upload route (which replaces any file already saved). */
export async function uploadEvidenceFile(url: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await apiClient.post(url, form, { headers: { "Content-Type": "multipart/form-data" } });
}
