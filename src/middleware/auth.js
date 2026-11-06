const jwt = require('jsonwebtoken');
const { db } = require('../db/initDb');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token tidak ditemukan' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'lapas-wbp-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Token tidak valid' });
    }

    db.get('SELECT id, role, is_active FROM users WHERE id = ?', [user.id], (lookupError, account) => {
      if (lookupError) return res.status(500).json({ message: 'Gagal memverifikasi status akun' });
      if (!account || account.is_active === 0) return res.status(401).json({ message: 'Akun tidak aktif atau tidak ditemukan' });
      req.user = { ...user, role: account.role };
      next();
    });
  });
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Akses ditolak untuk role ini' });
    }

    next();
  };
}

module.exports = { authenticateToken, requireRole };
