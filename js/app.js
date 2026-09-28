/* =====================================================================
   APP — SPA Piagam AHE
   Prinsip instan: navigasi tanpa server (0 ms), simpan optimistis
   (UI dulu, server di latar belakang), data & template di cache lokal.
   ===================================================================== */
(function () {
  'use strict';
  const { $, $$, esc } = U;
  const CFG = window.APP_CONFIG || {};
  const JENIS_LABEL = { ahe: 'Ahe', ala: 'Ala' };
  const mqWide = window.matchMedia('(min-width: 1100px)');
  const mqTable = window.matchMedia('(min-width: 1024px)');
  const ui = { justSaved: null, page: null, lastBoot: 0 };

  /* =====================================================================
     TOAST & SHEET (bottom sheet di HP, modal di desktop)
     ===================================================================== */
  function toast(msg, type, ms) {
    type = type || 'success';
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML = `<svg class="ic"><use href="#i-${type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check'}"/></svg><span>${esc(msg)}</span>`;
    const root = $('#toast-root');
    while (root.children.length > 2) root.firstChild.remove();
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, ms || (type === 'error' ? 4200 : 2600));
  }

  const Sheet = {
    open(o) {
      return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'overlay';
        const acts = o.actions || [];
        wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
          <div class="sheet-grip"></div>
          <div class="sheet-head">${o.icon ? `<div class="sheet-icon tone-${o.tone || 'default'}"><svg class="ic"><use href="#i-${o.icon}"/></svg></div>` : ''}
            <div><h3 id="sheet-title">${esc(o.title)}</h3>${o.subtitle ? `<p>${esc(o.subtitle)}</p>` : ''}</div></div>
          ${o.body ? `<div class="sheet-body">${o.body}</div>` : ''}
          <div class="sheet-actions${o.stack ? ' stack' : ''}">${acts.map((a, i) => `<button type="button" class="btn ${a.cls || 'btn-ghost'}" data-i="${i}">${a.icon ? `<svg class="ic"><use href="#i-${a.icon}"/></svg>` : ''}<span>${esc(a.label)}</span></button>`).join('')}</div>
        </div>`;
        const prevFocus = document.activeElement;
        const close = (val) => {
          wrap.classList.remove('show');
          document.removeEventListener('keydown', onKey);
          setTimeout(() => wrap.remove(), 220);
          if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
          resolve(val);
        };
        const onKey = (e) => { if (e.key === 'Escape') close(null); };
        wrap.addEventListener('click', (e) => {
          if (e.target === wrap) return close(null);
          const b = e.target.closest('[data-i]');
          if (b) close(acts[+b.dataset.i].value);
        });
        document.addEventListener('keydown', onKey);
        $('#overlay-root').appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('show'));
        setTimeout(() => { const b = wrap.querySelector('.sheet-actions .btn:last-child'); if (b) b.focus({ preventScroll: true }); }, 60);
      });
    }
  };

  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-busy', !!on);
    btn.disabled = !!on;
  }

  /* =====================================================================
     AUTENTIKASI & SESI
     ===================================================================== */
  const Auth = {
    init() {
      $('#form-login').addEventListener('submit', (e) => this.login(e));
      $$('[data-logout]').forEach((b) => b.addEventListener('click', () => this.logout(false)));
      // Timer tidak aktif (60 menit)
      let lastSave = 0;
      const bump = () => {
        if (!Store.s.token) return;
        Store.s.lastActive = Date.now();
        if (Date.now() - lastSave > 30000) { lastSave = Date.now(); Store.saveNow(); }
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, bump, { passive: true }));
      setInterval(() => this.checkIdle(), 30000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !Store.s.token) return;
        if (this.checkIdle()) return;
        if (Date.now() - ui.lastBoot > 5 * 60000) App.revalidate();
      });
    },
    idleLimit() { return (CFG.SESI_MENIT || 60) * 60000; },
    checkIdle() {
      if (Store.s.token && Store.s.lastActive && Date.now() - Store.s.lastActive > this.idleLimit()) {
        this.endSession('Sesi berakhir karena tidak aktif selama ' + (CFG.SESI_MENIT || 60) + ' menit. Silakan masuk kembali.');
        return true;
      }
      return false;
    },
    async login(e) {
      e.preventDefault();
      const f = e.target;
      const username = f.username.value.trim();
      const password = f.password.value;
      const err = $('#login-error');
      err.hidden = true;
      if (!username || !password) { this.showError('Username dan kata sandi wajib diisi.'); return; }
      const btn = $('#btn-login');
      busy(btn, true);
      const res = await Api.call('login', { username, password });
      busy(btn, false);
      if (!res.success) { this.showError(res.message || 'Gagal masuk.'); return; }
      Store.s.token = res.data.token;
      Store.applyServer(res.data, Outbox.ops);
      Store.touch(); Store.saveNow();
      U.ls.set('piagam_last_user', username);
      f.password.value = '';
      ui.lastBoot = Date.now();
      App.enter();
      if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/dashboard';
      Outbox.schedule(0);
      toast('Selamat datang, ' + (Store.s.user ? Store.s.user.username : username) + '!');
    },
    showError(msg) {
      const err = $('#login-error');
      err.querySelector('span').textContent = msg;
      err.hidden = false;
    },
    async logout() {
      if (Outbox.ops.length) {
        toast('Menyimpan perubahan terakhir…', 'info');
        const ok = await Outbox.drain(12000);
        if (!ok) {
          const lanjut = await Sheet.open({
            icon: 'alert', tone: 'danger', title: 'Ada perubahan belum tersimpan',
            subtitle: Outbox.ops.length + ' perubahan belum terkirim ke Google Sheets.',
            body: '<div class="sheet-note">Jika keluar sekarang, perubahan tersebut <b>akan hilang</b>. Pastikan internet aktif lalu coba lagi.</div>',
            actions: [{ label: 'Batal', value: false }, { label: 'Tetap Keluar', value: true, cls: 'btn-danger' }]
          });
          if (!lanjut) return;
        }
      }
      if (Store.s.token) Api.call('logout');
      Outbox.ops = []; Outbox.save();
      Buat.clearAllDrafts();
      this.teardown();
      App.showLogin(null);
      toast('Anda telah keluar.', 'info');
    },
    /** Sesi habis (idle / token kedaluwarsa): antrean perubahan DISIMPAN agar terkirim setelah login ulang. */
    endSession(msg) {
      if (!Store.s.token) return;
      this.teardown();
      App.showLogin(msg);
    },
    teardown() {
      Store.clear();
      Viewer.close(true);
      $$('.overlay').forEach((o) => o.remove());
      history.replaceState(null, '', location.pathname + location.search);
    }
  };

  /* =====================================================================
     ROUTER (hash) — perpindahan halaman instan tanpa server
     ===================================================================== */
  const Router = {
    init() { window.addEventListener('hashchange', () => this.route()); },
    go(hash) { if (location.hash === hash) this.route(); else location.hash = hash; },
    route() {
      if (!Store.s.token) return;
      Dropdown.close();
      const [p, a, b] = location.hash.replace(/^#\/?/, '').split('/').map((x) => decodeURIComponent(x || ''));
      let page = p || 'dashboard', title = '', accent = 'ahe', nav = page, back = null;
      switch (page) {
        case 'buat':
          Buat.openNew(a === 'ala' || a === 'ahe' ? a : Buat.jenis);
          title = 'Buat Piagam Baru'; accent = Buat.jenis; break;
        case 'edit':
          if (!Buat.openEdit(a, b)) { this.go('#/riwayat'); return; }
          page = 'buat'; nav = 'riwayat'; title = 'Edit Piagam'; accent = Buat.jenis; back = `#/hasil/${a}/${encodeURIComponent(b)}`; break;
        case 'hasil':
          if (!Hasil.open(a, b)) { this.go('#/riwayat'); return; }
          title = 'Hasil Piagam'; accent = Hasil.jenis;
          nav = ui.justSaved === b ? 'buat' : 'riwayat';
          back = ui.justSaved === b ? `#/buat/${Hasil.jenis}` : `#/riwayat/${Hasil.jenis}`; break;
        case 'riwayat':
          Riwayat.open(a); title = 'Riwayat Piagam'; break;
        case 'pengaturan':
          Pengaturan.render(); title = 'Pengaturan Sistem'; break;
        default:
          page = nav = 'dashboard'; Dashboard.render(); title = 'Dashboard';
      }
      ui.page = page;
      $$('.page').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
      const app = $('#view-app');
      app.classList.toggle('on-dashboard', page === 'dashboard');
      app.dataset.accent = accent;
      $$('[data-nav]').forEach((el) => el.classList.toggle('active', el.dataset.nav === nav));
      $('#topbar-title').textContent = title;
      const bk = $('#topbar-back');
      bk.hidden = !back;
      if (back) bk.setAttribute('href', back);
      document.title = title + ' · Piagam AHE';
      window.scrollTo(0, 0);
    }
  };

  /* =====================================================================
     STATUS SINKRONISASI
     ===================================================================== */
  function updateSyncUI() {
    const st = Outbox.status();
    const n = Outbox.ops.length;
    const pill = $('#sync-pill');
    const map = {
      ok: ['cloud-check', Api.demo ? 'Tersimpan (demo)' : 'Tersimpan', ''],
      syncing: ['refresh', 'Menyimpan…', 'is-syncing'],
      pending: ['refresh', n + ' menunggu', 'is-pending'],
      error: ['alert', 'Gagal · ketuk ulang', 'is-error'],
      offline: ['cloud-off', 'Offline · ' + n, 'is-offline'],
      'offline-idle': ['cloud-off', 'Offline', 'is-offline']
    };
    const [icon, text, cls] = map[st] || map.ok;
    pill.className = 'sync-pill ' + cls;
    pill.innerHTML = `<svg class="ic"><use href="#i-${icon}"/></svg><span>${text}</span>`;
    pill.title = st === 'error' ? 'Gagal sinkron: ' + (Outbox.lastError || '') : st === 'ok' ? 'Semua data tersimpan' : text;
    $$('[data-online]').forEach((el) => { el.textContent = navigator.onLine ? 'Online' : 'Offline'; el.classList.toggle('off', !navigator.onLine); });
    if (ui.page === 'hasil') Hasil.updateSync();
    if (ui.page === 'riwayat') Riwayat.render();
  }

  /* =====================================================================
     DASHBOARD
     ===================================================================== */
  function perBulan(records) {
    const m = new Map();
    records.forEach((r) => {
      const d = new Date(r.createdAt);
      if (isNaN(d)) return;
      const k = d.getFullYear() * 12 + d.getMonth();
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }

  const Dashboard = {
    render() {
      const ahe = Data.list('ahe'), ala = Data.list('ala');
      $('#stat-ahe').textContent = ahe.length;
      $('#stat-ala').textContent = ala.length;
      const now = new Date();
      const kNow = now.getFullYear() * 12 + now.getMonth();
      const mA = perBulan(ahe), mL = perBulan(ala);
      const cur = (mA.get(kNow) || 0) + (mL.get(kNow) || 0);
      const prev = (mA.get(kNow - 1) || 0) + (mL.get(kNow - 1) || 0);
      $('#stat-month').textContent = cur;
      $('#stat-month-label').textContent = `Piagam Bulan Ini (${U.BULAN[now.getMonth()]} ${now.getFullYear()})`;
      const tr = $('#stat-trend');
      if (!cur && !prev) tr.hidden = true;
      else {
        tr.hidden = false;
        if (!prev) { tr.className = 'trend'; tr.innerHTML = '<svg class="ic"><use href="#i-trend-up"/></svg>Baru'; }
        else {
          const pct = Math.round(((cur - prev) / prev) * 100);
          tr.className = 'trend' + (pct < 0 ? ' down' : pct === 0 ? ' flat' : '');
          tr.innerHTML = `<svg class="ic"><use href="#i-trend-${pct < 0 ? 'down' : 'up'}"/></svg>${pct > 0 ? '+' : ''}${pct}%`;
        }
        tr.title = `Dibanding bulan lalu (${prev} lembar)`;
      }
      const user = Store.s.user ? Store.s.user.username : 'Admin';
      $('#hero-name').textContent = user.charAt(0).toUpperCase() + user.slice(1);
      const unitTerbaru = Data.sorted('ahe').find((r) => r.unit);
      $('#hero-unit').textContent = (unitTerbaru ? unitTerbaru.unit : (CFG.NAMA_LEMBAGA || 'Anak Hebat Indonesia')).toUpperCase();
      $('#warn-default-pass').hidden = !Store.s.mustChange;
      Chart.render(mA, mL);
      this.recent();
    },
    recent() {
      const all = Data.sorted('ahe').slice(0, 6).map((r) => ['ahe', r]).concat(Data.sorted('ala').slice(0, 6).map((r) => ['ala', r]))
        .sort((x, y) => String(y[1].createdAt || '').localeCompare(String(x[1].createdAt || ''))).slice(0, 5);
      const el = $('#recent-list');
      if (!all.length) {
        el.innerHTML = `<div class="card empty"><svg class="ic"><use href="#i-inbox"/></svg><b>Belum ada piagam</b>Piagam yang Anda buat akan muncul di sini.</div>`;
        return;
      }
      el.innerHTML = all.map(([j, r]) => `
        <div class="card row-card" data-j="${j}" data-id="${esc(r.id)}">
          <a class="initials ${j}" href="#/hasil/${j}/${encodeURIComponent(r.id)}" aria-label="Lihat piagam">${esc(U.initials(r.nama))}</a>
          <a class="row-main" href="#/hasil/${j}/${encodeURIComponent(r.id)}">
            <span class="row-title"><b>${esc(r.nama)}</b><span class="badge badge-${j}">${JENIS_LABEL[j]}</span></span>
            <span class="row-sub">${r.nomor ? 'No: ' + esc(r.nomor) + ' • ' : ''}${esc(U.fmtTglPendek(r.tglLulus || r.createdAt))}</span>
          </a>
          <button type="button" class="icon-btn ${j === 'ala' ? 'c-ala' : 'c-ahe'}" data-dl aria-label="Unduh piagam ${esc(r.nama)}"><svg class="ic"><use href="#i-download"/></svg></button>
        </div>`).join('');
    }
  };

  /* Grafik batang SVG ringan (tanpa pustaka) — 12 bulan terakhir, Ahe vs Ala */
  const Chart = {
    last: null,
    render(mA, mL) {
      if (mA) this.last = [mA, mL];
      if (!this.last) return;
      [mA, mL] = this.last;
      const el = $('#chart');
      const W = Math.max(260, Math.round(el.clientWidth || 320));
      const H = 200, pl = 28, pr = 4, pt = 20, pb = 26;
      const iw = W - pl - pr, ih = H - pt - pb;
      const now = new Date();
      const kNow = now.getFullYear() * 12 + now.getMonth();
      const months = [];
      for (let i = 11; i >= 0; i--) {
        const k = kNow - i;
        months.push({ k, label: U.BULAN_S[k % 12], full: U.BULAN[k % 12] + ' ' + Math.floor(k / 12), a: mA.get(k) || 0, l: mL.get(k) || 0 });
      }
      const maxV = Math.max(0, ...months.map((m) => Math.max(m.a, m.l)));
      const step = Math.max(1, niceStep(maxV / 2));
      const max = step * 2;
      const y = (v) => pt + ih - (v / max) * ih;
      const gw = iw / 12;
      const bw = Math.max(4, Math.min(12, gw * 0.28));
      const bar = (x, v, cls) => {
        if (!v) return '';
        const top = y(v), base = pt + ih, h = base - top, r = Math.min(4, bw / 2, h);
        return `<path class="${cls}" d="M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z"/>`;
      };
      let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`;
      [0, step, max].forEach((t) => { s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text class="ytick" x="${pl - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`; });
      months.forEach((m, i) => {
        const cx = pl + gw * i + gw / 2;
        const now1 = i === 11;
        s += `<g class="grp" data-i="${i}"><rect class="hit" x="${pl + gw * i}" y="${pt - 10}" width="${gw}" height="${ih + pb + 10}" rx="6"/>`;
        s += bar(cx - bw - 1, m.a, 'b-ahe') + bar(cx + 1, m.l, 'b-ala');
        s += `<text class="xl${now1 ? ' now' : ''}" x="${cx}" y="${H - 6}" text-anchor="middle">${m.label}</text>`;
        if (now1 && (m.a || m.l)) s += `<text class="val" x="${cx}" y="${y(Math.max(m.a, m.l)) - 6}" text-anchor="middle">${m.a + m.l}</text>`;
        s += '</g>';
      });
      s += '</svg>';
      el.innerHTML = s;
      el.querySelectorAll('.b-ahe').forEach((p) => p.setAttribute('fill', '#6B2F8F'));
      el.querySelectorAll('.b-ala').forEach((p) => p.setAttribute('fill', '#F58220'));
      this.months = months;
      $('#chart-table').innerHTML = '<caption>Jumlah piagam per bulan</caption><tr><th>Bulan</th><th>Ahe</th><th>Ala</th></tr>' + months.map((m) => `<tr><td>${m.full}</td><td>${m.a}</td><td>${m.l}</td></tr>`).join('');
    },
    bind() {
      const el = $('#chart'), tip = $('#chart-tip');
      const show = (g) => {
        el.querySelectorAll('.grp.on').forEach((x) => x.classList.remove('on'));
        if (!g) { tip.hidden = true; return; }
        g.classList.add('on');
        const m = this.months[+g.dataset.i];
        tip.innerHTML = `<b>${m.full}</b><i style="background:#6B2F8F"></i>Ahe ${m.a}<br><i style="background:#F58220"></i>Ala ${m.l}`;
        const card = el.closest('.chart-card').getBoundingClientRect();
        const r = g.querySelector('.hit').getBoundingClientRect();
        tip.hidden = false;
        let left = r.left + r.width / 2 - card.left;
        left = Math.max(70, Math.min(card.width - 70, left));
        tip.style.left = left + 'px';
        tip.style.top = (r.top - card.top + 18) + 'px';
      };
      el.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') show(e.target.closest('.grp')); });
      el.addEventListener('pointerleave', () => show(null));
      el.addEventListener('click', (e) => show(e.target.closest('.grp')));
      document.addEventListener('click', (e) => { if (!e.target.closest('#chart')) show(null); });
      window.addEventListener('resize', U.debounce(() => { if (ui.page === 'dashboard') this.render(); }, 150));
    }
  };
  function niceStep(x) {
    if (x <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const n = x / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  /* =====================================================================
     DROPDOWN KELOMPOK (Ala)
     ===================================================================== */
  const Dropdown = {
    init() {
      this.el = $('#dd-kelompok');
      this.btn = this.el.querySelector('.dd-toggle');
      this.menu = this.el.querySelector('.dd-menu');
      this.input = $('#f-kelompok');
      this.btn.addEventListener('click', () => (this.el.classList.contains('open') ? this.close() : this.open()));
      this.btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); this.open(); } });
      this.menu.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) this.pick(li.dataset.value); });
      this.menu.addEventListener('keydown', (e) => {
        const items = $$('li', this.menu); const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (items[i]) this.pick(items[i].dataset.value); }
        else if (e.key === 'Escape' || e.key === 'Tab') { this.close(); this.btn.focus(); }
      });
      document.addEventListener('click', (e) => { if (!e.target.closest('#dd-kelompok')) this.close(); });
    },
    open() {
      this.el.classList.add('open'); this.menu.hidden = false; this.btn.setAttribute('aria-expanded', 'true');
      const sel = this.menu.querySelector('[aria-selected="true"]') || this.menu.querySelector('li');
      if (sel) sel.focus({ preventScroll: true });
    },
    close() { if (!this.el) return; this.el.classList.remove('open'); this.menu.hidden = true; this.btn.setAttribute('aria-expanded', 'false'); },
    set(v) {
      v = v || '';
      this.input.value = v;
      this.el.classList.toggle('has-value', !!v);
      this.el.querySelector('.dd-value').textContent = v || 'Pilih kelompok…';
      $$('li', this.menu).forEach((li) => li.setAttribute('aria-selected', String(li.dataset.value === v)));
    },
    pick(v) {
      this.set(v); this.close(); this.btn.focus({ preventScroll: true });
      Buat.onInput({ target: this.input });
    }
  };

  /* =====================================================================
     BUAT / EDIT PIAGAM
     ===================================================================== */
  const DKEY = 'piagam_draft_v1';
  const Buat = {
    jenis: 'ahe', editId: null, formId: null, origTgl: '', saving: false, restored: {},
    drafts: {},
    init() {
      this.form = $('#form-piagam');
      this.drafts = U.ls.get(DKEY, {});
      Dropdown.init();
      this.form.addEventListener('input', (e) => this.onInput(e));
      this.form.addEventListener('submit', (e) => { e.preventDefault(); this.save('preview'); });
      this.form.addEventListener('keydown', (e) => {
        // Enter = pindah ke isian berikutnya (bukan menyimpan tanpa sengaja)
        if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
        e.preventDefault();
        const f = $$('input.input:not([type=hidden]), .dd-toggle', this.form).filter((x) => x.offsetParent !== null);
        const nx = f[f.indexOf(e.target) + 1];
        if (nx) nx.focus(); else e.target.blur();
      });
      $$('input.input', this.form).forEach((i) => i.setAttribute('enterkeyhint', 'next'));
      $('#btn-reset').addEventListener('click', () => this.reset());
      $('#btn-save-pdf').addEventListener('click', () => this.save('pdf'));
      $$('#seg-jenis .seg-btn').forEach((b) => b.addEventListener('click', () => { if (!this.editId) Router.go('#/buat/' + b.dataset.jenis); }));
      $('#btn-live-full').addEventListener('click', () => Viewer.open($('#live-canvas'), 'Pratinjau ' + JENIS_LABEL[this.jenis]));
      $('#live-canvas').parentElement.addEventListener('click', () => Viewer.open($('#live-canvas'), 'Pratinjau ' + JENIS_LABEL[this.jenis]));
      mqWide.addEventListener('change', () => this.preview());
    },
    defaults(j) {
      const t = Store.s.templates[j] || {};
      return { nomor: t.nomor || '', kepala: t.kepala || '', tglLulus: U.todayISO() };
    },
    openNew(jenis) {
      this.jenis = jenis; this.editId = null; this.origTgl = ''; this.locked = false;
      const d = this.drafts[jenis];
      if (d && d.formId) {
        this.formId = d.formId;
        this.setValues(d.values || {});
        $('#draft-note').hidden = !(d.touched && !this.restored[jenis]);
      } else {
        this.formId = U.uuid();
        this.setValues(this.defaults(jenis));
        $('#draft-note').hidden = true;
      }
      this.restored[jenis] = true;
      this.applyUI(); this.clearErrors(); this.preview();
    },
    openEdit(jenis, id) {
      if (jenis !== 'ahe' && jenis !== 'ala') return false;
      const rec = Data.find(jenis, id);
      if (!rec) { toast('Data piagam tidak ditemukan.', 'error'); return false; }
      this.jenis = jenis; this.editId = id; this.formId = null; this.origTgl = rec.tglLulus || ''; this.locked = false;
      this.setValues(rec);
      $('#draft-note').hidden = true;
      this.applyUI(); this.clearErrors(); this.preview();
      return true;
    },
    applyUI() {
      const j = this.jenis, edit = !!this.editId;
      this.form.dataset.jenis = j;
      $('.page-buat').dataset.accent = j;
      $('#form-title').textContent = (edit ? 'Edit Piagam ' : 'Formulir Piagam ') + JENIS_LABEL[j];
      $('#form-sub').textContent = j === 'ahe' ? 'Mencetak piagam kemahiran membaca' : 'Mencetak piagam hitung "Ala Sekolah"';
      $('#hint-nomor').textContent = edit ? 'Nomor piagam ini. Perubahan tidak memengaruhi template.' : `Terisi otomatis dari template ${j === 'ahe' ? 'terakhir' : 'Ala'}, tetap bisa diedit manual.`;
      $$('.badge-accent', this.form).forEach((b) => { b.hidden = edit; });
      $$('#seg-jenis .seg-btn').forEach((b) => {
        const on = b.dataset.jenis === j;
        b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on));
        b.disabled = edit && !on;
      });
      $('#btn-save-label').textContent = edit ? 'Simpan Perubahan' : 'Pratinjau & Simpan';
      $('#btn-save-pdf').hidden = false;
      // Saran isian dari riwayat (mempercepat pengetikan)
      const uniq = (arr) => Array.from(new Set(arr.filter(Boolean))).slice(0, 30);
      const fill = (id, vals) => { $(id).innerHTML = uniq(vals).map((v) => `<option value="${esc(v)}">`).join(''); };
      fill('#dl-unit', Data.sorted('ahe').map((r) => r.unit));
      fill('#dl-desa', Data.sorted('ala').map((r) => r.desa));
      fill('#dl-kepala', Data.sorted('ahe').concat(Data.sorted('ala')).map((r) => r.kepala));
    },
    setValues(v) {
      const e = this.form.elements;
      ['nomor', 'nama', 'ttl', 'unit', 'desa', 'kepala'].forEach((k) => { e[k].value = v[k] || ''; });
      e.tglLulus.value = U.isISODate(v.tglLulus) ? v.tglLulus : '';
      Dropdown.set(v.kelompok || '');
    },
    values() {
      const e = this.form.elements;
      const g = (n) => String(e[n].value || '').replace(/\s+/g, ' ').trim();
      let tgl = e.tglLulus.value;
      if (!tgl && this.editId && this.origTgl && !U.isISODate(this.origTgl)) tgl = this.origTgl; // pertahankan teks tanggal lama dari Sheets
      const v = { nomor: g('nomor'), nama: g('nama'), tglLulus: tgl, kepala: g('kepala') };
      if (this.jenis === 'ahe') { v.ttl = g('ttl'); v.unit = g('unit'); } else { v.kelompok = e.kelompok.value; v.desa = g('desa'); }
      return v;
    },
    onInput(e) {
      const fld = e.target.closest && e.target.closest('.field');
      if (fld) fld.classList.remove('invalid');
      if (!this.editId) {
        this.drafts[this.jenis] = { formId: this.formId, values: this.values(), touched: true };
        U.ls.set(DKEY, this.drafts);
      }
      this.previewRaf();
    },
    clearDraft(j) { delete this.drafts[j]; U.ls.set(DKEY, this.drafts); },
    clearAllDrafts() { this.drafts = {}; this.restored = {}; U.ls.del(DKEY); },
    clearErrors() { $$('.field.invalid', this.form).forEach((f) => f.classList.remove('invalid')); },
    validate() {
      this.clearErrors();
      const v = this.values(), errs = [];
      const err = (k, msg) => { const f = $(`.field[data-field="${k}"]`, this.form); f.classList.add('invalid'); f.querySelector('.field-error').textContent = msg; errs.push(f); };
      if (!v.nama) err('nama', 'Nama lengkap wajib diisi.');
      if (this.jenis === 'ahe' && !v.ttl) err('ttl', 'Tempat, tanggal lahir wajib diisi.');
      if (this.jenis === 'ala' && !v.kelompok) err('kelompok', 'Pilih kelompok / tingkat kemahiran.');
      if (errs.length) {
        const first = errs[0].querySelector('input.input, .dd-toggle');
        if (first) { first.focus({ preventScroll: true }); errs[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        return false;
      }
      return true;
    },
    /** SIMPAN OPTIMISTIS: data tampil & tersimpan lokal seketika; server menyusul di latar belakang. */
    save(mode) {
      // Kunci: tekan berulang (sinyal lemah / jari gemetar) tidak pernah membuat data ganda.
      if (this.saving || this.locked || (!this.formId && !this.editId)) return;
      if (!this.validate()) { toast('Lengkapi kolom bertanda * terlebih dahulu.', 'error'); return; }
      this.saving = true;
      try {
        const j = this.jenis, v = this.values(), now = new Date().toISOString();
        const isNew = !this.editId;
        const id = isNew ? this.formId : this.editId;
        const old = Data.find(j, id);
        const rec = Object.assign({ id }, v, { createdAt: old ? old.createdAt : now, updatedAt: now });
        let template = null;
        if (isNew) {
          template = { nomor: Store.s.templates.autoNomor ? U.nomorBerikutnya(v.nomor) : v.nomor, kepala: v.kepala };
          Store.s.templates[j] = Object.assign({}, template);
        }
        Data.upsert(j, rec);
        Outbox.push({ type: 'upsert', jenis: j, record: rec, template });
        ui.justSaved = id;
        if (isNew) { this.clearDraft(j); this.formId = null; }
        if (mode === 'pdf') {
          Downloads.run('pdf', j, rec, $('#btn-save-pdf'));
          if (isNew) { this.openNew(j); $('#f-nama').focus(); }
          toast(`Piagam ${rec.nama} tersimpan. PDF sedang dibuat…`);
        } else {
          this.locked = true;                         // dibuka lagi oleh openNew/openEdit
          Router.go(`#/hasil/${j}/${encodeURIComponent(id)}`);
        }
      } finally {
        this.saving = false;
      }
    },
    async reset() {
      if (this.editId) { const r = Data.find(this.jenis, this.editId); if (r) this.setValues(r); this.clearErrors(); this.preview(); return; }
      this.clearDraft(this.jenis);
      this.formId = null;
      this.openNew(this.jenis);
      toast('Formulir dikosongkan.', 'info', 1600);
    },
    previewRaf: null,
    seq: 0,
    preview() {
      if (!mqWide.matches) return;                // di HP pratinjau tampil di halaman Hasil
      const j = this.jenis, rec = this.values();
      const c = $('#live-canvas'), wrap = c.parentElement;
      const img = Cert.Templates.peek(j);
      const status = $('#live-tpl');
      if (img === undefined) {
        wrap.classList.add('loading');
        const seq = ++this.seq;
        Promise.all([Cert.fontsReady(), Cert.Templates.get(j)]).catch(() => null).then(() => {
          if (seq !== this.seq) return;
          if (Cert.Templates.peek(j) === undefined) { wrap.classList.remove('loading'); Cert.drawSync(c, j, this.values(), null); return; } // gagal muat → template sementara
          this.preview();
        });
        return;
      }
      wrap.classList.remove('loading');
      const d = Cert.drawSync(c, j, rec, img);
      c.dataset.drawn = '1';
      status.className = 'tpl-status ' + (img ? 'ok' : 'warn');
      status.innerHTML = img ? '<svg class="ic"><use href="#i-check"/></svg>Posisi teks mengikuti template resmi' : '<svg class="ic"><use href="#i-alert"/></svg>Template resmi belum diunggah — memakai template sementara';
      $('#live-res').textContent = `Resolusi cetak: ${d.w} × ${d.h} px`;
    }
  };
  Buat.previewRaf = U.raf(() => Buat.preview());

  /* =====================================================================
     HASIL PIAGAM
     ===================================================================== */
  const Hasil = {
    jenis: 'ahe', rec: null, seq: 0,
    init() {
      $('#btn-pdf').addEventListener('click', (e) => this.rec && Downloads.run('pdf', this.jenis, this.rec, e.currentTarget));
      $('#btn-jpg').addEventListener('click', (e) => this.rec && Downloads.run('jpg', this.jenis, this.rec, e.currentTarget));
      const full = () => this.rec && Viewer.open($('#hasil-canvas'), this.rec.nama);
      $('#btn-fullscreen').addEventListener('click', full);
      $('#hasil-wrap').addEventListener('click', full);
    },
    open(jenis, id) {
      jenis = jenis === 'ala' ? 'ala' : 'ahe';
      const rec = Data.find(jenis, id);
      if (!rec) { toast('Data piagam tidak ditemukan (mungkin sudah dihapus).', 'error'); return false; }
      this.jenis = jenis; this.rec = rec;
      $('.page-hasil').dataset.accent = jenis;
      $('#hasil-banner').hidden = ui.justSaved !== id;
      this.updateSync();
      $('#hasil-eyebrow').textContent = 'PRATINJAU ASLI ' + jenis.toUpperCase();
      $('#btn-edit').setAttribute('href', `#/edit/${jenis}/${encodeURIComponent(id)}`);
      $('#btn-new').setAttribute('href', `#/buat/${jenis}`);
      $('#tip-ios').hidden = !U.isIOS();
      const row = (k, v) => `<dt>${k}</dt><dd class="${v ? '' : 'empty-val'}">${v ? esc(v) : 'tidak diisi'}</dd>`;
      $('#hasil-detail').innerHTML = `<span class="badge badge-${jenis}">Piagam ${JENIS_LABEL[jenis]}</span><h3>${esc(rec.nama)}</h3><dl class="dl">
        ${row('Nomor', rec.nomor)}
        ${jenis === 'ahe' ? row('Tempat, Tgl Lahir', rec.ttl) + row('Unit', rec.unit) : row('Kelompok', rec.kelompok) + row('Desa/Kel.', rec.desa)}
        ${row('Tgl Lulus', U.fmtTgl(rec.tglLulus))}${row('Kepala Unit', rec.kepala)}</dl>`;
      this.draw();
      Cert.preloadPDF();
      return true;
    },
    draw() {
      const c = $('#hasil-canvas'), wrap = $('#hasil-wrap');
      const j = this.jenis, rec = this.rec, seq = ++this.seq;
      const img = Cert.Templates.peek(j);
      if (img !== undefined) { Cert.drawSync(c, j, rec, img); wrap.classList.remove('loading'); }
      else wrap.classList.add('loading');
      // Gambar ulang setelah font & template dipastikan siap (tanpa kedip jika sudah siap)
      Promise.all([Cert.fontsReady(), Cert.Templates.get(j).catch((e) => { toast(e.message, 'error'); return null; })]).then(([, im]) => {
        if (seq !== this.seq) return;
        Cert.drawSync(c, j, rec, im || null);
        wrap.classList.remove('loading');
      });
    },
    updateSync() {
      if (!this.rec) return;
      const pending = Outbox.isPending(this.jenis, this.rec.id);
      $('#hasil-sync').textContent = pending
        ? (navigator.onLine ? 'Menyinkronkan ke Google Sheets…' : 'Offline — akan dikirim otomatis saat online')
        : (Api.demo ? 'Tersimpan di browser (mode demo)' : 'Tersimpan di Google Sheets ✓');
    }
  };

  /* =====================================================================
     UNDUH PDF / JPG
     ===================================================================== */
  const Downloads = {
    async run(kind, jenis, rec, btn) {
      busy(btn, true);
      try {
        const blob = kind === 'pdf' ? await Cert.toPDF(jenis, rec) : await Cert.toJPG(jenis, rec);
        U.download(blob, U.namaFile(jenis, rec.nama, kind === 'pdf' ? 'pdf' : 'jpg'));
        toast(kind === 'pdf' ? 'PDF berhasil diunduh.' : 'Gambar JPG berhasil diunduh.');
      } catch (e) {
        toast((kind === 'pdf' ? 'Gagal membuat PDF: ' : 'Gagal membuat JPG: ') + e.message, 'error');
      } finally {
        busy(btn, false);
      }
    },
    async choose(jenis, rec) {
      const v = await Sheet.open({
        icon: 'download', title: 'Unduh Piagam', subtitle: rec.nama,
        actions: [
          { label: 'Gambar JPG', value: 'jpg', icon: 'image' },
          { label: 'PDF (A4)', value: 'pdf', icon: 'file', cls: jenis === 'ala' ? 'btn-orange' : 'btn-primary' }
        ]
      });
      if (v) this.run(v, jenis, rec, null);
    }
  };

  async function hapusPiagam(jenis, id) {
    const rec = Data.find(jenis, id);
    if (!rec) return;
    const ok = await Sheet.open({
      icon: 'alert', tone: 'danger', title: 'Hapus Piagam Ini?', subtitle: 'Tindakan ini tidak dapat dibatalkan.',
      body: `<div class="sheet-note">Data atas nama <b class="t-danger">${esc(rec.nama)}</b>${rec.nomor ? ` (No: ${esc(rec.nomor)})` : ''} akan dihapus secara permanen dari Google Sheets.</div>`,
      actions: [{ label: 'Batal', value: false }, { label: 'Ya, Hapus', value: true, cls: 'btn-danger', icon: 'trash' }]
    });
    if (!ok) return;
    Data.remove(jenis, id);
    Outbox.push({ type: 'delete', jenis, id });
    toast('Piagam atas nama ' + rec.nama + ' dihapus.');
    if (ui.page === 'hasil') Router.go('#/riwayat/' + jenis);
  }

  /* =====================================================================
     RIWAYAT
     ===================================================================== */
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const Riwayat = {
    tab: 'ahe', q: '', limit: 30,
    init() {
      const inp = $('#search');
      const run = U.debounce(() => { this.q = inp.value; this.limit = 30; this.render(); }, 120);
      inp.addEventListener('input', () => { $('#search-clear').hidden = !inp.value; run(); });
      $('#search-clear').addEventListener('click', () => { inp.value = ''; $('#search-clear').hidden = true; this.q = ''; this.render(); inp.focus(); });
      $$('#seg-riwayat .seg-btn').forEach((b) => b.addEventListener('click', () => Router.go('#/riwayat/' + b.dataset.tab)));
      $('#btn-more').addEventListener('click', () => { this.limit += 50; this.render(); });
      $('#riwayat-list').addEventListener('click', (e) => this.onAction(e));
      mqTable.addEventListener('change', () => { if (ui.page === 'riwayat') this.render(); });
    },
    open(tab) {
      if (tab === 'ahe' || tab === 'ala') { if (tab !== this.tab) this.limit = 30; this.tab = tab; }
      this.render();
    },
    onAction(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const host = b.closest('[data-id]');
      const id = host.dataset.id, j = this.tab;
      const rec = Data.find(j, id);
      if (!rec) return;
      switch (b.dataset.act) {
        case 'view': ui.justSaved = null; Router.go(`#/hasil/${j}/${encodeURIComponent(id)}`); break;
        case 'edit': Router.go(`#/edit/${j}/${encodeURIComponent(id)}`); break;
        case 'dl': Downloads.choose(j, rec); break;
        case 'del': hapusPiagam(j, id); break;
      }
    },
    render() {
      $('#count-ahe').textContent = Data.list('ahe').length;
      $('#count-ala').textContent = Data.list('ala').length;
      $$('#seg-riwayat .seg-btn').forEach((b) => { const on = b.dataset.tab === this.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
      const j = this.tab, q = norm(this.q.trim());
      let arr = Data.sorted(j);
      if (q) arr = arr.filter((r) => norm([r.nama, r.nomor, r.unit, r.desa, r.kelompok, r.kepala, r.ttl].join(' ')).includes(q));
      const note = $('#result-note');
      note.hidden = !q;
      note.textContent = `${arr.length} hasil untuk "${this.q.trim()}"`;
      const list = $('#riwayat-list');
      const more = $('#btn-more');
      if (!arr.length) {
        list.innerHTML = q
          ? `<div class="card empty"><svg class="ic"><use href="#i-search"/></svg><b>Tidak ditemukan</b>Coba kata kunci lain: nama, nomor, atau ${j === 'ahe' ? 'unit' : 'desa'}.</div>`
          : `<div class="card empty"><svg class="ic"><use href="#i-inbox"/></svg><b>Belum ada Piagam ${JENIS_LABEL[j]}</b>Piagam yang disimpan akan tampil di sini.<br><a class="btn ${j === 'ala' ? 'btn-orange' : 'btn-primary'}" href="#/buat/${j}"><svg class="ic"><use href="#i-plus"/></svg>Buat Piagam ${JENIS_LABEL[j]}</a></div>`;
        more.hidden = true;
        return;
      }
      const items = arr.slice(0, this.limit);
      const pend = Outbox.pendingIds(j);
      const pendIc = '<svg class="ic pending-ic" role="img" aria-label="Menunggu sinkron"><title>Menunggu sinkron ke Google Sheets</title><use href="#i-refresh"/></svg>';
      const acts = (r) => `
        <button type="button" class="act" data-act="view" aria-label="Lihat piagam ${esc(r.nama)}"><svg class="ic"><use href="#i-eye"/></svg></button>
        <button type="button" class="act" data-act="edit" aria-label="Edit"><svg class="ic"><use href="#i-edit"/></svg></button>
        <button type="button" class="act" data-act="dl" aria-label="Unduh"><svg class="ic"><use href="#i-download"/></svg></button>
        <button type="button" class="act del" data-act="del" aria-label="Hapus"><svg class="ic"><use href="#i-trash"/></svg></button>`;
      if (mqTable.matches) {
        list.innerHTML = `<div class="card table-wrap"><table class="tbl ${j}"><thead><tr>
          <th>Nama Lengkap</th><th>Nomor</th><th>${j === 'ahe' ? 'Tempat, Tgl Lahir' : 'Kelompok'}</th><th>${j === 'ahe' ? 'Unit' : 'Desa / Kel.'}</th><th>Tgl Lulus</th><th class="sr-only">Aksi</th>
          </tr></thead><tbody>${items.map((r) => `<tr data-id="${esc(r.id)}">
          <td><span class="row-title"><span class="t-name">${esc(r.nama)}</span>${pend.has(r.id) ? pendIc : ''}</span></td>
          <td class="t-no">${esc(r.nomor || '—')}</td>
          <td>${esc((j === 'ahe' ? r.ttl : r.kelompok) || '—')}</td>
          <td>${esc((j === 'ahe' ? r.unit : r.desa) || '—')}</td>
          <td style="white-space:nowrap">${esc(U.fmtTglPendek(r.tglLulus) || '—')}</td>
          <td><div class="t-actions">${acts(r)}</div></td></tr>`).join('')}</tbody></table></div>`;
      } else {
        list.innerHTML = items.map((r) => {
          const meta = j === 'ahe' ? (r.unit || 'Unit belum diisi') : [r.kelompok, r.desa].filter(Boolean).join(' • ');
          return `<article class="card h-card-item ${j}" data-id="${esc(r.id)}">
            <div class="h-top">
              <div class="h-name"><b>${esc(r.nama)}</b><span class="badge badge-${j}">${JENIS_LABEL[j]}</span>${pend.has(r.id) ? pendIc : ''}</div>
              <span class="h-date">${esc(U.fmtTglPendek(r.tglLulus || r.createdAt))}</span>
            </div>
            ${r.nomor ? `<div class="h-no">No: ${esc(r.nomor)}</div>` : ''}
            <div class="h-meta"><svg class="ic"><use href="#i-pin"/></svg><span>${esc(meta)}${r.kepala ? ' • Kepala: ' + esc(r.kepala) : ''}</span></div>
            <div class="h-actions">${acts(r)}</div>
          </article>`;
        }).join('');
      }
      more.hidden = arr.length <= this.limit;
      more.textContent = `Tampilkan lebih banyak (${arr.length - this.limit} lagi)`;
    }
  };

  /* =====================================================================
     PENGATURAN
     ===================================================================== */
  const Pengaturan = {
    uploadJenis: null,
    init() {
      $('#form-akun').addEventListener('submit', (e) => this.saveAkun(e));
      $$('.tpl-box').forEach((box) => {
        const j = box.dataset.tpl;
        box.querySelector('[data-tpl-save]').addEventListener('click', () => this.saveTpl(j));
        box.querySelector('[data-tpl-clear]').addEventListener('click', () => {
          box.querySelector('[name=nomor]').value = ''; box.querySelector('[name=kepala]').value = '';
          this.saveTpl(j, true);
        });
      });
      $('#sw-auto-nomor').addEventListener('change', (e) => {
        Store.s.templates.autoNomor = e.target.checked; Store.save();
        Outbox.push({ type: 'saveSetting', key: 'nomor_auto_naik', value: e.target.checked ? 'ya' : 'tidak' });
        toast(e.target.checked ? 'Nomor urut akan naik otomatis.' : 'Nomor urut tidak dinaikkan otomatis.', 'info');
      });
      $$('[data-upload]').forEach((b) => b.addEventListener('click', () => { this.uploadJenis = b.dataset.upload; $('#file-template').click(); }));
      $('#file-template').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.upload(this.uploadJenis, f); });
      Kalibrasi.init();
    },
    render() {
      const u = $('#akun-username');
      if (document.activeElement !== u) u.value = Store.s.user ? Store.s.user.username : '';
      $$('.tpl-box').forEach((box) => {
        const t = Store.s.templates[box.dataset.tpl] || {};
        box.querySelector('[name=nomor]').value = t.nomor || '';
        box.querySelector('[name=kepala]').value = t.kepala || '';
      });
      $('#sw-auto-nomor').checked = Store.s.templates.autoNomor !== false;
      this.files();
      Kalibrasi.render();
      $('#app-ver').textContent = `Piagam AHE v${CFG.VERSI || '1.0.0'} · ${Api.demo ? 'Mode demo (belum terhubung)' : 'Terhubung ke Google Apps Script'}`;
    },
    files() {
      const tf = Store.s.templateFiles || {};
      const st = $('#tpl-drive-status');
      const lengkap = tf.ahe && tf.ala;
      st.className = 'pill ' + (lengkap ? 'pill-ok' : 'pill-warn');
      st.innerHTML = `<span class="dot"></span>${Api.demo ? 'Mode demo' : lengkap ? 'Terhubung ke Drive' : 'Belum lengkap'}`;
      ['ahe', 'ala'].forEach((j) => {
        const row = $(`.file-row[data-file="${j}"]`);
        const m = tf[j];
        row.querySelector('[data-fname]').textContent = m ? m.name : 'Belum ada template';
        const dims = Cert.Templates.dims(j);
        row.querySelector('[data-fdesc]').textContent = m
          ? `${dims ? dims.w + ' × ' + dims.h + ' px • ' : ''}${m.size ? Math.round(m.size / 1024) + ' KB • ' : ''}Folder /Template`
          : 'Unggah gambar JPG/PNG lanskap';
        row.querySelector('[data-upload]').textContent = m ? 'Ganti' : 'Unggah';
        const th = row.querySelector('.file-thumb');
        const img = Cert.Templates.peek(j);
        if (img) {
          if (th.dataset.v !== m.version) {
            const c = document.createElement('canvas'); c.width = 128; c.height = 92;
            c.getContext('2d').drawImage(img, 0, 0, 128, 92);
            th.style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.8)})`;
            th.classList.add('has-img'); th.dataset.v = m.version;
          }
        } else {
          th.style.backgroundImage = ''; th.classList.remove('has-img'); th.dataset.v = '';
          if (m && img === undefined) Cert.Templates.get(j).then(() => { if (ui.page === 'pengaturan') this.files(); }).catch(() => null);
        }
      });
    },
    async saveAkun(e) {
      e.preventDefault();
      const f = e.target, err = $('#akun-error');
      err.hidden = true;
      const show = (m) => { err.querySelector('span').textContent = m; err.hidden = false; };
      const newUsername = f.newUsername.value.trim(), oldPassword = f.oldPassword.value, np = f.newPassword.value, np2 = f.newPassword2.value;
      if (!oldPassword) return show('Masukkan kata sandi lama untuk menyimpan perubahan.');
      if (!/^[A-Za-z0-9_.\-]{3,40}$/.test(newUsername)) return show('Username 3–40 karakter: huruf, angka, titik, garis bawah, atau strip.');
      if (np && np.length < 8) return show('Kata sandi baru minimal 8 karakter.');
      if (np !== np2) return show('Ulangi kata sandi baru — keduanya belum sama.');
      if (!np && Store.s.user && newUsername === Store.s.user.username) return show('Tidak ada perubahan untuk disimpan.');
      const btn = $('#btn-akun');
      busy(btn, true);
      const res = await Api.call('changeAccount', { oldPassword, newUsername, newPassword: np });
      busy(btn, false);
      if (!res.success) return show(res.message || 'Gagal menyimpan.');
      Store.s.user = { username: res.data.username };
      Store.s.mustChange = !!res.data.mustChange;
      Store.saveNow();
      f.oldPassword.value = ''; f.newPassword.value = ''; f.newPassword2.value = '';
      App.userUI();
      toast(res.message || 'Akun diperbarui.');
    },
    saveTpl(j, kosong) {
      const box = $(`.tpl-box[data-tpl="${j}"]`);
      const nomor = box.querySelector('[name=nomor]').value.trim();
      const kepala = box.querySelector('[name=kepala]').value.trim();
      Store.s.templates[j] = { nomor, kepala };
      Store.save();
      if (!(Buat.drafts[j] && Buat.drafts[j].touched)) Buat.clearDraft(j);
      Outbox.push({ type: 'saveTemplate', jenis: j, nomor, kepala });
      toast(kosong ? `Template ${JENIS_LABEL[j]} dikosongkan.` : `Template ${JENIS_LABEL[j]} disimpan.`);
    },
    async upload(j, file) {
      if (!/^image\/(jpeg|png)$/.test(file.type)) { toast('File harus berformat JPG atau PNG.', 'error'); return; }
      if (file.size > 8 * 1024 * 1024) { toast('Ukuran file maksimal 8 MB.', 'error'); return; }
      const btn = $(`[data-upload="${j}"]`);
      const label = btn.textContent;
      btn.textContent = 'Mengunggah…'; btn.disabled = true;
      try {
        let blob = file;
        const img = await new Promise((res, rej) => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => { res(i); }; i.onerror = () => rej(new Error('Gambar tidak bisa dibaca.')); i.src = u; });
        if (img.naturalWidth < img.naturalHeight) toast('Perhatian: gambar ini potret, template piagam biasanya lanskap.', 'info', 4000);
        // Jaga template tetap ringan untuk HP: perkecil jika sangat besar
        if (file.size > 2.5 * 1024 * 1024 || img.naturalWidth > 3000) {
          const scale = Math.min(1, 3000 / img.naturalWidth);
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
        }
        const base64 = await U.blobToBase64(blob);
        const res = await Api.call('uploadTemplate', { jenis: j, mime: blob.type || file.type, base64 });
        if (!res.success) throw new Error(res.message || 'Gagal mengunggah.');
        Store.s.templateFiles[j] = res.data;
        Store.saveNow();
        await U.idb.set('tpl_' + j, { version: res.data.version, blob });
        await Cert.Templates.get(j).catch(() => null);
        this.files();
        Kalibrasi.draw();
        toast(`Template ${JENIS_LABEL[j]} berhasil diganti.`);
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = Store.s.templateFiles[j] ? 'Ganti' : label;
      }
    }
  };

  /* Kalibrasi posisi teks: ubah angka atau ketuk kanvas untuk memindahkan titik */
  const Kalibrasi = {
    jenis: 'ahe', work: null, active: 'nama',
    SAMPLE: {
      ahe: { nomor: '045/AHE-SGT/IX/2026', nama: 'Ahmad Fadhil Prasetyo', ttl: 'Sangatta, 12 Mei 2018', unit: 'Unit Sangatta Utara', tglLulus: '2026-09-18', kepala: 'Hj. Sri Wahyuni, S.Pd.' },
      ala: { nomor: '018/ALA-SGT/IX/2026', nama: 'Siti Nur Azizah', kelompok: 'Pertambahan & Pengurangan', desa: 'Teluk Lingga', tglLulus: '2026-09-17', kepala: 'Hj. Sri Wahyuni, S.Pd.' }
    },
    init() {
      $$('#seg-kal .seg-btn').forEach((b) => b.addEventListener('click', () => { this.jenis = b.dataset.jenis; this.active = 'nama'; this.render(); }));
      $('#kal-markers').addEventListener('change', () => this.draw());
      $('#kal-save').addEventListener('click', () => this.save());
      $('#kal-reset').addEventListener('click', () => this.reset());
      const box = $('#kal-fields');
      box.addEventListener('input', (e) => {
        const card = e.target.closest('[data-k]'); if (!card) return;
        const k = card.dataset.k, p = e.target.dataset.p;
        if (p === 'color') this.work.fields[k].color = e.target.value;
        else { const v = parseFloat(e.target.value); if (isFinite(v)) this.work.fields[k][p] = v; }
        this.active = k; this.drawRaf();
      });
      box.addEventListener('focusin', (e) => { const card = e.target.closest('[data-k]'); if (card && this.active !== card.dataset.k) { this.active = card.dataset.k; this.drawRaf(); } });
      $('#kal-canvas').addEventListener('click', (e) => {
        // ketuk kanvas = pindahkan titik acuan kolom yang sedang dipilih
        const c = e.currentTarget, r = c.getBoundingClientRect();
        const L = this.layout();
        const x = Math.round(((e.clientX - r.left) / r.width) * L.refW);
        const y = Math.round(((e.clientY - r.top) / r.height) * L.refH);
        const f = this.work.fields[this.active]; if (!f) return;
        f.x = x; f.y = y;
        const card = $(`#kal-fields [data-k="${this.active}"]`);
        card.querySelector('[data-p=x]').value = x; card.querySelector('[data-p=y]').value = y;
        this.draw();
      });
      this.drawRaf = U.raf(() => this.draw());
    },
    layout() { return Cert.layout(this.jenis, this.work); },
    render() {
      $$('#seg-kal .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.jenis === this.jenis));
      const L = Cert.layout(this.jenis);
      this.work = { fields: {} };
      Object.keys(L.fields).forEach((k) => { const f = L.fields[k]; this.work.fields[k] = { x: f.x, y: f.y, size: f.size, maxW: f.maxW, color: f.color, align: f.align }; });
      $('#kal-fields').innerHTML = Object.keys(L.fields).map((k) => {
        const f = L.fields[k];
        const num = (p, lbl) => `<label>${lbl}<input type="number" inputmode="decimal" step="1" data-p="${p}" value="${f[p]}"></label>`;
        return `<div class="kal-field" data-k="${k}"><div class="kal-field-head"><span>${esc(f.label)}</span><input type="color" data-p="color" value="${f.color}" aria-label="Warna teks ${esc(f.label)}"></div>
          <div class="kal-grid">${num('x', 'X')}${num('y', 'Y')}${num('size', 'Ukuran')}${num('maxW', 'Lebar maks')}</div></div>`;
      }).join('');
      this.draw();
    },
    draw() {
      if (!this.work) return;
      const c = $('#kal-canvas'), j = this.jenis;
      const img = Cert.Templates.peek(j);
      const opts = { markers: $('#kal-markers').checked, layout: this.layout(), active: this.active };
      if (img === undefined) {
        c.parentElement.classList.add('loading');
        Cert.Templates.get(j).catch(() => null).then(() => { c.parentElement.classList.remove('loading'); if (j === this.jenis) this.draw(); });
        return;
      }
      Cert.fontsReady().then(() => { if (j === this.jenis) Cert.drawSync(c, j, this.SAMPLE[j], img, opts); });
      Cert.drawSync(c, j, this.SAMPLE[j], img, opts);
      $$('#kal-fields .kal-field').forEach((el) => { el.style.borderColor = el.dataset.k === this.active ? 'var(--orange)' : ''; });
    },
    save() {
      const j = this.jenis;
      Store.s.layouts[j] = JSON.parse(JSON.stringify(this.work));
      Store.save();
      Outbox.push({ type: 'saveLayout', jenis: j, layout: Store.s.layouts[j] });
      toast(`Posisi teks Piagam ${JENIS_LABEL[j]} disimpan.`);
    },
    async reset() {
      const ok = await Sheet.open({ icon: 'reset', title: 'Kembalikan posisi bawaan?', subtitle: `Kalibrasi Piagam ${JENIS_LABEL[this.jenis]} akan kembali ke koordinat awal PRD.`, actions: [{ label: 'Batal', value: false }, { label: 'Kembalikan', value: true, cls: 'btn-primary' }] });
      if (!ok) return;
      Store.s.layouts[this.jenis] = null; Store.save();
      Outbox.push({ type: 'saveLayout', jenis: this.jenis, layout: null });
      this.render();
      toast('Posisi bawaan dipulihkan.');
    }
  };

  /* =====================================================================
     PRATINJAU LAYAR PENUH (cubit untuk zoom, seret untuk geser)
     ===================================================================== */
  const Viewer = {
    s: 1, tx: 0, ty: 0, base: 1, pts: new Map(), last: null, pinch: null, lastTap: 0, isOpen: false,
    init() {
      this.el = $('#viewer'); this.stage = $('#viewer-stage'); this.cv = $('#viewer-canvas');
      $('#viewer-close').addEventListener('click', () => this.close());
      $$('[data-zoom]', this.el).forEach((b) => b.addEventListener('click', () => {
        const z = +b.dataset.zoom;
        if (!z) return this.fit();
        const r = this.stage.getBoundingClientRect();
        this.zoomAt(r.width / 2, r.height / 2, z > 0 ? 1.4 : 1 / 1.4);
      }));
      const st = this.stage;
      st.addEventListener('pointerdown', (e) => { st.setPointerCapture(e.pointerId); this.pts.set(e.pointerId, [e.clientX, e.clientY]); this.last = [e.clientX, e.clientY]; if (this.pts.size === 2) this.startPinch(); });
      st.addEventListener('pointermove', (e) => {
        if (!this.pts.has(e.pointerId)) return;
        this.pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (this.pts.size === 2 && this.pinch) {
          const [a, b] = Array.from(this.pts.values());
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          const r = st.getBoundingClientRect();
          const mx = (a[0] + b[0]) / 2 - r.left, my = (a[1] + b[1]) / 2 - r.top;
          this.zoomAt(mx, my, (this.pinch.s * d / this.pinch.d) / this.s);
        } else if (this.pts.size === 1 && this.last) {
          this.tx += e.clientX - this.last[0]; this.ty += e.clientY - this.last[1];
          this.last = [e.clientX, e.clientY]; this.apply();
        }
      });
      const up = (e) => {
        this.pts.delete(e.pointerId);
        if (this.pts.size < 2) this.pinch = null;
        if (this.pts.size === 1) this.last = Array.from(this.pts.values())[0];
        if (e.type === 'pointerup' && this.pts.size === 0) {
          const now = Date.now();
          if (now - this.lastTap < 300) {
            const r = st.getBoundingClientRect();
            if (this.s > this.base * 1.2) this.fit(); else this.zoomAt(e.clientX - r.left, e.clientY - r.top, 2.5);
            this.lastTap = 0;
          } else this.lastTap = now;
        }
      };
      st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
      st.addEventListener('wheel', (e) => { e.preventDefault(); const r = st.getBoundingClientRect(); this.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
      document.addEventListener('keydown', (e) => { if (this.isOpen && e.key === 'Escape') this.close(); });
      window.addEventListener('resize', () => { if (this.isOpen) this.fit(); });
      window.addEventListener('popstate', () => { if (this.isOpen) this.close(true); });
    },
    startPinch() { const [a, b] = Array.from(this.pts.values()); this.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, s: this.s }; },
    open(src, title) {
      const cv = this.cv;
      cv.width = src.width; cv.height = src.height;
      cv.getContext('2d').drawImage(src, 0, 0);
      cv.style.width = src.width + 'px'; cv.style.height = src.height + 'px';
      $('#viewer-title').textContent = title || 'Pratinjau';
      this.el.hidden = false; this.isOpen = true;
      document.body.style.overflow = 'hidden';
      history.pushState({ viewer: 1 }, '');
      requestAnimationFrame(() => this.fit());
      // Android: layar penuh + kunci lanskap (diabaikan jika tidak didukung, mis. iPhone)
      if (window.matchMedia('(pointer: coarse)').matches && this.el.requestFullscreen) {
        this.el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => null);
      }
    },
    close(fromPop) {
      if (!this.isOpen) return;
      this.isOpen = false; this.el.hidden = true; document.body.style.overflow = '';
      this.pts.clear(); this.pinch = null;
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* abaikan */ }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => null);
      if (!fromPop && history.state && history.state.viewer) history.back();
    },
    fit() {
      const r = this.stage.getBoundingClientRect();
      this.base = Math.min(r.width / this.cv.width, r.height / this.cv.height) * 0.96;
      this.s = this.base;
      this.tx = (r.width - this.cv.width * this.s) / 2;
      this.ty = (r.height - this.cv.height * this.s) / 2;
      this.apply();
    },
    zoomAt(x, y, f) {
      const ns = Math.max(this.base * 0.8, Math.min(this.base * 8, this.s * f));
      const k = ns / this.s;
      this.tx = x - (x - this.tx) * k; this.ty = y - (y - this.ty) * k; this.s = ns;
      this.apply();
    },
    apply() { this.cv.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`; }
  };

  /* =====================================================================
     APP — penghubung
     ===================================================================== */
  const App = {
    toast,
    go: (h) => Router.go(h),
    enter() {
      document.body.classList.add('is-app');
      document.body.classList.remove('is-login');
      this.userUI();
      Router.route();
      U.idle(() => { Cert.fontsReady(); Cert.Templates.prefetch(); Cert.preloadPDF(); });
    },
    showLogin(msg) {
      document.documentElement.classList.remove('has-session');
      document.body.classList.remove('is-app');
      document.body.classList.add('is-login');
      ui.page = null;
      const f = $('#form-login');
      f.username.value = U.ls.get('piagam_last_user', '') || '';
      if (msg) Auth.showError(msg); else $('#login-error').hidden = true;
      $('#login-demo').hidden = !Api.demo;
      document.title = 'Masuk · Piagam AHE';
    },
    sessionExpired() { Auth.endSession('Sesi berakhir. Silakan masuk kembali — perubahan yang belum terkirim tetap aman dan akan dikirim setelah Anda masuk.'); },
    userUI() {
      const u = Store.s.user ? Store.s.user.username : 'admin';
      $$('[data-username]').forEach((el) => { el.textContent = u; });
      $$('[data-avatar]').forEach((el) => { el.textContent = U.initials(u.replace(/[_.\-]+/g, ' ')); });
    },
    async revalidate() {
      ui.lastBoot = Date.now();
      const res = await Api.call('bootstrap');
      if (res.success) {
        const tfBefore = JSON.stringify(Store.s.templateFiles);
        Store.applyServer(res.data, Outbox.ops);
        this.userUI();
        if (JSON.stringify(Store.s.templateFiles) !== tfBefore) Cert.Templates.prefetch();
        if (ui.page === 'buat') Buat.preview();
        if (ui.page === 'pengaturan' && !document.activeElement.closest('.page-pengaturan')) Pengaturan.render();
        Outbox.schedule(0);
      } else if (res.code === 'AUTH') {
        this.sessionExpired();
      }
      // gagal jaringan → tetap memakai data cache (mode offline)
    },
    onData: null
  };
  App.onData = U.raf(() => {
    if (ui.page === 'dashboard') Dashboard.render();
    else if (ui.page === 'riwayat') Riwayat.render();
  });
  window.App = App;

  /* =====================================================================
     INISIALISASI
     ===================================================================== */
  function init() {
    Store.load();
    Outbox.init();
    Api.warmup();
    Auth.init(); Router.init(); Buat.init(); Hasil.init(); Riwayat.init(); Pengaturan.init(); Viewer.init(); Chart.bind();
    Store.on(() => App.onData());
    Outbox.on(() => updateSyncUI());
    window.addEventListener('online', updateSyncUI);
    window.addEventListener('offline', updateSyncUI);
    $('#sync-pill').addEventListener('click', () => {
      if (Outbox.ops.length) { toast('Mencoba mengirim ulang…', 'info', 1500); Outbox.retry = 0; Outbox.schedule(0); }
      else toast(Api.demo ? 'Mode demo: data tersimpan di browser ini.' : 'Semua data sudah tersimpan di Google Sheets.', 'info');
    });
    $('#recent-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dl]'); if (!b) return;
      const row = b.closest('[data-id]'); const rec = Data.find(row.dataset.j, row.dataset.id);
      if (rec) Downloads.choose(row.dataset.j, rec);
    });
    $$('[data-toggle-pass]').forEach((b) => b.addEventListener('click', () => {
      const i = b.parentElement.querySelector('input');
      const show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      b.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
      b.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
    }));
    $('#demo-banner').hidden = !Api.demo;
    updateSyncUI();

    const s = Store.s;
    if (s.token && s.lastActive && Date.now() - s.lastActive < Auth.idleLimit()) {
      // Stale-while-revalidate: tampil seketika dari cache, lalu segarkan dari server.
      App.enter();
      App.revalidate();
      Outbox.schedule(300);
    } else {
      if (s.token) Store.clear();
      App.showLogin(null);
      setTimeout(() => { const f = $('#form-login'); (f.username.value ? f.password : f.username).focus({ preventScroll: true }); }, 50);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
