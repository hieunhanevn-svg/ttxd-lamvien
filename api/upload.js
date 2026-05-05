const { driveUpload, driveCreateFolder, sheetsGet, sheetsUpdate, verifyToken, cors, DRIVE_FOLDER } = require('./_sheets');

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { file_data, file_name, mime_type, ma_ho_so, token } = req.body || {};
  const user = verifyToken(token);
  if (!user) return res.json({ success:false, error:'Phiên đăng nhập hết hạn' });
  if (!file_data) return res.json({ success:false, error:'Thiếu dữ liệu ảnh' });

  try {
    // Lấy folder ID của hồ sơ
    let folderId = DRIVE_FOLDER;
    if (ma_ho_so) {
      const rows = await sheetsGet('HO_SO!A2:Q');
      const hs = rows.find(r => r[0] === ma_ho_so);
      if (hs && hs[15]) folderId = hs[15];
    }
    const filename = `${ma_ho_so||'img'}_${Date.now()}_${file_name||'photo.jpg'}`;
    const result = await driveUpload(filename, mime_type||'image/jpeg', file_data, folderId);
    return res.json({ success:true, url:result.url, thumb:result.thumb, file_id:result.id });
  } catch(e) {
    return res.status(500).json({ success:false, error:e.message });
  }
}
