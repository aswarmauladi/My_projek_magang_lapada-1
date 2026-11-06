# Ruang Pembinaan

Fondasi aplikasi web asistensi pelayanan pembinaan WBP. Dashboard statis disajikan langsung oleh Express agar frontend dan API memakai origin yang sama.

## Fitur yang sudah dibuat

- Autentikasi login pengguna
- JWT token
- Role-based access control
- Database SQLite lokal
- API untuk data WBP
- Dashboard endpoint
- Dashboard web responsif
- Pencarian dan pencatatan data WBP contoh
- Asisten tanya-jawab WBP berbasis query database dan hak akses
- Pertanyaan dan jawaban Asisten dapat dihapus satu per satu atau sekaligus; riwayat chat hanya tersimpan sementara di halaman aktif
- Dasbor terpisah untuk administrator dan petugas pembinaan
- Manajemen akun petugas, program pembinaan, dan penugasan jadwal
- Laporan pelaksanaan/progres petugas dengan pemeriksaan admin
- Log aktivitas penting yang dapat dilihat administrator

## Prasyarat

Pastikan Node.js LTS dan Ollama sudah terinstall di komputer.

- Download: https://nodejs.org/
- Ollama: https://ollama.com/download

## Setup

1. Install dependency:
   npm install

2. Copy environment:
   copy .env.example .env

3. Unduh model lokal ringan:
   ollama pull qwen2.5:1.5b

4. Pastikan Ollama berjalan di alamat lokal `http://127.0.0.1:11434`.

5. Jalankan server:
   npm run dev

6. Buka dashboard web:
   http://localhost:5001

7. Pemeriksaan API:
   http://localhost:5001/api/health

## Akun uji lokal

- Username: admin
- Password: admin123

Akun ini hanya untuk pengujian lokal. Ganti kredensial, secret JWT, dan konfigurasi keamanan sebelum aplikasi dipakai dengan data nyata atau dipublikasikan.

## Endpoint utama

- POST /api/auth/login
- GET /api/auth/profile
- PUT /api/auth/profile (profil akun sendiri)
- GET /api/auth/profile/photo (foto profil akun sendiri)
- PUT /api/auth/profile/photo (unggah JPEG/PNG/WebP, maksimal 2 MB)
- DELETE /api/auth/profile/photo (hapus foto profil akun sendiri)
- PUT /api/auth/credentials (ubah username/password akun sendiri)
- GET /api/login-background/status (status gambar latar login publik)
- GET /api/login-background/image (gambar latar login publik)
- GET /api/login-background/settings (admin)
- PUT /api/login-background (admin; unggah JPEG/PNG/WebP maksimal 2 MB)
- DELETE /api/login-background (admin; kembali ke latar bawaan)
- GET /api/dashboard
- GET /api/wbp
- GET /api/wbp/:id
- POST /api/wbp
- PUT /api/wbp/:id
- DELETE /api/wbp/:id (admin)
- GET /api/schedules?date=YYYY-MM-DD
- POST /api/schedules
- PUT /api/schedules/:id
- DELETE /api/schedules/:id (admin)
- GET /api/progress/summary
- GET /api/progress (admin/pembinaan)
- POST /api/progress (admin/pembinaan)
- PUT /api/progress/:id (admin/pembinaan)
- DELETE /api/progress/:id (admin)
- GET /api/institution
- POST /api/institution (admin/pembinaan)
- PUT /api/institution (admin/pembinaan)
- POST /api/assistant/ask
- GET /api/admin/staff (admin)
- POST /api/admin/staff (admin)
- PUT /api/admin/staff/:id (admin)
- GET /api/admin/programs
- POST /api/admin/programs (admin)
- PUT /api/admin/programs/:id (admin)
- DELETE /api/admin/programs/:id (admin; program yang terkait jadwal harus dinonaktifkan agar histori tetap terjaga)
- GET /api/admin/audit (admin)
- DELETE /api/admin/audit (admin; membersihkan riwayat dan mencatat aktivitas pembersihan)
- POST /api/schedules/:id/execution (petugas yang ditugaskan)
- POST /api/progress/:id/review (admin)

## Catatan fitur

- Dashboard menampilkan jumlah dan agenda kegiatan berdasarkan tanggal setempat Lapas (WIB). Jadwal dapat dilihat berdasarkan tanggal; admin dan petugas pembinaan dapat menambah/mengedit, sedangkan penghapusan khusus admin.
- Progress pembinaan berupa catatan evaluasi petugas: kehadiran, status perkembangan, catatan, dan tindak lanjut. Tidak ada skor otomatis.
- Admin dan petugas pembinaan dapat melihat detail serta mencatat evaluasi; role lain hanya menerima ringkasan agregat. Riwayat evaluasi mencegah data WBP dihapus tanpa penanganan riwayat terlebih dahulu.
- Profil lembaga disimpan lokal; admin dan petugas pembinaan dapat menambah/mengeditnya, sedangkan role internal lain hanya dapat melihat.
- Administrator mengelola akun petugas pembinaan dan program. Akun petugas dapat dinonaktifkan tanpa menghapus riwayat; sesi akun nonaktif ditolak oleh backend.
- Jadwal dikelola administrator dan dapat dihubungkan ke program serta satu petugas yang ditugaskan. Petugas hanya melihat jadwal penugasannya, mencatat pelaksanaan, dan mengirim laporan progres dari penugasan tersebut.
- Laporan petugas berstatus menunggu pemeriksaan, lalu administrator dapat menyetujui atau meminta revisi dengan catatan. Petugas hanya melihat laporan miliknya dan status pemeriksaannya; catatan progres lama tetap dipertahankan.
- Aktivitas seperti login, perubahan data WBP, jadwal, program, akun petugas, laporan, kredensial, profil lembaga, dan latar login dicatat pada log internal yang hanya dapat dibaca admin.
- Administrator dapat mengganti atau menghapus gambar latar sisi kanan halaman login. Gambar tersebut terlihat sebelum login, disimpan pada database lokal, dan dibatasi ke JPEG/PNG/WebP maksimal 2 MB.
- Admin dan petugas mengelola profil akunnya sendiri melalui nama, email, telepon, dan jabatan; username dan role tidak dapat diubah dari halaman profil.
- Pengguna dapat mengganti username/password sendiri dengan memasukkan password lama; password baru minimal 12 karakter dan disimpan sebagai hash.
- Ollama lokal memahami maksud pertanyaan dan menyusun jawaban dari fakta hasil query SQLite. Backend tetap memvalidasi hak akses dan mengambil data; jawaban hanya menggunakan hasil query yang diizinkan.
- Asisten dapat menghitung selisih kalender tanggal masuk hingga tanggal keluar, atau hingga tanggal hari ini bila tanggal keluar belum tercatat. Hasil ini bukan penetapan masa pidana resmi.
- Backend mengirim pertanyaan dan hanya baris/fakta hasil query yang relevan ke Ollama lokal, bukan seluruh database. Gunakan `127.0.0.1` atau jaringan privat yang firewall-nya hanya mengizinkan backend; jangan buka port Ollama ke internet atau gunakan model `:cloud` untuk data WBP.
- Jika Ollama tidak tersedia atau `OLLAMA_ENABLED=false`, asisten kembali ke pencocokan pola lokal dan jawabannya lebih terbatas.
- Pencarian nama, nomor register, dan profil WBP dibatasi untuk admin dan petugas pembinaan. Role lain hanya mendapat jawaban agregat.
- Hindari data pribadi atau data operasional WBP pada lingkungan uji ini sampai keamanan dan persetujuan penggunaan resmi ditinjau.

## untuk menjalankan aplikasi dan memberhentikannya sebelum menjalankan lagi

*untuk menutup/menghentikan aplikasi
  tasklist | findstr node.exe
  taskkill /PID (pot akhir console) /F

*untuk menjalankan aplikasi
  netstat -ano | findstr :5001
  npm run dev