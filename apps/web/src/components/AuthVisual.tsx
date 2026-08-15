import authBg from "../assets/auth-alula-desert.jpg";
import kingdomCentre from "../assets/landmark-kingdom-centre.jpg";
import alFaisaliah from "../assets/landmark-al-faisaliah.jpg";

/**
 * The auth gateway's background, in three layers.
 *
 * Base: an aerial view of the AlUla desert rock formations at sunrise (NEOM,
 * free to use under the Unsplash License), re-encoded from the 4 MB original
 * down to ~415 KB at 2200px — a login page is the first thing every user
 * waits on, and nobody can see 5272px of detail.
 *
 * Over it, Kingdom Centre and Al Faisaliah are composited into the lower
 * corners rather than framed as separate thumbnails: each is masked with a
 * radial fade so its edges dissolve into the sand instead of ending on a
 * hard rectangle, and held well below full opacity so it reads as part of
 * the scene. Doing this in CSS rather than baking one flat image keeps each
 * photo swappable and the fade tunable.
 *
 * All three sit under `.auth-page-overlay`, which does the darkening that
 * keeps the wordmark legible.
 */
export function AuthVisual() {
  return (
    <>
      <div className="auth-visual-photo" style={{ backgroundImage: `url(${authBg})` }} />
      <div className="auth-visual-landmark left" style={{ backgroundImage: `url(${kingdomCentre})` }} />
      <div className="auth-visual-landmark right" style={{ backgroundImage: `url(${alFaisaliah})` }} />
    </>
  );
}
