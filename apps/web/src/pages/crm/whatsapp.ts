/**
 * Mirrors apps/api/src/crm/agent/whatsapp-number.ts — keep the two in sync.
 * (Not shared via @erp/shared-constants: that package is CJS-only and Vite
 * can't import runtime values from it.)
 */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
  else if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
  digits = digits.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/** wa.me opens WhatsApp (app on phones, WhatsApp Web on desktop) with the text prefilled. */
export function whatsAppLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
