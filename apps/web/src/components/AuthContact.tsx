import { useState } from "react";

const WHATSAPP_NUMBER = "966554037271";
const WHATSAPP_DISPLAY = "+966 55 403 7271";
const EMAIL = "connect@omegaprofessionals.com";

/**
 * "Contact us" under the sign-in panel. The number and address are hidden
 * until the visitor asks for them — a login page is a public, crawled URL,
 * and leaving contact details in the markup is an open invitation to
 * scrapers. Revealing on click keeps them out of the initial DOM.
 */
export function AuthContact() {
  const [open, setOpen] = useState(false);

  return (
    <div className="auth-contact">
      {open ? (
        <div className="auth-contact-details">
          <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
              <path d="M3 21l1.7-5A8.2 8.2 0 1 1 8 19.4L3 21z" />
              <path d="M9 9.2c.3 2.6 3.2 5.5 5.8 5.8l1-1.4 2 .9-.4 1.6c-2.9.7-7.9-3.5-8.9-6.4l1.6-.5.9 2z" />
            </svg>
            {WHATSAPP_DISPLAY}
          </a>
          <a href={`mailto:${EMAIL}`}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
              <path d="M3 6.5h18v11H3z" />
              <path d="M3 7l9 6 9-6" />
            </svg>
            {EMAIL}
          </a>
        </div>
      ) : (
        <button type="button" className="auth-contact-trigger" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9">
            <path d="M3 6.5h18v11H3z" />
            <path d="M3 7l9 6 9-6" />
          </svg>
          Questions about Universa? <b>Contact us</b>
        </button>
      )}
    </div>
  );
}
