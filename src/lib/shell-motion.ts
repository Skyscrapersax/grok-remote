// Top-bar and surface intros. Called explicitly — never at import time.
import gsap from 'gsap';
import anime from '../vendor/anime.es.js';

const CHROME_CLEAR = 'opacity,transform,visibility';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clearChrome(targets: Element[]): void {
  if (!targets.length) return;
  try { gsap.set(targets, { clearProps: CHROME_CLEAR }); } catch { /* ignore */ }
}

/** GSAP sequence for brand, status, theme toggle, settings. Anime staggers hamburger marks. */
export function playShellMotion(): void {
  const brand = document.querySelector('#brand-link');
  const status = document.querySelector('#status');
  const theme = document.querySelector('#theme-toggle');
  const settings = document.querySelector('#open-settings');
  const chrome = [brand, status, theme, settings].filter((n): n is Element => !!n);
  const reduce = prefersReducedMotion();

  try {
    if (!reduce) {
      const tl = gsap.timeline({
        defaults: { duration: 0.4, ease: 'power2.out', clearProps: CHROME_CLEAR },
      });
      if (brand) tl.from(brand, { opacity: 0, y: -8 }, 0);
      if (status) tl.from(status, { opacity: 0, y: -6 }, 0.06);
      if (theme) tl.from(theme, { opacity: 0, y: -6 }, 0.12);
      if (settings) tl.from(settings, { opacity: 0, y: -6 }, 0.18);
    }
  } catch {
    clearChrome(chrome);
  }

  const marks = document.querySelectorAll('#hamburger-btn > span');
  if (reduce || !marks.length) return;
  try {
    anime({
      targets: marks,
      translateY: [-4, 0],
      opacity: [0, 1],
      delay: anime.stagger(45),
      duration: 280,
      easing: 'easeOutQuad',
    });
  } catch {
    marks.forEach((node) => {
      const el = node as HTMLElement;
      el.style.opacity = '';
      el.style.transform = '';
    });
  }
}

/** Header, toolbar, board, dispatch — once per dash mount, not on the poll. */
export function playDashMotion(root: ParentNode): void {
  const header = root.querySelector('.dash-header');
  const toolbar = root.querySelector('.dash-toolbar');
  const board = root.querySelector('.dash-board');
  const dispatch = root.querySelector('.dash-dispatch');
  const parts = [header, toolbar, board, dispatch].filter((n): n is Element => !!n);
  if (prefersReducedMotion()) {
    clearChrome(parts);
    return;
  }
  try {
    const tl = gsap.timeline({
      defaults: { duration: 0.42, ease: 'power2.out', clearProps: CHROME_CLEAR },
    });
    if (header) tl.from(header, { opacity: 0, y: 10 }, 0);
    if (toolbar) tl.from(toolbar, { opacity: 0, y: 8 }, 0.07);
    if (board) tl.from(board, { opacity: 0, y: 12 }, 0.12);
    if (dispatch) tl.from(dispatch, { opacity: 0, y: 10 }, 0.18);
  } catch {
    clearChrome(parts);
  }
}

/** Anime stagger of .dash-row. Caller runs this once on first paint. */
export function staggerDashRows(rows: ArrayLike<Element>): void {
  const list = Array.from(rows);
  if (!list.length || prefersReducedMotion()) return;
  try {
    anime({
      targets: list,
      opacity: [0, 1],
      translateY: [8, 0],
      delay: anime.stagger(36),
      duration: 320,
      easing: 'easeOutQuad',
    });
  } catch {
    for (const row of list) {
      const el = row as HTMLElement;
      el.style.opacity = '';
      el.style.transform = '';
    }
  }
}

/** Deck hero is GSAP. The four deck cards are an Anime.js stagger. */
export function playDeckMotion(root: ParentNode): void {
  const hero = root.querySelector('.deck-hero');
  const cards = root.querySelectorAll('.deck-card');
  if (prefersReducedMotion()) {
    if (hero) clearChrome([hero]);
    return;
  }
  try {
    if (hero) {
      gsap.from(hero, {
        opacity: 0,
        y: 12,
        duration: 0.48,
        ease: 'power2.out',
        clearProps: CHROME_CLEAR,
      });
    }
  } catch {
    if (hero) clearChrome([hero]);
  }
  if (!cards.length) return;
  try {
    anime({
      targets: cards,
      opacity: [0, 1],
      translateY: [14, 0],
      delay: anime.stagger(70),
      duration: 380,
      easing: 'easeOutCubic',
    });
  } catch {
    cards.forEach((node) => {
      const el = node as HTMLElement;
      el.style.opacity = '';
      el.style.transform = '';
    });
  }
}
