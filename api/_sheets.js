// Shared Google Sheets + Drive helper
const SS_ID = '1EB3cf-rlrg11rDsWfSQ16AbdeaBsgH1hZbDvrjTe_I4';
const DRIVE_FOLDER = '1VlNOZroid9gqAtnsD34F-KOpPAJxwPxN';

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT chưa được cài đặt');
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function getAccessToken() {
  const sa = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');

  const { createSign } = await import('crypto');
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
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
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
  return res.json();
}

async function sheetsUpdate(range, values) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SS_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  return res.json();
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
  const token = await getAccessToken();
  const buffer = Buffer.from(base64Data, 'base64');
  const boundary = 'ttxd_boundary_' + Date.now();
  const meta = JSON.stringify({ name: filename, parents: [folderId || DRIVE_FOLDER] });
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const end = `\r\n--${boundary}--`;
  const bodyBuf = Buffer.concat([Buffer.from(body), buffer, Buffer.from(end)]);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': bodyBuf.length },
    body: bodyBuf
  });
  const file = await res.json();
  if (file.error) throw new Error('Drive upload error: ' + file.error.message);
  // Set public
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  return { id: file.id, url: `https://drive.google.com/uc?id=${file.id}&export=view`, thumb: `https://drive.google.com/thumbnail?id=${file.id}&sz=w800` };
}

async function driveCreateFolder(name, parentId) {
  const token = await getAccessToken();
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId || DRIVE_FOLDER] })
  });
  const folder = await res.json();
  if (folder.error) throw new Error('Drive folder error: ' + folder.error.message);
  await fetch(`https://www.googleapis.com/drive/v3/files/${folder.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  return folder.id;
}

// Simple crypto helpers
function hashPassword(pw) {
  const { createHash } = require('crypto');
  return createHash('sha256').update(pw).digest('hex'); // Khớp với Apps Script cũ
}

const JWT_SECRET = process.env.JWT_SECRET || 'TTXD_LV_JWT_2026_SECRET';

function signToken(payload) {
  const { createHmac } = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now()/1000) + 36000 })).toString('base64url');
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || token === 'null') return null;
  try {
    const { createHmac } = require('crypto');
    const [header, body, sig] = token.split('.');
    const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now()/1000)) return null;
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
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toISOString().split('T')[0];
}

module.exports = { sheetsGet, sheetsAppend, sheetsUpdate, sheetsBatchGet, driveUpload, driveCreateFolder, hashPassword, signToken, verifyToken, cors, today, formatDate, SS_ID, DRIVE_FOLDER };
