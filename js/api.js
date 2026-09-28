/* =====================================================================
   API — komunikasi ke Google Apps Script (fetch + JSON)
   + OUTBOX: antrean perubahan yang dikirim di latar belakang (optimistic UI)
   + MOCK : backend demo di browser saat GAS_URL belum diisi
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const GAS_URL = String(CFG.GAS_URL || '').trim();
  const DEMO = !/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(GAS_URL) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(GAS_URL);

  const Api = {
    demo: DEMO,

    /** Panggil aksi backend. Selalu resolve ke {success, data?, message?, code?} — tidak pernah throw. */
    async call(action, payload) {
      const body = Object.assign({ action, token: Store.s.token }, payload || {});
      if (DEMO) return Mock.handle(body);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CFG.TIMEOUT_MS || 45000);
      try {
        const res = await fetch(GAS_URL, {
          method: 'POST',
          // text/plain = "simple request" → tanpa CORS preflight yang diblokir GAS
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
          redirect: 'follow',
          signal: ctrl.signal
        });
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          return { success: false, message: 'Server tidak mengirim data JSON. Pastikan Web App di-deploy dengan akses "Anyone" dan URL /exec sudah benar.' };
        }
      } catch (err) {
        const offline = !navigator.onLine;
        return {
          success: false, network: true,
          message: err.name === 'AbortError' ? 'Server terlalu lama merespons. Coba lagi.' : (offline ? 'Tidak ada koneksi internet.' : 'Gagal terhubung ke server. Periksa koneksi Anda.')
        };
      } finally {
        clearTimeout(timer);
      }
    },

    /** "Bangunkan" server GAS (cold start) segera saat halaman dibuka. */
    warmup() {
      if (DEMO) return;
      try { fetch(GAS_URL + (GAS_URL.includes('?') ? '&' : '?') + 'action=ping', { method: 'GET', cache: 'no-store' }).catch(() => {}); } catch (e) { /* abaikan */ }
    }
  };

  /* =====================================================================
     OUTBOX — setiap perubahan disimpan lokal dulu (0 ms), lalu dikirim
     berkelompok (batch) ke server. Tahan koneksi putus & tutup aplikasi.
     ===================================================================== */
  const OKEY = 'piagam_outbox_v1';
  const Outbox = {
    ops: [], busy: false, timer: null, retry: 0, lastError: null, listeners: [],
    init() {
      this.ops = U.ls.get(OKEY, []);
      window.addEventListener('online', () => this.schedule(0));
      window.addEventListener('offline', () => this.emit());
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.schedule(0); });
    },
    save() { U.ls.set(OKEY, this.ops); },
    push(op) {
      op.opId = U.uuid();
      op.at = Date.now();
      if (op.type === 'upsert') {
        // Gabungkan dengan upsert lain untuk record yang sama (cukup kirim versi terakhir).
        const prev = this.ops.find((o) => o.type === 'upsert' && o.jenis === op.jenis && o.record.id === op.record.id);
        if (prev) {
          if (!op.template && prev.template) op.template = prev.template;
          this.ops = this.ops.filter((o) => o !== prev);
        }
      } else if (op.type === 'delete') {
        const prev = this.ops.filter((o) => o.type === 'upsert' && o.jenis === op.jenis && o.record.id === op.id);
        prev.forEach((p) => { if (p.template) this.ops.push({ opId: U.uuid(), type: 'saveTemplate', jenis: p.jenis, nomor: p.template.nomor, kepala: p.template.kepala, at: Date.now() }); });
        this.ops = this.ops.filter((o) => !prev.includes(o));
      } else if (op.type === 'saveTemplate' || op.type === 'saveLayout') {
        this.ops = this.ops.filter((o) => !(o.type === op.type && o.jenis === op.jenis));
      } else if (op.type === 'saveSetting') {
        this.ops = this.ops.filter((o) => !(o.type === 'saveSetting' && o.key === op.key));
      }
      this.ops.push(op);
      this.save();
      this.emit();
      this.schedule(0);
    },
    pendingIds(jenis) {
      const set = new Set();
      this.ops.forEach((o) => { if (o.type === 'upsert' && o.jenis === jenis) set.add(o.record.id); });
      return set;
    },
    isPending(jenis, id) { return this.ops.some((o) => o.type === 'upsert' && o.jenis === jenis && o.record.id === id); },
    schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), ms || 0); },
    async flush() {
      if (this.busy || !this.ops.length || !Store.s.token) return;
      if (!navigator.onLine && !DEMO) { this.emit(); return; }
      this.busy = true; this.emit();
      const batch = this.ops.slice(0, 100);
      const res = await Api.call('sync', { ops: batch.map(({ at, ...o }) => o) });
      this.busy = false;
      if (res.success) {
        this.retry = 0; this.lastError = null;
        const sent = new Set(batch.map((o) => o.opId));
        this.ops = this.ops.filter((o) => !sent.has(o.opId));
        this.save();
        const gagal = [];
        (res.data.results || []).forEach((r) => {
          const op = batch.find((o) => o.opId === r.opId);
          if (!op) return;
          if (!r.ok) { gagal.push(r.message); return; }
          if (op.type === 'upsert' && r.record) Data.mergeServer(op.jenis, r.record, this.isPending(op.jenis, r.record.id));
        });
        if (res.data.templates && !this.ops.some((o) => o.template || o.type === 'saveTemplate' || o.type === 'saveSetting')) {
          Store.s.templates = Object.assign(Store.s.templates, res.data.templates);
        }
        Store.s.syncedAt = new Date().toISOString();
        Store.save();
        if (gagal.length) { this.lastError = gagal[0]; if (window.App) App.toast('Sebagian data ditolak server: ' + gagal[0], 'error'); }
        this.emit();
        if (this.ops.length) this.schedule(0);
      } else if (res.code === 'AUTH') {
        this.lastError = res.message; this.emit();
        if (window.App) App.sessionExpired();
      } else {
        this.retry++;
        this.lastError = res.message;
        this.emit();
        this.schedule(Math.min(30000, 1500 * Math.pow(2, this.retry)));
      }
    },
    /** Tunggu antrean kosong (dipakai sebelum logout). */
    async drain(maxMs) {
      const end = Date.now() + (maxMs || 15000);
      while (this.ops.length && Date.now() < end) {
        if (!this.busy) await this.flush();
        await new Promise((r) => setTimeout(r, 250));
        if (this.lastError && !this.busy && this.retry > 0) break;
      }
      return this.ops.length === 0;
    },
    status() {
      if (!navigator.onLine && !DEMO) return this.ops.length ? 'offline' : 'offline-idle';
      if (this.busy) return 'syncing';
      if (this.ops.length && this.lastError) return 'error';
      if (this.ops.length) return 'pending';
      return 'ok';
    },
    on(fn) { this.listeners.push(fn); },
    emit() { this.listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }
  };

  /* =====================================================================
     MOCK — backend demo (localStorage) dengan jeda jaringan buatan,
     supaya alur optimistic UI tetap terasa seperti versi asli.
     ===================================================================== */
  const MKEY = 'piagam_demo_db_v1';
  const Mock = {
    db: null,
    load() {
      if (this.db) return this.db;
      this.db = U.ls.get(MKEY, null) || this.seed();
      return this.db;
    },
    persist() { U.ls.set(MKEY, this.db); },
    seed() {
      const namaDepan = ['Ahmad', 'Muhammad', 'Siti', 'Annisa', 'Rizky', 'Nur', 'Aisyah', 'Fadhil', 'Zahra', 'Dimas', 'Putri', 'Rafi', 'Nabila', 'Hafiz', 'Keisha', 'Bagas', 'Alya', 'Farhan', 'Salsabila', 'Yusuf'];
      const namaBelakang = ['Prasetyo', 'Pratama', 'Rahma Putri', 'Azizah', 'Hidayat', 'Ramadhan', 'Maharani', 'Saputra', 'Kurniawan', 'Lestari', 'Wijaya', 'Nurhaliza', 'Firmansyah', 'Anggraini'];
      const kota = ['Sangatta', 'Bontang', 'Samarinda', 'Bengalon', 'Muara Wahau'];
      const unit = ['Unit Sangatta Utara', 'Unit Sangatta Selatan', 'Unit Teluk Lingga'];
      const desa = ['Teluk Lingga', 'Singa Gembara', 'Swarga Bara', 'Sangatta Utara', 'Sangkima'];
      const rnd = (a) => a[Math.floor(Math.random() * a.length)];
      const pad = (n) => String(n).padStart(3, '0');
      const romawi = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
      const now = new Date();
      const recs = { ahe: [], ala: [] };
      let noAhe = 1, noAla = 1;
      for (let back = 11; back >= 0; back--) {
        const bulan = new Date(now.getFullYear(), now.getMonth() - back, 1);
        const jumlah = { ahe: 2 + Math.floor(Math.random() * 6) + (back < 3 ? 2 : 0), ala: 1 + Math.floor(Math.random() * 4) };
        ['ahe', 'ala'].forEach((j) => {
          for (let i = 0; i < jumlah[j]; i++) {
            const hari = Math.min(1 + Math.floor(Math.random() * 27), back === 0 ? now.getDate() : 28);
            const t = new Date(bulan.getFullYear(), bulan.getMonth(), hari, 8 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60));
            const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
            const no = j === 'ahe' ? noAhe++ : noAla++;
            const base = { id: U.uuid(), nomor: `${pad(no)}/${j.toUpperCase()}-SGT/${romawi[t.getMonth()]}/${t.getFullYear()}`, nama: `${rnd(namaDepan)} ${rnd(namaBelakang)}`, tglLulus: iso, kepala: 'Hj. Sri Wahyuni, S.Pd.', createdAt: t.toISOString(), updatedAt: t.toISOString() };
            if (j === 'ahe') Object.assign(base, { ttl: `${rnd(kota)}, ${1 + Math.floor(Math.random() * 28)} ${U.BULAN[Math.floor(Math.random() * 12)]} ${2017 + Math.floor(Math.random() * 3)}`, unit: rnd(unit) });
            else Object.assign(base, { kelompok: Math.random() < 0.6 ? 'Pertambahan & Pengurangan' : 'Perkalian & Pembagian', desa: rnd(desa) });
            recs[j].push(base);
          }
        });
      }
      const r = romawi[now.getMonth()];
      const db = {
        account: { username: 'admin', password: 'ahe12345', mustChange: true },
        records: recs,
        templates: { ahe: { nomor: `${pad(noAhe)}/AHE-SGT/${r}/${now.getFullYear()}`, kepala: 'Hj. Sri Wahyuni, S.Pd.' }, ala: { nomor: `${pad(noAla)}/ALA-SGT/${r}/${now.getFullYear()}`, kepala: 'Hj. Sri Wahyuni, S.Pd.' }, autoNomor: true },
        layouts: { ahe: null, ala: null },
        files: { ahe: null, ala: null },
        tokens: []
      };
      this.db = db; this.persist();
      return db;
    },
    delay() { return new Promise((r) => setTimeout(r, 350 + Math.random() * 450)); },
    boot() {
      const d = this.db;
      return { user: { username: d.account.username }, mustChange: d.account.mustChange, records: JSON.parse(JSON.stringify(d.records)), templates: JSON.parse(JSON.stringify(d.templates)), layouts: d.layouts, templateFiles: d.files, serverTime: new Date().toISOString() };
    },
    async handle(req) {
      await this.delay();
      const d = this.load();
      const a = req.action;
      if (a === 'login') {
        if (req.username !== d.account.username || req.password !== d.account.password) return { success: false, message: 'Username atau kata sandi salah. Silakan periksa kembali huruf besar dan kecil.' };
        const token = (U.uuid() + U.uuid()).replace(/-/g, '');
        d.tokens = (d.tokens || []).slice(-5).concat(token); this.persist();
        return { success: true, data: Object.assign(this.boot(), { token }) };
      }
      if (!req.token || !(d.tokens || []).includes(req.token)) return { success: false, code: 'AUTH', message: 'Sesi berakhir. Silakan masuk kembali.' };
      switch (a) {
        case 'logout': d.tokens = d.tokens.filter((t) => t !== req.token); this.persist(); return { success: true };
        case 'bootstrap': return { success: true, data: this.boot() };
        case 'sync': {
          const results = (req.ops || []).map((op) => {
            try {
              if (op.type === 'upsert') {
                const r = op.record; const arr = d.records[op.jenis];
                if (!r.nama) throw new Error('Nama Lengkap wajib diisi.');
                const i = arr.findIndex((x) => x.id === r.id); const now = new Date().toISOString();
                const rec = Object.assign({}, r, { createdAt: i >= 0 ? arr[i].createdAt : (r.createdAt || now), updatedAt: now });
                if (i >= 0) arr[i] = rec; else arr.push(rec);
                if (op.template) d.templates[op.jenis] = { nomor: op.template.nomor, kepala: op.template.kepala };
                return { opId: op.opId, ok: true, record: rec };
              }
              if (op.type === 'delete') { d.records[op.jenis] = d.records[op.jenis].filter((x) => x.id !== op.id); return { opId: op.opId, ok: true }; }
              if (op.type === 'saveTemplate') { d.templates[op.jenis] = { nomor: op.nomor, kepala: op.kepala }; return { opId: op.opId, ok: true }; }
              if (op.type === 'saveLayout') { d.layouts[op.jenis] = op.layout || null; return { opId: op.opId, ok: true }; }
              if (op.type === 'saveSetting') { d.templates.autoNomor = op.value !== 'tidak'; return { opId: op.opId, ok: true }; }
              throw new Error('Operasi tidak dikenal');
            } catch (e) { return { opId: op.opId, ok: false, message: e.message }; }
          });
          this.persist();
          return { success: true, data: { results, templates: d.templates } };
        }
        case 'changeAccount': {
          if (req.oldPassword !== d.account.password) return { success: false, message: 'Kata sandi lama salah.' };
          const u = String(req.newUsername || '').trim() || d.account.username;
          if (!/^[A-Za-z0-9_.\-]{3,40}$/.test(u)) return { success: false, message: 'Username 3–40 karakter: huruf, angka, titik, garis bawah, atau strip.' };
          if (req.newPassword) {
            if (req.newPassword.length < 8) return { success: false, message: 'Kata sandi baru minimal 8 karakter.' };
            d.account.password = req.newPassword; d.account.mustChange = false;
          }
          d.account.username = u; this.persist();
          return { success: true, message: 'Akun admin berhasil diperbarui.', data: { username: u, mustChange: d.account.mustChange } };
        }
        case 'uploadTemplate': {
          const meta = { id: 'demo-' + req.jenis, name: (req.jenis === 'ahe' ? 'Piagam_Ahe_1' : 'Piagam_Ala_1') + (req.mime === 'image/png' ? '.png' : '.jpg'), mime: req.mime, size: Math.round(req.base64.length * 0.75), version: 'demo-' + Date.now() };
          await U.idb.set('demo_tpl_' + req.jenis, { meta, base64: req.base64 });
          d.files[req.jenis] = meta; this.persist();
          return { success: true, message: 'Template berhasil diganti.', data: meta };
        }
        case 'getTemplate': {
          const v = await U.idb.get('demo_tpl_' + req.jenis);
          if (!v) return { success: true, data: null };
          return { success: true, data: { meta: v.meta, mime: v.meta.mime, base64: v.base64 } };
        }
        default: return { success: false, message: 'Aksi tidak dikenal: ' + a };
      }
    }
  };

  window.Api = Api;
  window.Outbox = Outbox;
})();
