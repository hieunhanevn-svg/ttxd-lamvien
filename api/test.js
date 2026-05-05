const { getAccessToken, DRIVE_FOLDER } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};

  // Test 1: Service Account JSON
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT chưa được cài');
    const sa = JSON.parse(raw);
    results.service_account = '✅ ' + sa.client_email;
  } catch(e) {
    results.service_account = '❌ ' + e.message;
    return res.json(results);
  }

  // Test 2: Lấy Access Token
  try {
    const token = await getAccessToken();
    results.access_token = '✅ Lấy token thành công';

    // Test 3: Truy cập Drive folder
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${DRIVE_FOLDER}'+in+parents&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const driveData = await driveRes.json();
    if (driveData.error) {
      results.drive_folder = '❌ ' + driveData.error.message + ' (code: ' + driveData.error.code + ')';
    } else {
      results.drive_folder = '✅ Truy cập được - ' + (driveData.files?.length||0) + ' files';
    }

    // Test 4: Thử tạo file nhỏ
    const testMeta = JSON.stringify({ name: 'test_connection.txt', parents: [DRIVE_FOLDER] });
    const testBody = Buffer.concat([
      Buffer.from('--b\r\nContent-Type: application/json\r\n\r\n'),
      Buffer.from(testMeta),
      Buffer.from('\r\n--b\r\nContent-Type: text/plain\r\n\r\ntest\r\n--b--')
    ]);
    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/related; boundary=b' },
      body: testBody
    });
    const uploadData = await uploadRes.json();
    if (uploadData.error) {
      results.drive_write = '❌ ' + uploadData.error.message;
    } else {
      results.drive_write = '✅ Tạo file OK - id: ' + uploadData.id;
      // Xóa file test
      await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
    }
  } catch(e) {
    results.error = '❌ ' + e.message;
  }

  res.json(results);
};
