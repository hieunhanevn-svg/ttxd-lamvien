// Proxy ảnh từ Google Drive - không cần đăng nhập Gmail
const { getAccessToken } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing file ID' });

  try {
    const token = await getAccessToken();
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!driveRes.ok) return res.status(driveRes.status).json({ error: 'Drive error' });

    const contentType = driveRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buf = Buffer.from(await driveRes.arrayBuffer());
    res.send(buf);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
