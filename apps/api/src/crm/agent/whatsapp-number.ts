/**
 * Normalizes a phone number to the digits-only international form wa.me
 * links need. Saudi local formats (05xxxxxxxx / 5xxxxxxxx) get the 966
 * country code; anything already international (+, 00) is kept as is.
 * Mirrored in apps/web/src/pages/crm/whatsapp.ts — keep the two in sync.
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
