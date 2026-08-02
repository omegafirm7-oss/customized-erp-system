const FEATURES: Array<{ label: string; emoji: string }> = [
  { label: "Finance & Accounting", emoji: "💰" },
  { label: "ZATCA e-Invoicing", emoji: "🧾" },
  { label: "Projects & WIP", emoji: "🏗️" },
  { label: "HR & Payroll", emoji: "👥" },
  { label: "Inventory", emoji: "📦" },
  { label: "Manpower", emoji: "👷" },
  { label: "Equipment", emoji: "🚜" },
  { label: "Multi-Company", emoji: "🏢" },
];

export function AuthFeatureCircles() {
  return (
    <div className="auth-features">
      {FEATURES.map((f) => (
        <div className="auth-feature" key={f.label}>
          <div className="auth-feature-circle">
            <span className="auth-feature-emoji">{f.emoji}</span>
          </div>
          <span>{f.label}</span>
        </div>
      ))}
    </div>
  );
}
