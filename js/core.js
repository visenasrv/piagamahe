/* =====================================================================
   CORE — utilitas, penyimpanan lokal, IndexedDB, dan state aplikasi
   ===================================================================== */
(function () {
  'use strict';

  const U = {};
  U.$ = (s, r) => (r || document).querySelector(s);
  U.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.uuid = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; });
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  U.ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
  };

  U.debounce = (fn, ms) => { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };
  U.idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 300));
  U.raf = (fn) => { let q = false; return (...a) => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...a); }); }; };

  // ---------- Tanggal ----------
  U.BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  U.BULAN_S = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  U.isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  U.fmtTgl = (s) => {
    if (!U.isISODate(s)) return String(s || '');
    const [y, m, d] = s.split('-').map(Number);
    return `${d} ${U.BULAN[m - 1]} ${y}`;
  };
  U.fmtTglPendek = (s) => {
    if (!s) return '';
    let d;
    if (U.isISODate(s)) { const [y, m, dd] = s.split('-').map(Number); d = new Date(y, m - 1, dd); } else d = new Date(s);
    if (isNaN(d)) return String(s);
    return `${d.getDate()} ${U.BULAN_S[d.getMonth()]} ${d.getFullYear()}`;
  };
  U.todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- Teks ----------
  U.initials = (name) => {
    const w = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
  };
  /** Naikkan kelompok angka pertama: "045/AHE/IX/2026" → "046/AHE/IX/2026" (lebar nol di depan dipertahankan). */
  U.nomorBerikutnya = (nomor) => {
    const m = String(nomor || '').match(/^(\D*)(\d+)(.*)$/);
    if (!m) return String(nomor || '');
    const n = String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0');
    return m[1] + n + m[3];
  };
  U.namaFile = (jenis, nama, ext) => {
    const bersih = String(nama || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Tanpa_Nama';
    return `Piagam-${jenis === 'ala' ? 'Ala' : 'Ahe'}_${bersih}.${ext}`;
  };
  U.isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ---------- File & unduhan ----------
  U.download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    if ('download' in a) {
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } else {
      window.open(url, '_blank');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  U.blobToBase64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  U.base64ToBlob = (b64, mime) => {
    const bin = atob(b64); const len = bin.length; const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/octet-stream' });
  };
  const scriptCache = {};
  U.loadScript = (src) => scriptCache[src] || (scriptCache[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => { delete scriptCache[src]; rej(new Error('Gagal memuat pustaka. Periksa koneksi internet.')); };
    document.head.appendChild(s);
  }));

  // ---------- IndexedDB (cache gambar template) ----------
  let dbP = null;
  const db = () => dbP || (dbP = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('IndexedDB tidak tersedia'));
    const req = indexedDB.open('piagam-ahe', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
  const tx = (mode, fn) => db().then((d) => new Promise((res, rej) => {
    const t = d.transaction('kv', mode); const st = t.objectStore('kv'); const r = fn(st);
    t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  U.idb = {
    get: (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)).catch(() => undefined),
    del: (k) => tx('readwrite', (s) => s.delete(k)).catch(() => undefined)
  };

  window.U = U;

  /* =====================================================================
     STORE — state aplikasi, disimpan di localStorage (stale-while-revalidate)
     ===================================================================== */
  const KEY = 'piagam_state_v1';
  const kosong = () => ({
    token: null, user: null, mustChange: false,
    records: { ahe: [], ala: [] },
    templates: { ahe: { nomor: '', kepala: '' }, ala: { nomor: '', kepala: '' }, autoNomor: true },
    layouts: { ahe: null, ala: null },
    templateFiles: { ahe: null, ala: null },
    lastActive: 0, syncedAt: null
  });

  const Store = {
    s: kosong(),
    listeners: [],
    load() {
      const v = U.ls.get(KEY, null);
      this.s = Object.assign(kosong(), v || {});
      this.s.records = Object.assign({ ahe: [], ala: [] }, this.s.records || {});
      return this.s;
    },
    saveNow() { U.ls.set(KEY, this.s); },
    save: null,
    /** Terapkan data dari server (login/bootstrap). Operasi yang belum tersinkron tetap dipertahankan. */
    applyServer(data, pendingOps) {
      const s = this.s;
      if (data.token) s.token = data.token;
      s.user = data.user || s.user;
      s.mustChange = !!data.mustChange;
      s.templateFiles = data.templateFiles || { ahe: null, ala: null };
      s.layouts = data.layouts || { ahe: null, ala: null };
      s.syncedAt = data.serverTime || new Date().toISOString();

      const ops = pendingOps || [];
      ['ahe', 'ala'].forEach((j) => {
        const server = (data.records && data.records[j]) || [];
        const map = new Map(server.map((r) => [r.id, r]));
        ops.forEach((o) => {
          if (o.jenis !== j) return;
          if (o.type === 'upsert') map.set(o.record.id, o.record);
          if (o.type === 'delete') map.delete(o.id);
        });
        s.records[j] = Array.from(map.values());
      });

      const t = data.templates || {};
      const pendTpl = ops.some((o) => o.template || o.type === 'saveTemplate');
      if (!pendTpl) { s.templates.ahe = t.ahe || s.templates.ahe; s.templates.ala = t.ala || s.templates.ala; }
      if (!ops.some((o) => o.type === 'saveSetting') && typeof t.autoNomor === 'boolean') s.templates.autoNomor = t.autoNomor;
      this.saveNow();
      this.emit();
    },
    clear() {
      const keep = { lastUser: this.s.user && this.s.user.username };
      this.s = kosong();
      U.ls.del(KEY);
      return keep;
    },
    touch() { this.s.lastActive = Date.now(); },
    on(fn) { this.listeners.push(fn); },
    emit() { this.listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }
  };
  Store.save = U.debounce(() => Store.saveNow(), 120);

  // ---------- Data piagam ----------
  const Data = {
    list: (j) => Store.s.records[j] || [],
    find: (j, id) => (Store.s.records[j] || []).find((r) => r.id === id) || null,
    sorted: (j) => Data.list(j).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    upsert(j, rec) {
      const arr = Store.s.records[j];
      const i = arr.findIndex((r) => r.id === rec.id);
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      Store.save(); Store.emit();
    },
    remove(j, id) {
      Store.s.records[j] = Data.list(j).filter((r) => r.id !== id);
      Store.save(); Store.emit();
    },
    /** Ganti record lokal dengan versi server (tanpa menimpa perubahan yang masih antre). */
    mergeServer(j, rec, pending) {
      const arr = Store.s.records[j];
      const i = arr.findIndex((r) => r.id === rec.id);
      if (i < 0) return;
      if (pending) arr[i] = Object.assign({}, arr[i], { createdAt: rec.createdAt });
      else arr[i] = rec;
    }
  };

  window.Store = Store;
  window.Data = Data;
})();
