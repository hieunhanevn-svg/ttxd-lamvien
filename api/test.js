const { getAccessToken, getDriveToken, sheetsGet, SS_ID, DRIVE_FOLDER } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};

  // Test 1: Sheets API (Service Account)
  try {
    const rows = await sheetsGet('HO_SO!A1:A2');
    results.sheets_api = '✅ Service Account OK - đọc được HO_SO';
  } catch(e) {
    results.sheets_api = '❌ ' + e.message;
  }

  // Test 2: OAuth Drive Token
  try {
    const oaToken = await getDriveToken();
    results.oauth_token = '✅ Lấy OAuth token OK (' + oaToken.substring(0,20) + '...)';
  } catch(e) {
    results.oauth_token = '❌ ' + e.message;
    res.json(results); return;
  }

  // Test 3: Drive Upload thực tế
  try {
    const token = await getDriveToken();
    const meta = JSON.stringify({ name: 'test_' + Date.now() + '.txt', parents: [DRIVE_FOLDER] });
    const body = Buffer.concat([
      Buffer.from('--b\r\nContent-Type: application/json\r\n\r\n'),
      Buffer.from(meta),
      Buffer.from('\r\n--b\r\nContent-Type: text/plain\r\n\r\nTEST OK\r\n--b--')
    ]);
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=b' },
      body
    });
    const data = await r.json();
    if (data.error) {
      results.drive_upload = '❌ ' + data.error.message + ' (code: ' + data.error.code + ')';
    } else {
      results.drive_upload = '✅ Upload OK - file ID: ' + data.id;
      // Xóa file test
      await fetch('https://www.googleapis.com/drive/v3/files/' + data.id, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
      });
    }
  } catch(e) {
    results.drive_upload = '❌ ' + e.message;
  }

  // Test 4: Env vars có đủ không
  results.env_check = {
    GOOGLE_SERVICE_ACCOUNT: process.env.GOOGLE_SERVICE_ACCOUNT ? '✅' : '❌',
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? '✅' : '❌',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? '✅' : '❌',
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN ? '✅' : '❌',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '✅' : '❌'
  };

  res.json(results);
};
