import { AuthBenefits } from "./AuthBenefits";

/**
 * The sales pitch on the auth gateway — the IFRS claim, the strapline and
 * the benefit points, grouped onto one frosted panel. The panel is what
 * makes this text readable over the photo, which is why none of it carries
 * the text-shadows the unboxed wordmark above it needs.
 */
export function AuthPitch() {
  return (
    <div className="auth-pitch">
      <p className="auth-ifrs">IFRS-Compliant ERP System</p>
      <p className="auth-sub">The complete business platform, built for Saudi Arabia.</p>
      <AuthBenefits />
    </div>
  );
}
