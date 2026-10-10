// Downloads/exports (CSV, Excel, PDF, XML, import templates) are limited to
// the platform admin account. UI buttons are hidden via useCanDownload(); this
// module-level flag is the second line of defence for the shared helpers
// (downloadCsv, downloadPdf, ...) so a button that gets missed still does
// nothing for everyone else. Server-side routes enforce it independently via
// PlatformAdminGuard — see the download routes in the API controllers.
let allowed = false;

export function setDownloadsAllowed(value: boolean) {
  allowed = value;
}

export function downloadsAllowed(): boolean {
  return allowed;
}
