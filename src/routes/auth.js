const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db/initDb');
const { authenticateToken } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');
const { parseSupportedImage } = require('../services/image');

const router = express.Router();

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    },
    process.env.JWT_SECRET || 'lapas-wbp-secret-key',
    { expiresIn: '8h' }
  );
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ message: 'Username dan password wajib diisi' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Kesalahan database' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Username atau password salah' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ message: 'Username atau password salah' });
    }

    if (user.is_active === 0) return res.status(403).json({ message: 'Akun tidak aktif. Hubungi administrator.' });
    recordAudit(user.id, 'login', 'akun', user.id)
      .then(() => {
        const token = generateToken(user);
        res.json({
          message: 'Login berhasil',
          token,
          user: {
            id: user.id,
            name: user.name,
            username: user.username,
            role: user.role,
          }
        });
      })
      .catch((auditError) => {
        console.error('Gagal mencatat aktivitas login:', auditError.message);
        res.status(500).json({ message: 'Login tidak dapat dicatat. Silakan coba kembali.' });
      });
  });
});

router.get('/profile', authenticateToken, (req, res) => {
  db.get(
    'SELECT id, name, username, role, email, phone, position FROM users WHERE id = ?',
    [req.user.id],
    (error, user) => {
      if (error) return res.status(500).json({ message: 'Gagal mengambil profil akun' });
      if (!user) return res.status(404).json({ message: 'Akun tidak ditemukan' });
      res.json(user);
    }
  );
});

router.get('/profile/photo', authenticateToken, (req, res) => {
  db.get('SELECT profile_image FROM users WHERE id = ?', [req.user.id], (error, user) => {
    if (error) return res.status(500).json({ message: 'Gagal mengambil foto profil' });
    if (!user) return res.status(404).json({ message: 'Akun tidak ditemukan' });
    res.json({ photo: user.profile_image || null });
  });
});

router.put('/profile/photo', authenticateToken, (req, res) => {
  const photo = req.body?.photo;
  if (!parseSupportedImage(photo)) {
    return res.status(400).json({ message: 'Foto harus berupa JPEG, PNG, atau WebP yang valid dan maksimal 2 MB' });
  }

  db.run('UPDATE users SET profile_image = ? WHERE id = ?', [photo, req.user.id], function (error) {
    if (error) return res.status(500).json({ message: 'Gagal menyimpan foto profil' });
    if (!this.changes) return res.status(404).json({ message: 'Akun tidak ditemukan' });
    recordAudit(req.user.id, 'perbarui foto profil', 'akun', req.user.id)
      .then(() => res.json({ message: 'Foto profil berhasil diperbarui', photo }))
      .catch((auditError) => {
        console.error('Foto profil tersimpan, tetapi log aktivitas gagal:', auditError.message);
        res.status(500).json({ message: 'Foto profil tersimpan, tetapi aktivitasnya gagal dicatat' });
      });
  });
});

router.delete('/profile/photo', authenticateToken, (req, res) => {
  db.run('UPDATE users SET profile_image = NULL WHERE id = ?', [req.user.id], function (error) {
    if (error) return res.status(500).json({ message: 'Gagal menghapus foto profil' });
    if (!this.changes) return res.status(404).json({ message: 'Akun tidak ditemukan' });
    recordAudit(req.user.id, 'hapus foto profil', 'akun', req.user.id)
      .then(() => res.json({ message: 'Foto profil berhasil dihapus' }))
      .catch((auditError) => {
        console.error('Foto profil dihapus, tetapi log aktivitas gagal:', auditError.message);
        res.status(500).json({ message: 'Foto profil dihapus, tetapi aktivitasnya gagal dicatat' });
      });
  });
});

router.put('/profile', authenticateToken, (req, res) => {
  const { name, email, phone, position } = req.body || {};
  if ([email, phone, position].some((value) => value != null && typeof value !== 'string')) {
    return res.status(400).json({ message: 'Format email, telepon, atau jabatan tidak valid' });
  }
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
  const normalizedPosition = typeof position === 'string' ? position.trim() : '';

  if (!normalizedName || normalizedName.length > 120) {
    return res.status(400).json({ message: 'Nama wajib diisi (maksimal 120 karakter)' });
  }
  if (normalizedEmail.length > 150
    || (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) {
    return res.status(400).json({ message: 'Format email tidak valid' });
  }
  if (normalizedPhone.length > 30 || normalizedPosition.length > 120) {
    return res.status(400).json({ message: 'Telepon maksimal 30 karakter dan jabatan maksimal 120 karakter' });
  }

  db.run(
    'UPDATE users SET name = ?, email = ?, phone = ?, position = ? WHERE id = ?',
    [normalizedName, normalizedEmail || null, normalizedPhone || null, normalizedPosition || null, req.user.id],
    function (error) {
      if (error) return res.status(500).json({ message: 'Gagal memperbarui profil akun' });
      if (this.changes === 0) return res.status(404).json({ message: 'Akun tidak ditemukan' });
      db.get(
        'SELECT id, name, username, role, email, phone, position FROM users WHERE id = ?',
        [req.user.id],
        (readError, user) => {
          if (readError) return res.status(500).json({ message: 'Profil tersimpan, tetapi gagal dibaca kembali' });
          recordAudit(req.user.id, 'perbarui profil', 'akun', req.user.id)
            .then(() => res.json({ message: 'Profil berhasil diperbarui', user }))
            .catch((auditError) => {
              console.error('Gagal mencatat perubahan profil:', auditError.message);
              res.status(500).json({ message: 'Profil tersimpan, tetapi aktivitasnya gagal dicatat' });
            });
        }
      );
    }
  );
});

router.put('/credentials', authenticateToken, async (req, res) => {
  const { current_password, username, new_password, confirm_password } = req.body || {};
  if ([current_password, username, new_password, confirm_password].some((value) => typeof value !== 'string')) {
    return res.status(400).json({ message: 'Semua kolom kredensial wajib diisi' });
  }

  const normalizedUsername = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(normalizedUsername)) {
    return res.status(400).json({ message: 'Username harus 3–40 karakter dan hanya boleh memakai huruf, angka, titik, garis bawah, atau tanda hubung' });
  }
  if (new_password.length < 12 || Buffer.byteLength(new_password, 'utf8') > 72) {
    return res.status(400).json({ message: 'Password baru minimal 12 karakter dan maksimal 72 byte' });
  }
  if (new_password !== confirm_password) {
    return res.status(400).json({ message: 'Konfirmasi password baru tidak cocok' });
  }

  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], async (readError, user) => {
    if (readError) return res.status(500).json({ message: 'Gagal memverifikasi akun' });
    if (!user) return res.status(404).json({ message: 'Akun tidak ditemukan' });

    try {
      const currentPasswordMatches = await bcrypt.compare(current_password, user.password_hash);
      if (!currentPasswordMatches) {
        return res.status(401).json({ message: 'Password lama tidak sesuai' });
      }

      const samePassword = await bcrypt.compare(new_password, user.password_hash);
      if (samePassword) {
        return res.status(400).json({ message: 'Password baru harus berbeda dari password lama' });
      }

      db.get(
        'SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?',
        [normalizedUsername, user.id],
        async (usernameError, duplicate) => {
          if (usernameError) return res.status(500).json({ message: 'Gagal memeriksa username' });
          if (duplicate) return res.status(409).json({ message: 'Username sudah digunakan' });

          try {
            const passwordHash = await bcrypt.hash(new_password, 12);
            db.run(
              'UPDATE users SET username = ?, password_hash = ? WHERE id = ?',
              [normalizedUsername, passwordHash, user.id],
              (updateError) => {
                if (updateError) return res.status(500).json({ message: 'Gagal memperbarui kredensial' });
                const updatedUser = { ...user, username: normalizedUsername };
                recordAudit(user.id, 'perbarui kredensial', 'akun', user.id)
                  .then(() => res.json({
                    message: 'Username dan password berhasil diperbarui',
                    token: generateToken(updatedUser),
                    user: {
                      id: user.id,
                      name: user.name,
                      username: normalizedUsername,
                      role: user.role,
                    },
                  }))
                  .catch((auditError) => {
                    console.error('Gagal mencatat perubahan kredensial:', auditError.message);
                    res.status(500).json({ message: 'Kredensial tersimpan, tetapi aktivitasnya gagal dicatat' });
                  });
              }
            );
          } catch {
            res.status(500).json({ message: 'Gagal mengamankan password baru' });
          }
        }
      );
    } catch {
      res.status(500).json({ message: 'Gagal memverifikasi password' });
    }
  });
});

module.exports = router;
