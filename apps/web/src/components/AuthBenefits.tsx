const BENEFITS = [
  "Close your books in days, not weeks",
  "See the true profit of every project, live",
  "ZATCA e-invoicing handled automatically",
  "One login for all your companies",
];

/** The "why bother" pitch on the sign-in gateway, aimed at a prospect who
 *  has landed here before they have an account. Bold, with a plain bullet
 *  rather than a tick — a tick reads as "verified", which these are not;
 *  they're claims about the product. */
export function AuthBenefits() {
  return (
    <ul className="auth-benefits">
      {BENEFITS.map((b) => (
        <li key={b}>
          <span className="auth-benefit-dot" aria-hidden="true">
            •
          </span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}
