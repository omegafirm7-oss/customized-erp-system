import authBg from "../assets/auth-mountain-lake-night.jpg";

/**
 * Real photo background — night mountain peak reflected in a calm lake
 * under a starry sky (free to use under the Unsplash License). A dark
 * gradient overlay keeps the "Welcome Back" and brand text legible over
 * the sky and water.
 */
export function AuthVisual() {
  return <div className="auth-visual-photo" style={{ backgroundImage: `url(${authBg})` }} />;
}
