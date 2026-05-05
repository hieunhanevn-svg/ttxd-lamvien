const { createHash, createHmac, createSign } = require('crypto');

const SS_ID = '1EB3cf-rlrg11rDsWfSQ16AbdeaBsgH1hZbDvrjTe_I4';
const DRIVE_FOLDER = '1VlNOZroid9gqAtnsD34F-KOpPAJxwPxN';

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT chưa được cài đặt trong Vercel');
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// Cache token để không gọi lại mỗi request
let _saToken = null, _saExpiry = 0;
let _oaToken = null, _oaExpiry = 0;

async function getAccessToken() {
  if (_saToken && Date.now() < _saExpiry) return _saToken;
  const sa = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(sa.private_key, 'base64url');
  const jwt = `${header}.${payload}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token lỗi: ' + JSON.stringify(data));
  return data.access_token;
}

async function sheetsGet(range) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SS_ID}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.error) throw new Error('Sheets error: ' + data.error.message);
  return data.values || [];
}

async function sheetsAppend(range, values) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SS_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  const data = await res.json();
  if (data.error) throw new Error('Sheets ghi lỗi: ' + data.error.message + ' (' + data.error.code + ')');
  return data;
}

async function sheetsUpdate(range, values) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SS_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  const data = await res.json();
  if (data.error) throw new Error('Sheets update lỗi: ' + data.error.message);
  return data;
}

async function sheetsBatchGet(ranges) {
  const token = await getAccessToken();
  const q = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SS_ID}/values:batchGet?${q}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.error) throw new Error('Sheets batch error: ' + data.error.message);
  return data.valueRanges.map(vr => vr.values || []);
}

async function driveUpload(filename, mimeType, base64Data, folderId) {
  const token = await getDriveToken(); // OAuth cá nhân - có storage quota
  const fileBuffer = Buffer.from(base64Data, 'base64');
  const boundary = 'ttxd' + Date.now();
  const metaStr = JSON.stringify({ name: filename, parents: [folderId || DRIVE_FOLDER] });
  const metaBuf = Buffer.from(metaStr, 'utf-8');

  // Multipart body dùng binary buffer (chuẩn nhất)
  const CRLF = Buffer.from('\r\n');
  const bodyParts = [
    Buffer.from('--' + boundary + '\r\n'),
    Buffer.from('Content-Type: application/json; charset=UTF-8\r\n\r\n'),
    metaBuf, CRLF,
    Buffer.from('--' + boundary + '\r\n'),
    Buffer.from('Content-Type: ' + mimeType + '\r\n\r\n'),
    fileBuffer, CRLF,
    Buffer.from('--' + boundary + '--')
  ];
  const body = Buffer.concat(bodyParts);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length)
    },
    body
  });
  const text = await res.text();
  let file;
  try { file = JSON.parse(text); } catch(e) { throw new Error('Drive response: ' + text.substring(0,200)); }
  if (file.error) throw new Error('Drive: ' + (file.error.message || JSON.stringify(file.error)));

  // Set public read
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });

  return {
    id: file.id,
    url: `/api/image?id=${file.id}`,
    thumb: `/api/image?id=${file.id}`
  };
}

async function driveCreateFolder(name, parentId) {
  const token = await getDriveToken(); // OAuth cá nhân
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId || DRIVE_FOLDER]
    })
  });
  const folder = await res.json();
  if (folder.error) throw new Error('Drive folder: ' + folder.error.message);
  await fetch(`https://www.googleapis.com/drive/v3/files/${folder.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  return folder.id;
}

function hashPassword(pw) {
  return createHash('sha256').update(pw).digest('hex');
}

const JWT_SECRET = process.env.JWT_SECRET || 'TTXD_LV_JWT_2026_SECRET';

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 36000
  })).toString('base64url');
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || token === 'null' || token === 'undefined') return null;
  try {
    const [header, body, sig] = token.split('.');
    const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d).split('T')[0] || String(d);
    return dt.toISOString().split('T')[0];
  } catch { return String(d); }
}

// Đảm bảo số thực dùng dấu chấm (tránh lỗi locale Sheets)
function safeNum(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? '' : n;
}

// OAuth token cho Drive upload (dùng tài khoản cá nhân, có storage quota)
async function getDriveToken() {
  if (_oaToken && Date.now() < _oaExpiry) return _oaToken;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Thiếu GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET hoặc GOOGLE_REFRESH_TOKEN');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString()
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('OAuth token lỗi: ' + JSON.stringify(data));
  _oaToken = data.access_token;
  _oaExpiry = Date.now() + 3500000;
  return _oaToken;
}

module.exports = {
  sheetsGet, sheetsAppend, sheetsUpdate, sheetsBatchGet,
  driveUpload, driveCreateFolder, getAccessToken, getDriveToken,
  hashPassword, signToken, verifyToken,
  cors, today, formatDate, safeNum,
  SS_ID, DRIVE_FOLDER
};
