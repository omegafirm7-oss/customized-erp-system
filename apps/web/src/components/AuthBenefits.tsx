const BENEFITS = [
  "Close your books in days, not weeks",
  "See the true profit of every project, live",
  "ZATCA e-invoicing handled automatically",
  "One login for all your companies",
];

/** The "why bother" pitch on the sign-in gateway, aimed at a prospect who
 *  has landed here before they have an account. */
export function AuthBenefits() {
  return (
    <ul className="auth-benefits">
      {BENEFITS.map((b) => (
        <li key={b}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.6">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}
