# Panduan Instalasi — Piagam AHE

Aplikasi ini terdiri dari **dua bagian** yang dipasang terpisah:

| Bagian | Isi | Dipasang di |
|---|---|---|
| **Backend** | `Kode.gs` (+ `appsscript.json` opsional) | Google Apps Script, terikat ke Google Sheets |
| **Frontend** | `index.html`, `css/`, `js/`, `assets/` | GitHub Pages |

Urutannya: **Backend dulu → salin URL `/exec` → isi `js/config.js` → push ke GitHub Pages.**

> 💡 Frontend bisa langsung dicoba sebelum backend siap. Selama `GAS_URL` masih kosong, aplikasi berjalan dalam **mode demo** (login `admin` / `ahe12345`, data contoh, tersimpan hanya di browser).

---

## Tahap 1 — Backend (Google Apps Script)

### 1.1 Buat spreadsheet & proyek skrip
1. Buka <https://sheets.new> dan beri nama spreadsheet, misalnya **Database Piagam AHE**.
2. Menu **Ekstensi → Apps Script**.
3. Hapus isi `Code.gs`, lalu **tempel seluruh isi `Kode.gs`**. Tekan **💾 Simpan**.
4. Klik **⚙️ Setelan Proyek (Project Settings)** di kiri:
   - **Zona waktu** → pilih `(GMT+08:00) Makassar`.
   - *(opsional)* centang **Tampilkan file manifes "appsscript.json"**, lalu buka file itu dan tempel isi `appsscript.json`.

### 1.2 Jalankan setup (sekali)
1. Kembali ke editor. Di dropdown fungsi (sebelah tombol ▶), pilih **`setupAplikasi`** → klik **▶ Jalankan**.
2. Muncul permintaan izin → **Tinjau izin** → pilih akun Anda → **Lanjutan → Buka proyek (tidak aman)** → **Izinkan**.
   *(Peringatan "tidak aman" wajar untuk skrip buatan sendiri.)*
3. Buka **Log eksekusi**. Pastikan muncul **✅ SETUP SELESAI**.

Hasil setup:
- Sheet **Piagam_Ahe**, **Piagam_Ala**, dan **Pengaturan** di spreadsheet Anda.
- Folder Drive **Piagam AHE / Template**.
- Akun admin awal: **`admin` / `ahe12345`** → **wajib diganti** setelah login pertama.

> `setupAplikasi()` aman dijalankan ulang: data yang sudah ada tidak dihapus.

### 1.3 Unggah template piagam
Pilih salah satu cara:
- **Lewat aplikasi (paling mudah):** setelah login, buka **Pengaturan → File Template Piagam → Unggah**.
- **Lewat Google Drive:** unggah `Piagam_Ahe_1.jpg` dan `Piagam_Ala_1.jpg` ke folder **Piagam AHE / Template**, lalu jalankan fungsi `cekTemplate` untuk memastikan terbaca.

Mengganti template di kemudian hari cukup dengan mengunggah file baru. Aplikasi memakai file **terbaru** yang namanya diawali `Piagam_Ahe` / `Piagam_Ala`.

### 1.4 Deploy sebagai Web App
1. Klik **Terapkan (Deploy) → Deployment baru**.
2. Ikon ⚙️ di "Pilih jenis" → **Aplikasi web**.
3. Isi:
   - **Jalankan sebagai (Execute as):** `Saya (Me)`
   - **Yang memiliki akses (Who has access):** `Siapa saja (Anyone)`
4. **Terapkan** → **salin URL Aplikasi web** (berakhiran `/exec`).

> ⚠️ Jika pilihan **"Siapa saja"** tidak muncul, akun Google sekolah Anda dibatasi admin Workspace. Gunakan akun Gmail pribadi untuk spreadsheet & skrip ini.

---

## Tahap 2 — Hubungkan frontend

Buka **`js/config.js`** dengan Notepad / VS Code, lalu tempel URL tadi:

```js
GAS_URL: 'https://script.google.com/macros/s/AKfy..../exec',
```

Simpan. Hanya file ini yang perlu diubah.

---

## Tahap 3 — Deploy ke GitHub Pages

**Folder kerja = folder hasil ekstrak ZIP ini** (yang langsung berisi `index.html`, `css`, `js`, `assets`). Jalankan semua perintah git dari folder ini, jangan dari folder induknya.

1. Buka folder di File Explorer → klik address bar → ketik `powershell` → Enter.
2. Pastikan Anda berada di folder yang benar:
   ```powershell
   dir
   ```
   Baris-barisnya harus memuat `index.html`, `css`, `js`, `assets`. Kalau belum, **jangan lanjut**.
3. Buat repository **Public** baru di GitHub (tanpa README), misalnya `piagam-ahe`.
4. Kirim file:
   ```powershell
   git init
   git add .
   git commit -m "Upload pertama Piagam AHE"
   git branch -M main
   git remote add origin https://github.com/USERNAME/piagam-ahe.git
   git push -u origin main
   ```
   Saat diminta password, tempel **Personal Access Token** (bukan password akun). Layar memang tidak menampilkan apa-apa saat menempel. Itu normal.
5. Di GitHub: **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main / (root)** → **Save**. Centang **Enforce HTTPS**.
6. Tunggu 1–2 menit, lalu buka `https://USERNAME.github.io/piagam-ahe/`.

**Update di kemudian hari** (setelah mengubah file frontend):
```powershell
git add .
git commit -m "Update"
git push
```
Jika tampilan masih versi lama, tekan **Ctrl+Shift+R**.

---

## Tahap 4 — Setelah online

1. Login `admin` / `ahe12345` → buka **Pengaturan → Akun Admin** → ganti username & kata sandi.
2. **Pengaturan → Template Isian Otomatis**: isi Nomor awal & Nama Kepala Unit untuk Ahe dan Ala.
3. **Pengaturan → Kalibrasi Posisi Teks**: cocokkan posisi tulisan dengan garis template resmi.
   - Pilih kolom (misal *Nama Lengkap*), lalu **ketuk titik di kanvas** untuk memindahkannya, atau ubah angka X / Y / Ukuran / Lebar maks.
   - Tekan **Simpan Posisi**. Koordinat awal diambil dari PRD §7.3.
4. Buat 1 piagam uji → **Unduh PDF** → cetak → periksa posisinya.

---

## Mengubah backend di kemudian hari (penting)

Agar URL `/exec` **tidak berubah**:
**Terapkan → Kelola deployment → ✏️ Edit → Versi: Versi baru → Terapkan.**
Jangan membuat "Deployment baru", karena URL-nya akan berbeda dan `config.js` harus diubah lagi.

---

## Fungsi bantu di editor Apps Script

| Fungsi | Kegunaan |
|---|---|
| `setupAplikasi` | Menyiapkan sheet, akun awal, folder (aman diulang) |
| `resetAkunAdmin` | Lupa sandi → kembali ke `admin` / `ahe12345` |
| `cekTemplate` | Mengecek file template di folder Drive |
| `bersihkanCache` | Memaksa aplikasi membaca ulang data dari Sheets |

Mengedit Google Sheets secara manual otomatis membersihkan cache (trigger `onEdit`).

---

## Mengapa aplikasi terasa cepat

- **Satu halaman (SPA):** pindah menu tanpa memuat ulang dan tanpa menunggu server.
- **Simpan optimistis:** piagam langsung tampil & bisa diunduh; pengiriman ke Google Sheets berjalan di latar belakang. Status terlihat di pil kecil di pojok kanan atas (*Tersimpan / Menyimpan… / Offline*).
- **Anti data ganda:** ID dibuat di HP, jadi tombol Simpan yang ditekan berkali-kali atau sinyal putus tidak menggandakan data.
- **Tahan sinyal putus:** perubahan disimpan di HP dan dikirim otomatis saat online kembali.
- **Cache:** data & gambar template disimpan di browser; login cukup satu kali panggilan ke server; server memakai CacheService dan menulis Sheets secara batch.

---

## Masalah umum

| Gejala | Solusi |
|---|---|
| Masih muncul "Mode demo" | `GAS_URL` di `js/config.js` belum diisi / belum di-push |
| "Server tidak mengirim data JSON" | Deploy ulang dengan akses **Siapa saja (Anyone)**; pastikan URL berakhiran `/exec` |
| Login selalu gagal setelah lupa sandi | Jalankan `resetAkunAdmin` di editor |
| "Terlalu banyak percobaan" | Tunggu 5 menit (pengaman login) |
| Template tidak muncul | Nama file harus diawali `Piagam_Ahe` / `Piagam_Ala`; jalankan `cekTemplate` |
| Data yang diedit di Sheets belum muncul | Tarik layar / buka ulang aplikasi; atau jalankan `bersihkanCache` |
| Unduh PDF gagal pertama kali | Butuh internet untuk memuat pustaka jsPDF (setelah itu tersimpan di cache browser) |
| iPhone: file terbuka di tab baru | Tekan **Bagikan → Simpan ke Berkas / Simpan Gambar** |
| Situs GitHub 404 | `git init` dijalankan di folder yang salah; ulangi dari folder yang berisi `index.html` |
