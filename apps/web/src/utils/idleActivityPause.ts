// A shared "hold" a component can take out while the user is legitimately
// away from the keyboard/mouse for a real reason (right now: waiting on a
// phone-camera photo upload) — used by IdleTimeoutGuard's own tick to skip
// its elapsed-time check entirely and keep heartbeating, rather than
// relying on some other component's timer firing at just the right cadence
// to look like activity. A reference count, not a boolean, so two
// overlapping holds (e.g. two AttachButton instances mid-flow at once)
// can't have one's `resume` end the other's pause early.
let pauseCount = 0;

export function pauseIdleTimeout(): void {
  pauseCount += 1;
}

export function resumeIdleTimeout(): void {
  pauseCount = Math.max(0, pauseCount - 1);
}

export function isIdleTimeoutPaused(): boolean {
  return pauseCount > 0;
}
