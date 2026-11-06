const express = require('express');
const { db } = require('../db/initDb');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');
const { parseSupportedImage } = require('../services/image');

const router = express.Router();
const settingKey = 'login_background';

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

router.get('/status', async (req, res) => {
  try {
    const setting = await get('SELECT updated_at FROM app_settings WHERE key = ?', [settingKey]);
    res.set('Cache-Control', 'no-store').json({
      configured: Boolean(setting),
      updated_at: setting?.updated_at || null,
    });
  } catch (error) {
    console.error('Gagal memeriksa gambar latar login:', error.message);
    res.status(500).json({ message: 'Gagal memeriksa gambar latar login' });
  }
});

router.get('/image', async (req, res) => {
  try {
    const setting = await get('SELECT value, updated_at FROM app_settings WHERE key = ?', [settingKey]);
    if (!setting) return res.status(404).end();
    const image = parseSupportedImage(setting.value);
    if (!image) {
      console.error('Gambar latar login tersimpan dengan format yang tidak valid.');
      return res.status(500).json({ message: 'Gambar latar login tidak dapat digunakan' });
    }

    res.set({
      'Cache-Control': 'no-store',
      'Content-Type': image.mimeType,
      'Content-Length': image.buffer.length,
      'X-Content-Type-Options': 'nosniff',
      'Last-Modified': new Date(setting.updated_at).toUTCString(),
    });
    res.send(image.buffer);
  } catch (error) {
    console.error('Gagal mengambil gambar latar login:', error.message);
    res.status(500).json({ message: 'Gagal mengambil gambar latar login' });
  }
});

router.get('/settings', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const setting = await get('SELECT updated_at FROM app_settings WHERE key = ?', [settingKey]);
    res.json({ configured: Boolean(setting), updated_at: setting?.updated_at || null });
  } catch (error) {
    console.error('Gagal mengambil pengaturan gambar latar login:', error.message);
    res.status(500).json({ message: 'Gagal mengambil pengaturan gambar latar login' });
  }
});

router.put('/', authenticateToken, requireRole('admin'), async (req, res) => {
  const image = parseSupportedImage(req.body?.image);
  if (!image) {
    return res.status(400).json({ message: 'Gambar harus JPEG, PNG, atau WebP yang valid dan maksimal 2 MB' });
  }

  let saved = false;
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [settingKey, req.body.image, req.user.id],
        (error) => (error ? reject(error) : resolve())
      );
    });
    saved = true;
    await recordAudit(req.user.id, 'perbarui', 'latar login');
    res.json({ message: 'Gambar latar login berhasil diperbarui' });
  } catch (error) {
    console.error('Gagal menyimpan gambar latar login:', error.message);
    res.status(500).json({
      message: saved
        ? 'Gambar tersimpan, tetapi aktivitasnya gagal dicatat'
        : 'Gagal menyimpan gambar latar login',
    });
  }
});

router.delete('/', authenticateToken, requireRole('admin'), async (req, res) => {
  let deleted = false;
  try {
    const result = await new Promise((resolve, reject) => {
      db.run('DELETE FROM app_settings WHERE key = ?', [settingKey], function (error) {
        if (error) reject(error);
        else resolve(this);
      });
    });
    deleted = result.changes > 0;
    if (!deleted) return res.status(404).json({ message: 'Gambar latar login belum diatur' });
    await recordAudit(req.user.id, 'hapus', 'latar login');
    res.json({ message: 'Gambar latar login berhasil dihapus' });
  } catch (error) {
    console.error('Gagal menghapus gambar latar login:', error.message);
    res.status(500).json({
      message: deleted
        ? 'Gambar dihapus, tetapi aktivitasnya gagal dicatat'
        : 'Gagal menghapus gambar latar login',
    });
  }
});

module.exports = router;
