/**
 * Loading Screen Configuration v2
 * Contains tips, facts, motivational quotes, and system notifications
 * Theme: Dark Navy + Amber/Gold + Cyan Accents
 */

export const LOADING_SCREEN_CONFIG = {
  // Application info
  app: {
    name: 'PT REBINMAS JAYA',
    subtitle: 'Payroll Intelligence System',
    tagline: 'Precision in Every Calculation'
  },

  // Tips - Fakta tentang sistem payroll
  tips: [
    "Menghitung ribuan data karyawan dalam hitungan detik dengan akurasi tinggi.",
    "Integrasi data absensi, lembur, dan bonus dalam satu sistem terpadu.",
    "THR 2026 dihitung otomatis berdasarkan masa kerja dan gaji pokok.",
    "PPh 21 menggunakan metode TER sesuai peraturan perpajakan terbaru.",
    "Dashboard real-time menampilkan produktivitas per gang dan afdeling.",
    "Sistem payroll modern mengurangi kesalahan hitung secara signifikan.",
    "Data karyawan tersinkronisasi dengan database HR secara langsung.",
    "Laporan daftar upah bisa diekspor ke Excel dalam format resmi.",
    "Keamanan data karyawan terjamin dengan sistem autentikasi berlapis.",
    "Analisis komprehensif menampilkan breakdown setiap komponen upah.",
    "Integritas data adalah fondasi utama sistem payroll yang handal.",
    "Setiap rupiah dihitung dengan teliti untuk keadilan semua karyawan.",
    "Sistem dirancang untuk skala besar: ribuan karyawan, satu klik.",
    "Peraturan THR terbaru mengikuti keputusan pemerintah yang berlaku.",
    "BPJS ketenagakerjaan dan kesehatan dihitung sesuai regulasi BP Jamsostek.",
    "Metode TER (Tarif Efektif Tahunan) memberikan keringanan pajak karyawan.",
    "Premi panen dihitung berdasarkan produktivitas dan hasil kerja.",
    "Overtime (lembur) menggunakan sistem tier untuk keadilan kompensasi.",
    "Data attendance matrix membantu manajer memantau kehadiran harian.",
    "Export ke Google Spreadsheet memungkinkan kolaborasi tim secara real-time."
  ],

  // System process labels
  processLabels: [
    'Memuat data karyawan',
    'Mengambil data absensi',
    'Menghitung lembur',
    'Menghitung premi',
    'Menghitung potongan',
    'Menghitung PPh 21',
    'Menyusun laporan',
    'Menyimpan hasil'
  ],

  // Motivational quotes (Indonesian)
  quotes: [
    "Kerja keras hari ini, kesuksesan besok.",
    "Satu langkah kecil menuju konsistensi adalah awal dari pencapaian besar.",
    "Ketekunan dalam bekerja adalah kunci menuju kemakmuran.",
    "Setiap tetes keringat adalah investasi untuk masa depan.",
    "Kesuksesan adalah hasil dari persiapan, kerja keras, dan belajar dari kegagalan.",
    "Bersyukur atas pekerjaan yang kita miliki adalah awal dari kebahagiaan.",
    "Kecil dalam detail, besar dalam dampak.",
    "Disiplin adalah jembatan antara tujuan dan pencapaian.",
    "Setiap pagi adalah kesempatan baru untuk menjadi lebih baik.",
    "Tidak ada hasil tanpa usaha. Tidak ada sukses tanpa kerja keras.",
    "Bersama kita bisa lebih baik. Teamwork makes the dream work.",
    "Data yang akurat adalah fondasi keputusan yang tepat."
  ],

  // Fun facts about palm oil industry
  funFacts: [
    "Kelapa sawit adalah tanaman penghasil minyak nabati paling efisien di dunia.",
    "Satu hektar kelapa sawit dapat menghasilkan hingga 4 ton minyak per tahun.",
    "Indonesia adalah produsen minyak kelapa sawit terbesar di dunia.",
    "Kelapa sawit bisa hidup produktif selama 25-30 tahun.",
    "Satu pohon kelapa sawit bisa menghasilkan 12-15 tandan buah per tahun.",
    "Minyak kelapa sawit mengandung Vitamin E (Tokotrienol) untuk kesehatan jantung.",
    "Kelapa sawit menyerap lebih banyak CO2 per hektar dibanding hutan tanaman lainnya.",
    "Petani kelapa sawit Indonesia menghasilkan lebih dari 40 juta ton CPO per tahun.",
    "Minyak kelapa sawit digunakan di sekitar 50% produk di supermarket!",
    "Indonesia dan Malaysia menguasai lebih dari 85% produksi kelapa sawit dunia."
  ],

  // Wisdom quotes
  wisdom: [
    "\"Pendidikan adalah senjata paling powerful yang bisa kamu gunakan untuk mengubah dunia.\" — Nelson Mandela",
    "\"Sukses adalah kemampuan untuk bangkit dari kegagalan tanpa kehilangan antusiasme.\" — Winston Churchill",
    "\"Kerja cerdas, kerja keras, tetap rendah hati.\"",
    "\"Jangan takut melambat, yang penting tetap bergerak maju.\"",
    "\"Kesuksesan adalah perjalanan, bukan destinasi.\"",
    "\"Detail adalah fondasi kesempurnaan.\"",
    "\"Akurasi adalah kebiasaan, bukan keberuntungan.\"",
    "\"Ilmu yang diamalkan lebih berharga dari ilmu yang dihafalkan.\""
  ],

  // Notification messages
  notifications: {
    enabled: true,
    rotateInterval: 4500,
    types: {
      info: { icon: '💡', label: 'Info' },
      quote: { icon: '✨', label: 'Motivasi' },
      fact: { icon: '🌴', label: 'Fakta' },
      wisdom: { icon: '💭', label: 'Pepatah' }
    }
  },

  // Animation settings
  animations: {
    tipRotateInterval: 4500,
    treeSwayDuration: 4,
    progressBarDuration: 10,
    backgroundGradientDuration: 20
  }
}

// Helper: get random item
export function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)]
}

// Helper: get all messages as typed objects
export function getAllMessages() {
  return [
    ...LOADING_SCREEN_CONFIG.tips.map(t => ({ type: 'info', text: t })),
    ...LOADING_SCREEN_CONFIG.quotes.map(q => ({ type: 'quote', text: q })),
    ...LOADING_SCREEN_CONFIG.funFacts.map(f => ({ type: 'fact', text: f })),
    ...LOADING_SCREEN_CONFIG.wisdom.map(w => ({ type: 'wisdom', text: w }))
  ]
}

// Helper: get random mixed message
export function getRandomMessage() {
  return getRandomItem(getAllMessages())
}

export default LOADING_SCREEN_CONFIG