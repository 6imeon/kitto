// Stretch-reminder banner (M4) — the visible nudge that tells *you* to stretch while
// the cat stretches alongside.
//
// Unlike the reminder banner (MA-2) this is purely passive: a big "STRETCH!" flashed
// in the centre of the screen for the length of the stretch, with no buttons. It's
// `pointer-events: none`, so it never intercepts clicks meant for the desktop and the
// window's click-through doesn't need reconciling — we can show/hide it freely on the
// stretch timer's rising/falling edge.

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`stretch banner: missing #${id}`);
  return node as T;
}

export class StretchBanner {
  private readonly root = el<HTMLDivElement>("stretch-banner");

  /** Flash (or hide) the "STRETCH!" nudge — driven by the stretch timer's edge. */
  setVisible(active: boolean): void {
    this.root.hidden = !active;
  }
}
