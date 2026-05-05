const { sheetsGet, sheetsAppend, sheetsUpdate, hashPassword, verifyToken, cors } = require('./_sheets');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { action, token, username, ho_ten, role, target_username } = req.body || {};
  const user = verifyToken(token);
  if (!user) return res.json({ success: false, error: 'Phiên đăng nhập hết hạn' });
  if (user.role !== 'admin') return res.json({ success: false, error: 'Chỉ Admin mới có quyền' });

  try {
    const rows = await sheetsGet('USERS!A2:G');

    if (action === 'getUsers') {
      const users = rows.map(r => ({ username:r[0], ho_ten:r[2], role:r[3], trang_thai:r[4]||'active', quan_ly_boi:r[5]||'' }));
      return res.json({ success: true, users });
    }

    if (action === 'createUser') {
      if (!username || !ho_ten) return res.json({ success: false, error: 'Thiếu thông tin' });
      if (rows.find(r => r[0] === username)) return res.json({ success: false, error: 'Tên đăng nhập đã tồn tại' });
      const defaultPass = 'DaLat';
      await sheetsAppend('USERS!A:G', [[username, hashPassword(defaultPass), ho_ten, role||'canbo', 'active', user.username, new Date().toISOString()]]);
      return res.json({ success: true, message: `Đã tạo tài khoản ${username}. Mật khẩu: ${defaultPass}` });
    }

    if (action === 'toggleUser') {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === target_username) {
          if (rows[i][0] === user.username) return res.json({ success: false, error: 'Không thể khoá chính mình' });
          const newStatus = rows[i][4] === 'active' ? 'inactive' : 'active';
          await sheetsUpdate(`USERS!E${i+2}`, [[newStatus]]);
          return res.json({ success: true, message: `Đã ${newStatus==='active'?'mở khoá':'khoá'} ${target_username}`, new_status: newStatus });
        }
      }
      return res.json({ success: false, error: 'Không tìm thấy tài khoản' });
    }

    return res.json({ success: false, error: 'Action không hợp lệ' });
  } catch(e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
