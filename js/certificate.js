/* =====================================================================
   CERTIFICATE — menggambar piagam di <canvas> pada resolusi asli template,
   cache gambar template (memori + IndexedDB), ekspor PDF (jsPDF) & JPG.
   ===================================================================== */
(function () {
  'use strict';

  const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  /* Posisi isian (PRD §7.3) dalam piksel pada ukuran referensi template.
     x,y = titik acuan; y = garis dasar teks. maxW = lebar maksimum sebelum teks mengecil. */
  const DEFAULT = {
    ahe: {
      refW: 1491, refH: 1054,
      fields: {
        nomor:    { label: 'Nomor',            x: 815,  y: 172, size: 26, maxW: 420, align: 'center', font: 'Inter',       weight: 600, color: '#2B1B3D' },
        nama:     { label: 'Nama Lengkap',     x: 930,  y: 378, size: 58, maxW: 860, align: 'center', font: 'Nunito Sans', weight: 900, color: '#C2185B' },
        ttl:      { label: 'Tempat Tgl Lahir', x: 918,  y: 475, size: 30, maxW: 470, align: 'left',   font: 'Inter',       weight: 600, color: '#2B1B3D' },
        unit:     { label: 'Nama Unit',        x: 500,  y: 585, size: 30, maxW: 400, align: 'left',   font: 'Inter',       weight: 600, color: '#2B1B3D' },
        tglLulus: { label: 'Tgl Lulus',        x: 1157, y: 585, size: 30, maxW: 290, align: 'left',   font: 'Inter',       weight: 600, color: '#2B1B3D' },
        kepala:   { label: 'Kepala Unit',      x: 1003, y: 815, size: 30, maxW: 440, align: 'center', font: 'Inter',       weight: 700, color: '#2B1B3D' }
      }
    },
    ala: {
      refW: 1486, refH: 1059,
      fields: {
        nomor:    { label: 'Nomor',            x: 715,  y: 465, size: 26, maxW: 420, align: 'center', font: 'Inter',       weight: 600, color: '#2B1B3D' },
        nama:     { label: 'Nama Lengkap',     x: 732,  y: 618, size: 56, maxW: 860, align: 'center', font: 'Nunito Sans', weight: 900, color: '#C2185B' },
        kelompok: { label: 'Kelompok',         x: 740,  y: 706, size: 32, maxW: 560, align: 'center', font: 'Nunito Sans', weight: 800, color: '#2B1B3D' },
        desa:     { label: 'Desa / Kelurahan', x: 645,  y: 747, size: 24, maxW: 230, align: 'center', font: 'Inter',       weight: 600, color: '#2B1B3D' },
        tglLulus: { label: 'Tgl Lulus',        x: 912,  y: 742, size: 24, maxW: 230, align: 'center', font: 'Inter',       weight: 600, color: '#2B1B3D' },
        kepala:   { label: 'Kepala Unit',      x: 1190, y: 945, size: 30, maxW: 380, align: 'center', font: 'Inter',       weight: 700, color: '#2B1B3D' }
      }
    }
  };

  const Cert = {
    DEFAULT,
    /** Layout efektif = bawaan + hasil kalibrasi yang tersimpan (per field). */
    layout(jenis, override) {
      const base = DEFAULT[jenis];
      const ov = override !== undefined ? override : (Store.s.layouts && Store.s.layouts[jenis]);
      const fields = {};
      Object.keys(base.fields).forEach((k) => {
        const o = (ov && ov.fields && ov.fields[k]) || {};
        const f = Object.assign({}, base.fields[k]);
        ['x', 'y', 'size', 'maxW'].forEach((p) => { if (typeof o[p] === 'number' && isFinite(o[p])) f[p] = o[p]; });
        if (o.color) f.color = o.color;
        if (o.align) f.align = o.align;
        if (o.kapital) f.kapital = o.kapital;
        fields[k] = f;
      });
      return { refW: base.refW, refH: base.refH, fields };
    },
    valueOf(jenis, key, rec) {
      const v = rec && rec[key];
      if (key === 'tglLulus') return U.fmtTgl(v);
      return String(v == null ? '' : v).trim();
    }
  };

  /* ---------------- Font ---------------- */
  let fontsP = null;
  Cert.fontsReady = () => fontsP || (fontsP = (async () => {
    if (!document.fonts || !document.fonts.load) return;
    const specs = ['900 40px "Nunito Sans"', '800 40px "Nunito Sans"', '700 30px Inter', '600 30px Inter', '400 30px Inter'];
    const timeout = new Promise((r) => setTimeout(r, 3500));
    await Promise.race([Promise.all(specs.map((s) => document.fonts.load(s).catch(() => null))), timeout]);
  })());

  /* ---------------- Template (memori → IndexedDB → server) ---------------- */
  const Templates = {
    mem: {}, inflight: {},
    meta(jenis) { return (Store.s.templateFiles || {})[jenis] || null; },
    /** Sinkron: gambar siap pakai (atau null jika belum ada / masih dimuat). */
    peek(jenis) {
      const m = this.meta(jenis);
      const c = this.mem[jenis];
      if (!m) return null;
      return c && c.version === m.version ? c.img : undefined;
    },
    async get(jenis) {
      const m = this.meta(jenis);
      if (!m) return null;
      const c = this.mem[jenis];
      if (c && c.version === m.version) return c.img;
      const key = jenis + '|' + m.version;
      if (this.inflight[key]) return this.inflight[key];
      this.inflight[key] = (async () => {
        let rec = await U.idb.get('tpl_' + jenis);
        if (!rec || rec.version !== m.version || !rec.blob) {
          const res = await Api.call('getTemplate', { jenis });
          if (!res.success) throw new Error(res.message || 'Gagal memuat template');
          if (!res.data) return null;
          rec = { version: res.data.meta.version, blob: U.base64ToBlob(res.data.base64, res.data.mime) };
          U.idb.set('tpl_' + jenis, rec);
        }
        const img = await blobToImage(rec.blob);
        this.mem[jenis] = { version: m.version, img, w: img.naturalWidth, h: img.naturalHeight };
        return img;
      })().finally(() => { delete this.inflight[key]; });
      return this.inflight[key];
    },
    prefetch() { ['ahe', 'ala'].forEach((j) => this.get(j).catch(() => null)); },
    dims(jenis) { const c = this.mem[jenis]; return c ? { w: c.w, h: c.h } : null; }
  };
  Cert.Templates = Templates;

  function blobToImage(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('File template tidak bisa dibaca sebagai gambar.')); };
      img.decoding = 'async';
      img.src = url;
    });
  }

  /* ---------------- Menggambar ---------------- */
  /**
   * Gambar piagam secara sinkron. img: HTMLImageElement template, atau null = template sementara.
   * opts.markers: tampilkan titik acuan kalibrasi. opts.layout: layout khusus (kalibrasi).
   */
  Cert.drawSync = function (canvas, jenis, rec, img, opts) {
    opts = opts || {};
    const L = opts.layout || Cert.layout(jenis);
    const W = img ? img.naturalWidth : L.refW;
    const H = img ? img.naturalHeight : L.refH;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (img) ctx.drawImage(img, 0, 0, W, H);
    else drawFallback(ctx, jenis, W, H, L);

    const sx = W / L.refW, sy = H / L.refH;
    Object.keys(L.fields).forEach((k) => {
      const f = L.fields[k];
      const text = U.hurufKapital(Cert.valueOf(jenis, k, rec), f.kapital);   // format huruf dari Kalibrasi
      if (text) drawFitted(ctx, text, f, sx, sy);            // field kosong = tidak ada teks (garis template tetap bersih)
      if (opts.markers) drawMarker(ctx, k, f, sx, sy, opts.active === k);
    });
    return { w: W, h: H };
  };

  function fontStr(f, size) { return `${f.weight || 600} ${size}px "${f.font || 'Inter'}", system-ui, sans-serif`; }

  function drawFitted(ctx, text, f, sx, sy) {
    const x = f.x * sx, y = f.y * sy, maxW = f.maxW * sx;
    let size = f.size * sx;
    ctx.font = fontStr(f, size);
    let w = ctx.measureText(text).width;
    if (w > maxW) {                                           // teks panjang → mengecil otomatis
      size = Math.max(f.size * sx * 0.5, size * (maxW / w) * 0.995);
      ctx.font = fontStr(f, size);
      w = ctx.measureText(text).width;
    }
    ctx.fillStyle = f.color || '#2B1B3D';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = f.align || 'left';
    if (w > maxW) {                                           // masih terlalu panjang → dipadatkan horizontal
      const k = maxW / w;
      ctx.save();
      ctx.translate(x, y); ctx.scale(k, 1);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(text, x, y);
    }
  }

  function drawMarker(ctx, key, f, sx, sy, active) {
    const x = f.x * sx, y = f.y * sy, w = f.maxW * sx, h = f.size * sx;
    const left = f.align === 'center' ? x - w / 2 : f.align === 'right' ? x - w : x;
    ctx.save();
    ctx.strokeStyle = active ? '#F58220' : 'rgba(214,69,69,.85)';
    ctx.fillStyle = active ? 'rgba(245,130,32,.10)' : 'rgba(214,69,69,.06)';
    ctx.lineWidth = active ? 3 : 2;
    ctx.setLineDash([8, 6]);
    ctx.fillRect(left, y - h, w, h * 1.25);
    ctx.strokeRect(left, y - h, w, h * 1.25);
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); ctx.stroke();
    ctx.font = '700 18px Inter, sans-serif';
    ctx.fillStyle = active ? '#C25E0A' : '#B02E2E';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(f.label || key, left + 4, y - h - 4);
    ctx.restore();
  }

  /* Template sementara (dipakai bila file template resmi belum diunggah).
     Garis-garisnya mengikuti koordinat layout sehingga tetap berguna untuk kalibrasi. */
  function drawFallback(ctx, jenis, W, H, L) {
    const sx = W / L.refW, sy = H / L.refH;
    const F = L.fields;
    const ahe = jenis === 'ahe';
    const main = ahe ? '#6B2F8F' : '#F58220';
    ctx.fillStyle = '#FFFBF0'; ctx.fillRect(0, 0, W, H);
    // bingkai
    ctx.strokeStyle = '#F58220'; ctx.lineWidth = 16 * sx;
    roundRect(ctx, 22 * sx, 22 * sy, W - 44 * sx, H - 44 * sy, 26 * sx); ctx.stroke();
    // pita kiri
    const bandW = (ahe ? 290 : 250) * sx;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, ahe ? '#7B3AA3' : '#F7953D'); g.addColorStop(1, ahe ? '#5A2478' : '#E06F10');
    ctx.fillStyle = g;
    ctx.save(); roundRect(ctx, 30 * sx, 30 * sy, bandW, H - 60 * sy, 18 * sx); ctx.clip();
    ctx.fillRect(30 * sx, 30 * sy, bandW, H - 60 * sy); ctx.restore();
    const bx = 30 * sx + bandW / 2;
    ctx.fillStyle = '#FFC93C'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${34 * sx}px system-ui, sans-serif`;
    ctx.fillText('★ ★ ★ ★ ★', bx, 110 * sy);
    ctx.beginPath(); ctx.arc(bx, 330 * sy, 70 * sx, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `900 ${64 * sx}px "Nunito Sans", sans-serif`;
    ctx.fillText(ahe ? 'Ahe' : 'Ala', bx, 334 * sy);
    ctx.font = `900 ${28 * sx}px "Nunito Sans", sans-serif`;
    ctx.fillText('ANAK HEBAT', bx, 470 * sy); ctx.fillText('INDONESIA', bx, 506 * sy);
    ctx.fillStyle = '#FFC93C'; ctx.fillRect(bx - 45 * sx, 540 * sy, 90 * sx, 8 * sy);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `800 ${20 * sx}px "Nunito Sans", sans-serif`;
    ctx.fillText(ahe ? 'LES BACA' : 'BERHITUNG', bx, H - 110 * sy); ctx.fillText(ahe ? 'AHE' : 'ALA SEKOLAH', bx, H - 82 * sy);

    const cx = (bandW + 30 * sx + W - 30 * sx) / 2;
    const label = (t, x, y, align, size, color, weight) => {
      ctx.fillStyle = color || '#6B5F78'; ctx.textAlign = align || 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `${weight || 500} ${(size || 22) * sx}px Inter, sans-serif`; ctx.fillText(t, x * (1), y);
    };
    const line = (f, extra) => {
      const x = f.x * sx, y = f.y * sy + 10 * sy, w = (f.maxW + (extra || 0)) * sx;
      const left = f.align === 'center' ? x - w / 2 : x;
      ctx.save(); ctx.strokeStyle = '#CDBB97'; ctx.lineWidth = 2 * sx; ctx.setLineDash([3 * sx, 6 * sx]);
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + w, y); ctx.stroke(); ctx.restore();
    };
    ctx.textBaseline = 'alphabetic';
    if (ahe) {
      label('LEMBAGA PENDIDIKAN BACA', cx, 82 * sy, 'center', 22, '#4A3D5A', 700);
      ctx.fillStyle = '#C2185B'; ctx.font = `900 ${56 * sx}px "Nunito Sans", sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('PIAGAM KELULUSAN', cx, 140 * sy);
      label('Nomor :', F.nomor.x * sx - F.nomor.maxW * sx / 2 - 10 * sx, F.nomor.y * sy, 'right', 20);
      line(F.nomor);
      label('Diberikan dengan rasa bangga dan bahagia kepada:', F.nama.x * sx, 280 * sy, 'center', 24);
      line(F.nama);
      label('Lahir di :', F.ttl.x * sx - 12 * sx, F.ttl.y * sy, 'right', 22);
      line(F.ttl);
      label('Unit :', F.unit.x * sx - 12 * sx, F.unit.y * sy, 'right', 22);
      line(F.unit);
      label('Lulus :', F.tglLulus.x * sx - 12 * sx, F.tglLulus.y * sy, 'right', 22);
      line(F.tglLulus);
      label('Telah menyelesaikan seluruh modul dan dinyatakan LULUS', cx, 668 * sy, 'center', 24, '#2B1B3D', 600);
      label('pada program pembelajaran Kemahiran Membaca AHE.', cx, 704 * sy, 'center', 24, '#2B1B3D', 600);
      label('Kepala Unit,', F.kepala.x * sx, 740 * sy, 'center', 22);
      line(F.kepala);
      seal(ctx, 560 * sx, 810 * sy, 58 * sx);
    } else {
      label('PROGRAM BERHITUNG', cx, 190 * sy, 'center', 24, '#4A3D5A', 700);
      ctx.fillStyle = '#C2185B'; ctx.font = `900 ${62 * sx}px "Nunito Sans", sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('PIAGAM KELULUSAN', cx, 262 * sy);
      ctx.fillStyle = '#F58220'; ctx.font = `900 ${34 * sx}px "Nunito Sans", sans-serif`;
      ctx.fillText('"Ala Sekolah"', cx, 318 * sy);
      label('Nomor :', F.nomor.x * sx - F.nomor.maxW * sx / 2 - 10 * sx, F.nomor.y * sy, 'right', 20);
      line(F.nomor);
      label('Diberikan kepada:', F.nama.x * sx, 540 * sy, 'center', 24);
      line(F.nama);
      label('telah lulus pada kelompok', F.kelompok.x * sx, 664 * sy, 'center', 20);
      line(F.kelompok);
      line(F.desa); line(F.tglLulus);
      label('Desa / Kelurahan', F.desa.x * sx, (F.desa.y + 40) * sy, 'center', 18);
      label('Tanggal Lulus', F.tglLulus.x * sx, (F.tglLulus.y + 45) * sy, 'center', 18);
      label('Kepala Unit,', F.kepala.x * sx, 830 * sy, 'center', 22);
      line(F.kepala);
      seal(ctx, 470 * sx, 900 * sy, 58 * sx);
    }
    label('Template sementara · unggah template resmi di menu Pengaturan', W - 60 * sx, H - 48 * sy, 'right', 15, 'rgba(107,95,120,.55)', 500);
    ctx.fillStyle = main;
  }

  function seal(ctx, x, y, r) {
    ctx.save();
    const g = ctx.createRadialGradient(x - r / 3, y - r / 3, r / 5, x, y, r);
    g.addColorStop(0, '#FFD66B'); g.addColorStop(1, '#F58220');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${r}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', x, y + r * 0.05);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /** Render lengkap (menunggu font & template). Mengembalikan info ukuran & status template. */
  Cert.render = async function (canvas, jenis, rec, opts) {
    await Cert.fontsReady();
    let img = null, err = null;
    try { img = await Templates.get(jenis); } catch (e) { err = e; }
    const d = Cert.drawSync(canvas, jenis, rec, img, opts);
    return { w: d.w, h: d.h, hasTemplate: !!img, error: err };
  };

  /* ---------------- Ekspor ---------------- */
  Cert.preloadPDF = () => U.loadScript(JSPDF_URL).catch(() => null);

  Cert.toJPG = async function (jenis, rec) {
    const c = document.createElement('canvas');
    await Cert.render(c, jenis, rec);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat gambar'))), 'image/jpeg', 0.95));
  };

  Cert.toPDF = async function (jenis, rec) {
    const c = document.createElement('canvas');
    const [, info] = await Promise.all([U.loadScript(JSPDF_URL), Cert.render(c, jenis, rec)]);
    const { jsPDF } = window.jspdf;
    const landscape = info.w >= info.h;
    const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const scale = Math.min(pw / info.w, ph / info.h);
    const w = info.w * scale, h = info.h * scale;
    pdf.setProperties({ title: `Piagam ${jenis === 'ahe' ? 'Ahe' : 'Ala'} — ${rec.nama || ''}`, creator: 'Piagam AHE' });
    pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h, undefined, 'FAST');
    return pdf.output('blob');
  };

  window.Cert = Cert;
})();
