/**
 * Shares a generated file (PDF, image, …) through WhatsApp.
 *
 * There is no URL scheme that lets a web page pre-attach a file into a
 * WhatsApp chat — wa.me/whatsapp:// links only support pre-filled text.
 * The only real "share this exact file into WhatsApp" path is the Web
 * Share API (`navigator.share` with a `files` array), which shows the
 * OS/browser share sheet with WhatsApp as one of the targets — supported
 * on HTTPS in most mobile browsers and increasingly on desktop Chrome.
 * Where that isn't available, this falls back to downloading the file and
 * opening a WhatsApp chat with a text note asking the sender to attach the
 * file they just downloaded.
 */
export async function shareFileViaWhatsApp(file: File, opts: { phone?: string | null; text: string }): Promise<"shared" | "fallback"> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
  };

  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: file.name, text: opts.text });
      return "shared";
    } catch {
      // User cancelled the share sheet, or the browser rejected it — fall through to the manual path.
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  const digits = opts.phone ? opts.phone.replace(/[^\d]/g, "") : "";
  const waUrl = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(opts.text)}`
    : `https://wa.me/?text=${encodeURIComponent(opts.text)}`;
  window.open(waUrl, "_blank", "noopener,noreferrer");
  return "fallback";
}
