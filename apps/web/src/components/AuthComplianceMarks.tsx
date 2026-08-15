import vision2030 from "../assets/logo-vision-2030.webp";
import zatca from "../assets/logo-zatca-official.png";
import fatoora from "../assets/logo-fatoora.webp";

/**
 * Vision 2030 / ZATCA / Fatoora marks, small, along the top of the auth
 * gateway.
 *
 * Note for whoever maintains this: these are Saudi government marks, and
 * showing them reads as endorsement or certification of Universa by those
 * bodies. Universa is genuinely ZATCA Phase 2 integrated (verified against
 * ZATCA's live sandbox), but integrated is not endorsed, and Vision 2030
 * branding carries its own usage rules. Displaying them here was an explicit
 * decision by the business owner. The zero-risk alternative, if that position
 * ever changes, is the ZATCA PHASE 2 COMPLIANT text pill in AuthTrustBadges,
 * which claims exactly what is true and needs nobody's permission.
 *
 * The source files have solid white backgrounds rather than transparency, so
 * each sits on its own white chip — which is also how these marks are
 * normally presented.
 *
 * The ZATCA file is the official horizontal lockup from zatca.gov.sa (the
 * "Logo - Light Background" pack), whitespace-trimmed. It replaced a copy
 * that was cropped mid-word on both sides — the Arabic was missing its
 * leading هي and trailing ك, the English its Z and y. At 4.5:1 it is far
 * wider than the other two, so `wide` gives it its own smaller height:
 * matching all three on height would leave it dwarfing them.
 */
const MARKS = [
  { src: vision2030, alt: "Saudi Vision 2030", wide: false },
  { src: zatca, alt: "Zakat, Tax and Customs Authority", wide: true },
  { src: fatoora, alt: "Fatoora", wide: false },
];

export function AuthComplianceMarks() {
  return (
    <div className="auth-marks">
      {MARKS.map((m) => (
        <span className={m.wide ? "auth-mark wide" : "auth-mark"} key={m.alt}>
          <img src={m.src} alt={m.alt} />
        </span>
      ))}
    </div>
  );
}
