const { getAccessToken, getDriveToken, DRIVE_FOLDER } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};

  // Test Service Account (cho Sheets)
  try {
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
    results.service_account = '✅ ' + (sa.client_email || 'missing');
  } catch(e) {
    results.service_account = '❌ ' + e.message;
  }

  // Test OAuth token (cho Drive upload)
  try {
    const token = await getDriveToken();
    results.oauth_token = '✅ Lấy OAuth token thành công';

    // Test tạo file nhỏ lên Drive
    const meta = JSON.stringify({ name: 'test_oauth.txt', parents: [DRIVE_FOLDER] });
    const body = Buffer.concat([
      Buffer.from('--b\r\nContent-Type: application/json\r\n\r\n'),
      Buffer.from(meta),
      Buffer.from('\r\n--b\r\nContent-Type: text/plain\r\n\r\ntest ok\r\n--b--')
    ]);
    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/related; boundary=b' },
      body
    });
    const data = await uploadRes.json();
    if (data.error) {
      results.drive_write = '❌ ' + data.error.message;
    } else {
      results.drive_write = '✅ Upload OK - file id: ' + data.id;
      // Xóa file test
      await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
    }
  } catch(e) {
    results.oauth_token = '❌ ' + e.message;
  }

  res.json(results);
};
