/* =====================================================================
   KONFIGURASI PIAGAM AHE
   ---------------------------------------------------------------------
   Satu-satunya file yang perlu Anda ubah setelah backend di-deploy.

   GAS_URL : tempel URL Web App dari Apps Script (berakhiran /exec).
             Selama masih kosong, aplikasi berjalan dalam MODE DEMO
             (data hanya tersimpan di browser, login admin / ahe12345).
   ===================================================================== */
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzPuM2y7jUVFP1pR4BRT7v8m2J-DeOKOvHi9ebaryYYtMHqC60SRdP2RPU28p9FFGalNQ/exec',

  NAMA_LEMBAGA: 'Anak Hebat Indonesia',
  VERSI: '1.0.0',
  TIMEOUT_MS: 45000,          // batas tunggu satu permintaan ke server
  SESI_MENIT: 60              // keluar otomatis setelah tidak aktif
};
