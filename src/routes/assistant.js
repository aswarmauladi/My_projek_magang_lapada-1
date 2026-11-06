const express = require('express');
const { db } = require('../db/initDb');
const { requireRole } = require('../middleware/auth');
const { composeAnswer, interpretQuestion } = require('../services/ollama');

const router = express.Router();
const identifiableRoles = ['admin', 'pembinaan'];
const allowedRoles = ['admin', 'pembinaan', 'koordinator', 'tatausaha'];
const filters = [
  ['blok', 'blok'],
  ['program', 'program'],
  ['status', 'status'],
];
const profileFields = [
  ['tanggal_keluar', /tanggal keluar|keluar|bebas/],
  ['tanggal_masuk', /tanggal masuk|masuk/],
  ['tempat_lahir', /tempat lahir/],
  ['tanggal_lahir', /tanggal lahir|lahir/],
  ['jenis_kelamin', /jenis kelamin/],
  ['kewarganegaraan', /kewarganegaraan/],
  ['pendidikan_terakhir', /pendidikan/],
  ['pekerjaan_sebelumnya', /pekerjaan/],
  ['kota_asal', /kota asal|asal/],
  ['nomor_register', /nomor register|register/],
  ['program', /program/],
  ['status', /status/],
  ['blok', /blok/],
];

function queryAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function queryOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function normalizeText(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('id')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateElapsedDuration(startValue, endValue) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(startValue || '') || !datePattern.test(endValue || '')) return null;

  const start = new Date(`${startValue}T00:00:00.000Z`);
  const end = new Date(`${endValue}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    || start.toISOString().slice(0, 10) !== startValue
    || end.toISOString().slice(0, 10) !== endValue
    || end < start) return null;

  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const addYearsClamped = (date, yearsToAdd) => {
    const year = date.getUTCFullYear() + yearsToAdd;
    const month = date.getUTCMonth();
    const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
    return new Date(Date.UTC(year, month, day));
  };
  const addMonthsClamped = (date, monthsToAdd) => {
    const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + monthsToAdd;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
    return new Date(Date.UTC(year, month, day));
  };

  let years = end.getUTCFullYear() - start.getUTCFullYear();
  let cursor = addYearsClamped(start, years);
  if (cursor > end) {
    years -= 1;
    cursor = addYearsClamped(start, years);
  }

  let months = (end.getUTCFullYear() - cursor.getUTCFullYear()) * 12
    + end.getUTCMonth() - cursor.getUTCMonth();
  let monthCursor = addMonthsClamped(cursor, months);
  if (monthCursor > end) {
    months -= 1;
    monthCursor = addMonthsClamped(cursor, months);
  }
  const days = Math.round((end.getTime() - monthCursor.getTime()) / 86400000);

  return { years, months, days, totalDays };
}

function formatElapsedDuration(duration) {
  const parts = [];
  if (duration.years) parts.push(`${duration.years} tahun`);
  if (duration.months) parts.push(`${duration.months} bulan`);
  if (duration.days || parts.length === 0) parts.push(`${duration.days} hari`);
  return parts.join(', ');
}

function findMentionedValue(question, values) {
  const normalizedQuestion = ` ${normalizeText(question)} `;
  return values
    .filter((value) => value != null && String(value).trim())
    .sort((left, right) => String(right).length - String(left).length)
    .find((value) => {
      const normalizedValue = normalizeText(value);
      const valueIndex = normalizedQuestion.indexOf(` ${normalizedValue} `);
      if (valueIndex < 0) return false;
      const precedingWords = normalizedQuestion.slice(0, valueIndex).trim().split(' ');
      return !['tidak', 'bukan', 'belum', 'non'].includes(precedingWords.at(-1));
    });
}

async function findFilters(question, suggestedFilters = []) {
  const found = [];
  for (const [column, label] of filters) {
    const values = await queryAll(
      `SELECT DISTINCT ${column} AS value FROM wbp WHERE ${column} IS NOT NULL AND TRIM(${column}) != ''`
    );
    const knownValues = values.map((row) => row.value);
    const suggestion = suggestedFilters.find((filter) => filter.field === column);
    const suggestedMatch = suggestion
      ? findMentionedValue(suggestion.value, knownValues)
      : null;
    const match = suggestedMatch || findMentionedValue(question, knownValues);
    if (match) found.push({ column, label, value: match });
  }
  return found;
}

async function findPerson(question) {
  const registerMatch = question.match(/\bwbp[-\s]?\d+\b/i);
  if (registerMatch) {
    return queryOne(
      `SELECT id, nama, nomor_register, blok, program, status, tanggal_masuk, tanggal_keluar,
              tempat_lahir, tanggal_lahir, jenis_kelamin, kewarganegaraan,
              pendidikan_terakhir, pekerjaan_sebelumnya, kota_asal
       FROM wbp WHERE LOWER(REPLACE(nomor_register, ' ', '')) = LOWER(REPLACE(?, ' ', ''))`,
      [registerMatch[0].replace(/\s+/g, '')]
    );
  }

  const rows = await queryAll('SELECT id, nama FROM wbp');
  const match = rows
    .filter((row) => ` ${normalizeText(question)} `.includes(` ${normalizeText(row.nama)} `))
    .sort((left, right) => right.nama.length - left.nama.length)[0];
  if (!match) return null;

  return queryOne(
    `SELECT id, nama, nomor_register, blok, program, status, tanggal_masuk, tanggal_keluar,
            tempat_lahir, tanggal_lahir, jenis_kelamin, kewarganegaraan,
            pendidikan_terakhir, pekerjaan_sebelumnya, kota_asal
     FROM wbp WHERE id = ?`,
    [match.id]
  );
}

function formatPersonAnswer(person, question, interpretation) {
  const requestedField = interpretation?.field && interpretation.field !== 'profil'
    ? interpretation.field
    : profileFields.find(([, pattern]) => pattern.test(question))?.[0];
  const requestedProfile = interpretation?.field === 'profil' || /profil|data pribadi|detail lengkap/.test(question);
  const fields = requestedProfile
    ? [
      ['Nomor register', 'nomor_register'],
      ['Tempat lahir', 'tempat_lahir'],
      ['Tanggal lahir', 'tanggal_lahir'],
      ['Jenis kelamin', 'jenis_kelamin'],
      ['Kewarganegaraan', 'kewarganegaraan'],
      ['Pendidikan terakhir', 'pendidikan_terakhir'],
      ['Pekerjaan sebelumnya', 'pekerjaan_sebelumnya'],
      ['Kota asal', 'kota_asal'],
      ['Blok', 'blok'],
      ['Program', 'program'],
      ['Status', 'status'],
      ['Tanggal masuk', 'tanggal_masuk'],
      ['Tanggal keluar', 'tanggal_keluar'],
    ]
    : requestedField
      ? [[profileFields.find(([field]) => field === requestedField)[0].replaceAll('_', ' '), requestedField]]
      : [
        ['Nomor register', 'nomor_register'],
        ['Blok', 'blok'],
        ['Program', 'program'],
        ['Status', 'status'],
        ['Tanggal masuk', 'tanggal_masuk'],
        ['Tanggal keluar', 'tanggal_keluar'],
      ];

  const answer = [`Data WBP ${person.nama}:`];
  for (const [label, field] of fields) {
    answer.push(`${label}: ${person[field] || 'belum tercatat'}`);
  }
  return answer.join('\n');
}

function selectPersonFacts(person, question, interpretation) {
  const requestedField = interpretation?.field && interpretation.field !== 'profil'
    ? interpretation.field
    : profileFields.find(([, pattern]) => pattern.test(question))?.[0];
  const requestedProfile = interpretation?.field === 'profil' || /profil|data pribadi|detail lengkap/.test(question);
  const fields = requestedProfile
    ? ['nomor_register', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'kewarganegaraan', 'pendidikan_terakhir', 'pekerjaan_sebelumnya', 'kota_asal', 'blok', 'program', 'status', 'tanggal_masuk', 'tanggal_keluar']
    : requestedField
      ? ['nomor_register', requestedField]
      : ['nomor_register', 'blok', 'program', 'status', 'tanggal_masuk', 'tanggal_keluar'];
  const data = { nama: person.nama };

  for (const field of fields) {
    data[field] = person[field] || null;
  }

  return { jenis: 'satu data WBP', data };
}

async function respondWithFacts(res, question, facts, fallbackAnswer, source, mode) {
  const generatedAnswer = await composeAnswer(question, facts);
  return res.json({
    answer: generatedAnswer
      ? [generatedAnswer, facts.requiredNote].filter(Boolean).join('\n\n')
      : fallbackAnswer,
    source: `${source}; ${generatedAnswer ? 'jawaban disusun Ollama lokal dari hasil SQL' : 'jawaban fallback lokal'}`,
    mode,
  });
}

router.post('/ask', requireRole(...allowedRoles), async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question || question.length > 500) {
    return res.status(400).json({ message: 'Pertanyaan wajib diisi dan maksimal 500 karakter' });
  }

  const normalizedQuestion = normalizeText(question);

  try {
    const interpretation = await interpretQuestion(question);
    const asksForList = interpretation?.intent === 'list'
      || /\b(siapa|daftar|sebutkan|tampilkan|nama-nama|peserta)\b/.test(normalizedQuestion);
    const asksForCount = interpretation?.intent === 'count'
      || /\b(berapa|jumlah|total|hitung|banyak)\b/.test(normalizedQuestion);
    const asksForFilter = (interpretation?.filters.length || 0) > 0
      || /\b(blok|program|status|aktif|monitoring|selesai)\b/.test(normalizedQuestion);
    const asksIndividualDetails = ['person', 'field'].includes(interpretation?.intent)
      || Boolean(interpretation?.personQuery)
      || /\b(profil|data pribadi|nomor register|tanggal lahir|tempat lahir|tanggal masuk|tanggal keluar|kewarganegaraan|jenis kelamin|pendidikan|pekerjaan sebelumnya|kota asal)\b/.test(normalizedQuestion);
    const asksDuration = interpretation?.intent === 'duration'
      || interpretation?.field === 'durasi'
      || /\b(berapa lama|masa tahanan|lama tahanan|durasi|selisih tanggal|lama menjalani)\b/.test(normalizedQuestion);
    const assistantMode = interpretation ? 'ollama-lokal' : 'pola-lokal';
    let person = null;

    if (identifiableRoles.includes(req.user.role)) {
      if (interpretation?.personQuery) person = await findPerson(interpretation.personQuery);
      if (!person) person = await findPerson(normalizedQuestion);
    }

    if (!identifiableRoles.includes(req.user.role) && (asksIndividualDetails || asksDuration || /\bwbp-?\d+\b/.test(normalizedQuestion))) {
      return res.json({
        answer: 'Akun Anda hanya dapat meminta ringkasan agregat. Pencarian per orang dan informasi pribadi WBP dibatasi untuk admin dan petugas pembinaan.',
        source: 'Kebijakan hak akses aplikasi',
        mode: 'access-limited',
      });
    }

    if (asksDuration && identifiableRoles.includes(req.user.role) && !person) {
      return res.json({
        answer: `Saya tidak menemukan data WBP yang dimaksud dalam pertanyaan "${question}". Sebutkan nama atau nomor register.`,
        source: `Database WBP lokal; pemahaman ${assistantMode}`,
        mode: 'no-match',
      });
    }

    if (person && asksDuration) {
      if (!person.tanggal_masuk && !person.tanggal_keluar) {
        return res.json({
          answer: 'Data belum ada.',
          source: `Database WBP lokal, tanggal masuk dan keluar belum tercatat; pemahaman ${assistantMode}`,
          mode: assistantMode,
        });
      }

      const endDate = person.tanggal_keluar || new Date().toISOString().slice(0, 10);
      const duration = calculateElapsedDuration(person.tanggal_masuk, endDate);
      const hasExitDate = Boolean(person.tanggal_keluar);
      const endDateBasis = hasExitDate
        ? `tanggal keluar ${person.tanggal_keluar}`
        : `tanggal hari ini ${endDate} karena tanggal keluar belum tercatat`;
      const requiredNote = `Perhitungan memakai tanggal masuk ${person.tanggal_masuk || 'belum tercatat'} dan ${endDateBasis}. Ini hanya selisih kalender, bukan penetapan masa pidana resmi.`;

      if (!duration) {
        const reason = !person.tanggal_masuk
          ? 'Tanggal masuk belum tercatat.'
          : 'Tanggal masuk atau tanggal keluar tidak valid, atau tanggal keluar mendahului tanggal masuk.';
        const fallbackAnswer = `${person.nama}: ${reason} Durasi belum dapat dihitung. ${requiredNote}`;
        return res.json({
          answer: fallbackAnswer,
          source: `Database WBP lokal, nomor register ${person.nomor_register}; pemahaman ${assistantMode}`,
          mode: assistantMode,
        });
      }

      const durationText = formatElapsedDuration(duration);
      const endDescription = hasExitDate ? 'tanggal keluar yang tercatat' : 'tanggal hari ini karena tanggal keluar belum tercatat';
      const fallbackAnswer = `${person.nama}: selisih tanggal masuk (${person.tanggal_masuk}) hingga ${endDescription} (${endDate}) adalah ${durationText} atau ${duration.totalDays} hari. ${requiredNote}`;
      return respondWithFacts(
        res,
        question,
        {
          jenis: 'selisih kalender tanggal WBP',
          nama: person.nama,
          tanggal_masuk: person.tanggal_masuk,
          tanggal_akhir_perhitungan: endDate,
          sumber_tanggal_akhir: hasExitDate ? 'tanggal keluar yang tercatat' : 'tanggal hari ini; tanggal keluar belum tercatat',
          durasi_hasil_hitung_backend: durationText,
          total_hari_hasil_hitung_backend: duration.totalDays,
          requiredNote,
        },
        fallbackAnswer,
        `Database WBP lokal, nomor register ${person.nomor_register}; perhitungan tanggal oleh backend; pemahaman ${assistantMode}`,
        assistantMode
      );
    }

    if (person) {
      return respondWithFacts(
        res,
        question,
        selectPersonFacts(person, normalizedQuestion, interpretation),
        formatPersonAnswer(person, normalizedQuestion, interpretation),
        `Database WBP lokal, nomor register ${person.nomor_register}; pemahaman ${assistantMode}`,
        assistantMode
      );
    }

    const matchedFilters = await findFilters(normalizedQuestion, interpretation?.filters);
    if (identifiableRoles.includes(req.user.role)
      && ['person', 'field'].includes(interpretation?.intent)
      && !person
      && !asksForList
      && !asksForCount
      && matchedFilters.length === 0) {
      return res.json({
        answer: `Saya tidak menemukan data WBP untuk "${interpretation.personQuery || question}". Periksa nama atau nomor register.`,
        source: `Database WBP lokal; pemahaman ${assistantMode}`,
        mode: 'no-match',
      });
    }

    if (!asksForCount && !asksForList && !asksIndividualDetails && matchedFilters.length === 0) {
      return res.json({
        answer: 'Saya belum dapat menjawab pertanyaan itu dari database. Coba tanyakan jumlah WBP, jumlah peserta program/status/blok tertentu, daftar peserta (admin/pembinaan), atau data satu WBP berdasarkan nama/nomor register.',
        source: `Cakupan pertanyaan yang tersedia; pemahaman ${assistantMode}`,
        mode: 'unsupported',
      });
    }

    if (asksForCount && asksForFilter && matchedFilters.length === 0) {
      return res.json({
        answer: 'Saya tidak menemukan nilai blok, program, atau status yang cocok di database. Periksa kembali istilahnya atau tanyakan salah satu nilai yang tercatat.',
        source: `Database WBP lokal, pencocokan nilai; pemahaman ${assistantMode}`,
        mode: 'no-match',
      });
    }

    const where = matchedFilters.length
      ? `WHERE ${matchedFilters.map(({ column }) => `${column} = ?`).join(' AND ')}`
      : '';
    const params = matchedFilters.map(({ value }) => value);
    const countResult = await queryOne(`SELECT COUNT(*) AS total FROM wbp ${where}`, params);
    const filterDescription = matchedFilters.length
      ? ` dengan ${matchedFilters.map(({ label, value }) => `${label} ${value}`).join(' dan ')} `
      : ' ';

    if (asksForList) {
      if (!identifiableRoles.includes(req.user.role)) {
        return respondWithFacts(
          res,
          question,
          { jenis: 'jumlah agregat WBP', total: countResult.total, filter: matchedFilters.map(({ label, value }) => ({ field: label, value })) },
          `Ditemukan ${countResult.total} WBP${filterDescription}, tetapi akun Anda hanya diizinkan melihat jumlah agregat, bukan nama atau nomor register.`,
          `Database WBP lokal, hasil hitung agregat; pemahaman ${assistantMode}`,
          'aggregate-only'
        );
      }

      const rows = await queryAll(
        `SELECT nama, nomor_register, blok, program, status FROM wbp ${where} ORDER BY nama LIMIT 20`,
        params
      );
      const list = rows.map((row) => `- ${row.nama} (${row.nomor_register}), ${row.blok || 'blok belum tercatat'}, ${row.program || 'program belum tercatat'}, status ${row.status || 'belum tercatat'}`);
      const suffix = countResult.total > rows.length ? `\nHanya ${rows.length} dari ${countResult.total} data yang ditampilkan.` : '';
      const fallbackAnswer = countResult.total
          ? `Ditemukan ${countResult.total} WBP${filterDescription}:\n${list.join('\n')}${suffix}`
          : `Tidak ada WBP yang cocok${filterDescription}.`;
      return respondWithFacts(
        res,
        question,
        { jenis: 'daftar peserta WBP', total: countResult.total, filter: matchedFilters.map(({ label, value }) => ({ field: label, value })), records: rows },
        fallbackAnswer,
        `Database WBP lokal, hasil query langsung; pemahaman ${assistantMode}`,
        assistantMode
      );
    }

    return respondWithFacts(
      res,
      question,
      { jenis: 'jumlah agregat WBP', total: countResult.total, filter: matchedFilters.map(({ label, value }) => ({ field: label, value })) },
      `Jumlah WBP${filterDescription}adalah ${countResult.total}.`,
      `Database WBP lokal, hasil hitung langsung; pemahaman ${assistantMode}`,
      assistantMode
    );
  } catch (error) {
    console.error('Kesalahan query asisten:', error.message);
    return res.status(500).json({ message: 'Asisten tidak dapat membaca database saat ini' });
  }
});

module.exports = router;