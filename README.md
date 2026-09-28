# Piagam AHE

Aplikasi web untuk membuat, menyimpan, dan mengunduh (PDF/JPG) piagam kelulusan **Piagam Ahe** (les baca) dan **Piagam Ala** (berhitung "Ala Sekolah"), Lembaga Pendidikan Anak Hebat Indonesia.

- **Frontend:** HTML/CSS/JS murni (folder ini) → GitHub Pages
- **Backend:** Google Apps Script sebagai REST API (`Kode.gs`, diberikan terpisah) → Google Sheets & Drive
- **Mobile-first**, SPA, simpan optimistis, tahan sinyal putus

## Struktur

```
index.html            Kerangka semua halaman (SPA)
css/style.css         Tampilan (design system krem–ungu–oranye)
js/config.js          ← ISI GAS_URL DI SINI
js/core.js            Utilitas, cache lokal, state
js/api.js             fetch ke GAS, antrean sinkron (outbox), mode demo
js/certificate.js     Gambar piagam di canvas, PDF (jsPDF) & JPG
js/app.js             Halaman: login, dashboard, buat, hasil, riwayat, pengaturan
assets/               Logo & ikon
```

Panduan lengkap ada di **PANDUAN-INSTALASI.md**.
