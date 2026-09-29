/* ============================================================
   save.js — a very small, very polite local store.
   If the browser refuses us storage (private mode, blocked
   cookies, an old phone) nothing breaks; the walk still works,
   it just forgets where you found things.
   ============================================================ */

const KEY = 'shire-walker.v1';

const DEFAULTS = {
  quality: null,          // null = choose for this device
  cycle: true,
  phase: null,            // null = the default hour
  pace: 1.0,
  muted: false,
  found: [],
  photoHintShown: false,
  visits: 0
};

export class Save {
  constructor() {
    this.available = false;
    this.data = { ...DEFAULTS };
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') this.data = { ...DEFAULTS, ...parsed };
      }
      this.available = true;
    } catch {
      this.available = false;
    }
    this.data.visits = (this.data.visits | 0) + 1;
    this._pending = null;
  }

  get(k) { return this.data[k]; }

  set(k, v) {
    this.data[k] = v;
    this.flush();
  }

  flush() {
    if (!this.available) return;
    if (this._pending) return;
    this._pending = setTimeout(() => {
      this._pending = null;
      try { window.localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* full or blocked */ }
    }, 220);
  }

  clear() {
    this.data = { ...DEFAULTS, visits: this.data.visits };
    try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  }
}
