const { sheetsGet, sheetsAppend, hashPassword, signToken, verifyToken, cors } = require('./_sheets');

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, token, username, password, old_password, new_password, target_username } = req.body || {};

  try {
    // LOGIN
    if (action === 'login') {
      const rows = await sheetsGet('USERS!A2:G');
      const hash = hashPassword(password || '');
      for (const r of rows) {
        if (r[0] === username && r[1] === hash && r[4] === 'active') {
          const tok = signToken({ username: r[0], role: r[3], ho_ten: r[2] });
          return res.json({ success: true, token: tok, user: { username: r[0], ho_ten: r[2], role: r[3], quan_ly_boi: r[5]||'' } });
        }
      }
      return res.json({ success: false, error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }

    // Verify token cho các action khác
    const user = verifyToken(token);
    if (!user && action !== 'login') return res.json({ success: false, error: 'Phiên đăng nhập hết hạn' });

    // LOGOUT
    if (action === 'logout') return res.json({ success: true });

    // CHANGE PASSWORD
    if (action === 'changePassword') {
      const rows = await sheetsGet('USERS!A2:G');
      const oldHash = hashPassword(old_password || '');
      const newHash = hashPassword(new_password || '');
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === user.username && rows[i][1] === oldHash) {
          await sheetsUpdate(`USERS!B${i+2}`, [[newHash]]);
          return res.json({ success: true, message: 'Đổi mật khẩu thành công' });
        }
      }
      return res.json({ success: false, error: 'Mật khẩu cũ không đúng' });
    }

    // RESET PASSWORD (admin)
    if (action === 'resetPassword') {
      if (user.role !== 'admin') return res.json({ success: false, error: 'Không có quyền' });
      const defaultPass = 'DaLat';
      const rows = await sheetsGet('USERS!A2:G');
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === target_username) {
          await sheetsUpdate(`USERS!B${i+2}`, [[hashPassword(defaultPass)]]);
          return res.json({ success: true, message: `Đã reset mật khẩu ${target_username} về "${defaultPass}"` });
        }
      }
      return res.json({ success: false, error: 'Không tìm thấy tài khoản' });
    }

    return res.json({ success: false, error: 'Action không hợp lệ' });
  } catch(e) {
    console.error('auth error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
