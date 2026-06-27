/**
 * Simple Web Tools — Core App Module
 * --------------------------------------------------------------------------
 * Shared across every page. Exports utilities that tool scripts import.
 *
 * Responsibilities:
 *   - Theme manager (light/dark/system) persisted in Local Storage.
 *   - Name-only "login": save username, guard pages, auto-redirect.
 *   - Shared navbar + hamburger menu (injected where a mount point exists).
 *   - Reusable helpers: $, $$, toast(), setLoading(), formatting, storage.
 *
 * Local Storage keys:
 *   swt-theme : 'light' | 'dark' | 'system'
 *   swt-user  : the user's display name (string)
 *
 * Usage in a tool file:
 *   import { $, toast, formatNumber } from '/js/script.js';
 * --------------------------------------------------------------------------
 */

/* ==========================================================================
   0. Constants
   ========================================================================== */
export const STORAGE_KEYS = Object.freeze({
  THEME: 'swt-theme',
  USER: 'swt-user',
});

export const ROUTES = Object.freeze({
  LOGIN: '/index.html',
  DASHBOARD: '/pages/dashboard.html',
});

/* ==========================================================================
   1. Tiny DOM helpers
   ========================================================================== */
/** querySelector shorthand. */
export const $ = (sel, root = document) => root.querySelector(sel);

/** querySelectorAll -> real array. */
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Create an element with attributes + children.
 * @param {string} tag
 * @param {Object} [attrs]  - attributes; `class`, `text`, `html`, dataset, events (onX)
 * @param {Array<Node|string>} [children]
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ==========================================================================
   2. Safe Local Storage wrapper
   (Some browsers/privacy modes throw on access; never crash the app.)
   ========================================================================== */
export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
  clearApp() {
    // Remove only this app's keys (used by Settings "Clear Local Storage").
    try {
      Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
      return true;
    } catch {
      return false;
    }
  },
};

/* ==========================================================================
   3. Formatting utilities (reused by calculators)
   ========================================================================== */
/** Format a number with thousands separators and fixed decimals. */
export function formatNumber(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a value as currency (default INR; symbol overridable). */
export function formatCurrency(value, currency = 'INR', locale = 'en-IN') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  try {
    return n.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
  } catch {
    return `₹${formatNumber(n, 0)}`;
  }
}

/** Clamp a number between min and max. */
export const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

/** Escape text for safe insertion into HTML. */
export function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ==========================================================================
   4. Theme manager
   ========================================================================== */
const prefersDark = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Resolve a stored preference ('light'|'dark'|'system') to an applied theme. */
function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return prefersDark() ? 'dark' : 'light';
}

export const theme = {
  /** The raw stored preference. */
  getPreference() {
    const p = storage.get(STORAGE_KEYS.THEME, 'system');
    return ['light', 'dark', 'system'].includes(p) ? p : 'system';
  },

  /** The currently applied theme ('light'|'dark'). */
  getApplied() {
    return document.documentElement.getAttribute('data-theme') || resolveTheme(this.getPreference());
  },

  /** Apply a preference, persist it, and update the DOM + toggles. */
  set(pref) {
    const preference = ['light', 'dark', 'system'].includes(pref) ? pref : 'system';
    storage.set(STORAGE_KEYS.THEME, preference);
    const applied = resolveTheme(preference);
    document.documentElement.setAttribute('data-theme', applied);
    syncThemeToggles(applied);
    // Notify any listeners (e.g. charts that need recolouring).
    window.dispatchEvent(new CustomEvent('swt:themechange', { detail: { applied, preference } }));
  },

  /** Toggle between light and dark (used by the header switch). */
  toggle() {
    this.set(this.getApplied() === 'dark' ? 'light' : 'dark');
  },

  /** Initialize: apply stored theme + keep "system" in sync with OS changes. */
  init() {
    this.set(this.getPreference());
    if (window.matchMedia) {
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', () => {
          if (this.getPreference() === 'system') this.set('system');
        });
    }
  },
};

/** Reflect applied theme on any theme toggle buttons present. */
function syncThemeToggles(applied) {
  $$('.theme-toggle').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(applied === 'dark'));
  });
}

/* ==========================================================================
   5. Auth (name-only)
   ========================================================================== */
export const auth = {
  /** @returns {string|null} the stored username (trimmed) or null. */
  getUser() {
    const u = storage.get(STORAGE_KEYS.USER);
    return u && u.trim() ? u.trim() : null;
  },

  isLoggedIn() {
    return this.getUser() !== null;
  },

  /** Save the username. @returns {boolean} success. */
  login(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!clean) return false;
    return storage.set(STORAGE_KEYS.USER, clean);
  },

  logout() {
    storage.remove(STORAGE_KEYS.USER);
    window.location.assign(ROUTES.LOGIN);
  },

  /** Redirect to login if not authenticated (call on protected pages). */
  requireAuth() {
    if (!this.isLoggedIn()) {
      window.location.replace(ROUTES.LOGIN);
      return false;
    }
    return true;
  },

  /** Redirect to dashboard if already logged in (call on the login page). */
  redirectIfLoggedIn() {
    if (this.isLoggedIn()) {
      window.location.replace(ROUTES.DASHBOARD);
      return true;
    }
    return false;
  },
};

/* ==========================================================================
   6. Toast notifications
   ========================================================================== */
let toastStack = null;
function ensureToastStack() {
  if (toastStack && document.body.contains(toastStack)) return toastStack;
  toastStack = $('.toast-stack') || el('div', { class: 'toast-stack', 'aria-live': 'polite' });
  if (!toastStack.isConnected) document.body.appendChild(toastStack);
  return toastStack;
}

/**
 * Show a transient toast.
 * @param {string} message
 * @param {'info'|'success'|'error'} [type]
 * @param {number} [duration] ms
 */
export function toast(message, type = 'info', duration = 3200) {
  const stack = ensureToastStack();
  const node = el('div', {
    class: `toast toast--${type}`,
    role: type === 'error' ? 'alert' : 'status',
    text: message,
  });
  stack.appendChild(node);
  const remove = () => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 220);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

/* ==========================================================================
   7. Loading-state helpers
   ========================================================================== */
/** Toggle a button's loading state (requires .btn-spinner inside). */
export function setButtonLoading(button, isLoading) {
  if (!button) return;
  button.classList.toggle('is-loading', !!isLoading);
  button.disabled = !!isLoading;
  button.setAttribute('aria-busy', String(!!isLoading));
}

/** Toggle a `.loading-overlay` inside a relatively-positioned container. */
export function setLoading(container, isLoading, message = 'Loading…') {
  if (!container) return;
  let overlay = $('.loading-overlay', container);
  if (!overlay) {
    overlay = el('div', { class: 'loading-overlay', 'aria-live': 'polite' }, [
      el('div', { class: 'stack', style: 'align-items:center;gap:.5rem' }, [
        el('span', { class: 'spinner', role: 'status', 'aria-label': message }),
        el('span', { class: 'text-soft', text: message }),
      ]),
    ]);
    const cs = getComputedStyle(container);
    if (cs.position === 'static') container.style.position = 'relative';
    container.appendChild(overlay);
  }
  overlay.classList.toggle('is-active', !!isLoading);
}

/* ==========================================================================
   8. Navbar + hamburger menu
   ========================================================================== */
/** Navigation items shared across the app (single source of truth). */
export const NAV_ITEMS = Object.freeze([
  { label: 'Dashboard', href: '/pages/dashboard.html' },
  { label: 'Student Tools', href: '/pages/student.html' },
  { label: 'Finance', href: '/pages/finance.html' },
  { label: 'Food', href: '/pages/food.html' },
  { label: 'Image Tools', href: '/pages/image.html' },
  { label: 'PDF Tools', href: '/pages/pdf.html' },
  { label: 'Settings', href: '/pages/settings.html' },
  { label: 'About', href: '/pages/about.html' },
]);

/**
 * Render the navbar into an element with id="navbar".
 * Highlights the current page, wires the hamburger menu + theme toggle + logout.
 */
export function renderNavbar() {
  const mount = document.getElementById('navbar');
  if (!mount) return;

  const here = window.location.pathname.replace(/\/index\.html$/, '/');
  const user = auth.getUser();

  // Build link list
  const links = NAV_ITEMS.map((item) => {
    const isCurrent =
      here === item.href || here === item.href.replace(/\.html$/, '');
    return el(
      'a',
      { href: item.href, ...(isCurrent ? { 'aria-current': 'page' } : {}) },
      item.label
    );
  });

  const navLinks = el('nav', { class: 'nav-links', id: 'navLinks', 'aria-label': 'Primary' }, [
    user ? el('span', { class: 'nav-user', text: `Hi, ${user}` }) : null,
    ...links,
    el(
      'button',
      { class: 'btn btn-danger btn-sm', type: 'button', id: 'logoutBtn' },
      'Logout'
    ),
  ]);

  const toggleBtn = el('button', {
    class: 'nav-toggle',
    id: 'navToggle',
    type: 'button',
    'aria-label': 'Open menu',
    'aria-controls': 'navLinks',
    'aria-expanded': 'false',
  }, [el('span')]);

  const themeBtn = el(
    'button',
    {
      class: 'theme-toggle',
      id: 'themeToggle',
      type: 'button',
      'aria-label': 'Toggle dark and light theme',
      title: 'Toggle theme',
    },
    [
      el('span', { class: 'theme-icon theme-icon--sun', 'aria-hidden': 'true', text: '☀️' }),
      el('span', { class: 'theme-icon theme-icon--moon', 'aria-hidden': 'true', text: '🌙' }),
    ]
  );

  const brand = el('a', { class: 'brand', href: '/pages/dashboard.html', 'aria-label': 'Simple Web Tools home' }, [
    el('span', { class: 'brand-mark', 'aria-hidden': 'true', text: '🧰' }),
    el('span', { class: 'brand-text', text: 'Simple Web Tools' }),
  ]);

  const backdrop = el('div', { class: 'nav-backdrop', id: 'navBackdrop', 'aria-hidden': 'true' });

  mount.classList.add('navbar');
  mount.replaceChildren(brand, el('span', { class: 'nav-spacer' }), themeBtn, toggleBtn, navLinks);
  if (!document.getElementById('navBackdrop')) document.body.appendChild(backdrop);

  wireNavbar();
  syncThemeToggles(theme.getApplied());
}

/** Attach interaction handlers for the rendered navbar. */
function wireNavbar() {
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  const backdrop = document.getElementById('navBackdrop');

  const closeMenu = () => {
    links?.classList.remove('is-open');
    backdrop?.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', 'Open menu');
  };
  const openMenu = () => {
    links?.classList.add('is-open');
    backdrop?.classList.add('is-open');
    toggle?.setAttribute('aria-expanded', 'true');
    toggle?.setAttribute('aria-label', 'Close menu');
  };

  toggle?.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    isOpen ? closeMenu() : openMenu();
  });
  backdrop?.addEventListener('click', closeMenu);

  // Close on navigation click (mobile) and on Escape.
  links?.addEventListener('click', (e) => {
    if (e.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  // Theme toggle
  document.getElementById('themeToggle')?.addEventListener('click', () => theme.toggle());

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', () => auth.logout());
}

/* ==========================================================================
   9. Footer year (any element with id="footerYear")
   ========================================================================== */
function setFooterYear() {
  const year = String(new Date().getFullYear());
  $$('#footerYear').forEach((node) => (node.textContent = year));
}

/* ==========================================================================
   10. Landing-page login wiring
   ========================================================================== */
function initLoginPage() {
  const form = document.getElementById('loginForm');
  if (!form) return false; // not the login page

  // Already logged in? Go straight to the dashboard.
  if (auth.redirectIfLoggedIn()) return true;

  const input = document.getElementById('nameInput');
  const errorEl = document.getElementById('nameError');
  const button = document.getElementById('continueBtn');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (input?.value || '').trim();

    if (!name) {
      if (errorEl) errorEl.textContent = 'Please enter your name to continue.';
      input?.focus();
      return;
    }
    if (name.length < 2) {
      if (errorEl) errorEl.textContent = 'Name must be at least 2 characters.';
      input?.focus();
      return;
    }

    if (errorEl) errorEl.textContent = '';
    setButtonLoading(button, true);

    if (auth.login(name)) {
      // Small delay so the loading state is visible, then redirect.
      setTimeout(() => window.location.assign(ROUTES.DASHBOARD), 250);
    } else {
      setButtonLoading(button, false);
      if (errorEl) {
        errorEl.textContent =
          'Could not save your name (storage blocked). Please enable site storage.';
      }
    }
  });

  // Clear error as the user types.
  input?.addEventListener('input', () => {
    if (errorEl && errorEl.textContent) errorEl.textContent = '';
  });

  return true;
}

/* ==========================================================================
   11. "Welcome back" greeting (any element with id="welcomeMsg")
   ========================================================================== */
function initWelcome() {
  const node = document.getElementById('welcomeMsg');
  if (!node) return;
  const user = auth.getUser();
  if (user) node.textContent = `Welcome back, ${user}`;
}

/* ==========================================================================
   12. Page bootstrapping
   ========================================================================== */
/**
 * Pages can declare requirements via <body data-*> attributes:
 *   data-page="login"     -> wires the login form (no auth guard)
 *   data-requires-auth    -> redirects to login if not authenticated
 *   data-nav              -> renders the shared navbar
 * If none are present we still apply theme + footer year safely.
 */
function bootstrap() {
  theme.init();

  const body = document.body;
  const isLoginPage = body.dataset.page === 'login' || !!document.getElementById('loginForm');

  // Auth guard for protected pages (everything that isn't the login page
  // and opts in via data-requires-auth, defaulting to guarded for app pages).
  if (!isLoginPage && body.hasAttribute('data-requires-auth')) {
    if (!auth.requireAuth()) return; // redirecting away
  }

  if (isLoginPage) {
    initLoginPage();
  }

  if (document.getElementById('navbar')) renderNavbar();
  // Standalone theme toggle on pages without a full navbar (e.g. landing).
  if (!document.getElementById('navbar')) {
    document.getElementById('themeToggle')?.addEventListener('click', () => theme.toggle());
  }

  initWelcome();
  setFooterYear();
}

// Run after DOM is ready (module scripts are deferred, but guard anyway).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

/* Expose a minimal namespace for non-module/inline usage if ever needed. */
window.SWT = Object.freeze({
  $, $$, el, storage, theme, auth, toast, setLoading, setButtonLoading,
  formatNumber, formatCurrency, clamp, escapeHtml, NAV_ITEMS, ROUTES, STORAGE_KEYS,
});
