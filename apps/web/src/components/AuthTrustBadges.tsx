const BADGES = [
  "ZATCA PHASE 2 COMPLIANT",
  "ENCRYPTED DATA STORAGE",
  "ROLE-BASED ACCESS CONTROL",
  "IMMUTABLE AUDIT TRAIL",
  "IFRS-COMPLIANT REPORTING",
  "UNLIMITED COMPANIES, ONE LOGIN",
];

/**
 * Only claims that are actually true are listed here — e.g. ZATCA Phase 2
 * compliance was verified against ZATCA's live sandbox (see
 * project_erp_phase3_zatca memory), and the audit trail / ledger
 * immutability are enforced by database triggers, not just app code.
 * Deliberately no ISO 27001 / SOC 2 / GDPR-style badges — Universa Centrix
 * doesn't hold those certifications, and displaying them would be a false
 * claim on a real login page.
 *
 * Plain bold text, no tick icon and no pill: these sit straight on the photo
 * so nothing competes with the words. Legibility comes from weight and a
 * text-shadow instead of a chip (see .auth-badge).
 */
export function AuthTrustBadges() {
  return (
    <div className="auth-badges">
      {BADGES.map((b) => (
        <span className="auth-badge" key={b}>
          {b}
        </span>
      ))}
    </div>
  );
}
