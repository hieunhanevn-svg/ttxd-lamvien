const { sheetsGet, sheetsUpdate, hashPassword, signToken, verifyToken, cors } = require('./_sheets');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const { action, token, username, password, old_password, new_password, target_username } = body;

    // LOGIN
    if (action === 'login') {
      if (!username || !password) return res.json({ success:false, error:'Thiếu tên đăng nhập hoặc mật khẩu' });
      const rows = await sheetsGet('USERS!A2:G');
      const hash = hashPassword(password);
      for (const r of rows) {
        if (r[0] === username && r[1] === hash && r[4] === 'active') {
          const tok = signToken({ username:r[0], role:r[3], ho_ten:r[2] });
          return res.json({ success:true, token:tok, user:{ username:r[0], ho_ten:r[2], role:r[3], quan_ly_boi:r[5]||'' } });
        }
      }
      return res.json({ success:false, error:'Tên đăng nhập hoặc mật khẩu không đúng' });
    }

    // Xác thực token cho các action khác
    const user = verifyToken(token);
    if (!user) return res.json({ success:false, error:'Phiên đăng nhập hết hạn' });

    // LOGOUT
    if (action === 'logout') return res.json({ success:true });

    // CHANGE PASSWORD
    if (action === 'changePassword') {
      if (!old_password || !new_password) return res.json({ success:false, error:'Thiếu mật khẩu' });
      const rows = await sheetsGet('USERS!A2:B');
      const oldHash = hashPassword(old_password);
      const newHash = hashPassword(new_password);
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === user.username && rows[i][1] === oldHash) {
          await sheetsUpdate(`USERS!B${i+2}`, [[newHash]]);
          return res.json({ success:true, message:'Đổi mật khẩu thành công' });
        }
      }
      return res.json({ success:false, error:'Mật khẩu cũ không đúng' });
    }

    // RESET PASSWORD (admin only)
    if (action === 'resetPassword') {
      if (user.role !== 'admin') return res.json({ success:false, error:'Không có quyền' });
      if (!target_username) return res.json({ success:false, error:'Thiếu tên tài khoản' });
      const rows = await sheetsGet('USERS!A2:B');
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === target_username) {
          await sheetsUpdate(`USERS!B${i+2}`, [[hashPassword('DaLat')]]);
          return res.json({ success:true, message:`Đã reset mật khẩu ${target_username} về "DaLat"` });
        }
      }
      return res.json({ success:false, error:'Không tìm thấy tài khoản' });
    }

    return res.json({ success:false, error:'Action không hợp lệ' });

  } catch(e) {
    console.error('[auth]', e.message);
    return res.json({ success:false, error:'Lỗi hệ thống: ' + e.message });
  }
};
