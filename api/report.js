const { sheetsGet, sheetsBatchGet, verifyToken, cors, today, formatDate } = require('./_sheets');

function bpLbl(n) { return ['','PA1: Tháo dỡ','PA2: Mời LV','PA3: Dán TB','PA4: Lập HS'][parseInt(n)]||'PA'+n; }
function isQH(dl, st) { return st!=='hoan_thanh' && dl && new Date(dl)<new Date(today()); }

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { action, token, from_date, to_date, dia_gioi_cu, trang_thai, can_bo } = req.body || {};
  const user = verifyToken(token);
  if (!user) return res.json({ success:false, error:'Phiên đăng nhập hết hạn' });

  try {
    const [hsRows, usersRows] = await sheetsBatchGet(['HO_SO!A2:R', 'USERS!A2:G']);
    let cases = hsRows.map(r => {
      const deadline = formatDate(r[12]);
      const st = r[13]||'dang_xu_ly';
      const qh = isQH(deadline, st);
      let tt = st==='hoan_thanh'?'Hoàn thành':(qh?'Quá hạn':'Đang xử lý');
      return {
        ma_ho_so:r[0], ngay_tao:formatDate(r[1]), can_bo:r[2],
        dia_chi_chi_tiet:r[3], dia_gioi_cu:r[4],
        toa_do_lat:r[5], toa_do_lng:r[6],
        ngay_phat_hien:formatDate(r[8]), chu_dau_tu:r[9],
        loai_vi_pham:r[10]==='khong_phep'?'Không phép':'Sai phép',
        bien_phap:bpLbl(r[11]), deadline,
        trang_thai:st, tinh_trang:tt,
        ngay_hoan_thanh:formatDate(r[14]),
        drive_folder_id:r[15],
        toa_do_gps:r[5]&&r[6]?`${r[5]}, ${r[6]}`:'',
        link_anh:r[15]?`https://drive.google.com/drive/folders/${r[15]}`:'',
        is_qua_han:qh
      };
    }).filter(c => c.ma_ho_so);

    // Lọc quyền
    if (user.role !== 'admin') cases = cases.filter(c => c.can_bo === user.username);
    // Lọc ngày
    if (from_date) cases = cases.filter(c => c.ngay_phat_hien >= from_date);
    if (to_date) cases = cases.filter(c => c.ngay_phat_hien <= to_date);
    if (dia_gioi_cu) cases = cases.filter(c => c.dia_gioi_cu === dia_gioi_cu);
    if (can_bo) cases = cases.filter(c => c.can_bo === can_bo);
    if (trang_thai === 'qua_han') cases = cases.filter(c => c.is_qua_han);
    else if (trang_thai === 'dang_xu_ly') cases = cases.filter(c => c.trang_thai!=='hoan_thanh'&&!c.is_qua_han);
    else if (trang_thai === 'hoan_thanh') cases = cases.filter(c => c.trang_thai==='hoan_thanh');

    // Đánh STT
    cases = cases.map((c,i) => ({...c, stt:i+1}));

    // Stats tổng
    const stats = {
      tong: cases.length,
      qua_han: cases.filter(c=>c.is_qua_han).length,
      dang_xu_ly: cases.filter(c=>c.trang_thai!=='hoan_thanh'&&!c.is_qua_han).length,
      hoan_thanh: cases.filter(c=>c.trang_thai==='hoan_thanh').length
    };

    // Stats theo cán bộ (admin only)
    let stats_can_bo = [];
    if (user.role === 'admin') {
      const cbMap = {};
      for (const c of cases) {
        if (!cbMap[c.can_bo]) cbMap[c.can_bo] = { can_bo:c.can_bo, tong:0, qua_han:0, dang_xu_ly:0, hoan_thanh:0 };
        cbMap[c.can_bo].tong++;
        if (c.is_qua_han) cbMap[c.can_bo].qua_han++;
        else if (c.trang_thai==='hoan_thanh') cbMap[c.can_bo].hoan_thanh++;
        else cbMap[c.can_bo].dang_xu_ly++;
      }
      stats_can_bo = Object.values(cbMap);
    }

    // Users list cho filter
    const users_list = user.role==='admin' ? usersRows.filter(r=>r[3]==='canbo').map(r=>({username:r[0],ho_ten:r[2]})) : [];

    return res.json({ success:true, cases, stats, stats_can_bo, users: users_list,
      ten_don_vi:'UBND Phường Lâm Viên — TP. Đà Lạt',
      generated_at: new Date().toLocaleString('vi-VN'),
      filter_info:{ from_date, to_date, dia_gioi_cu, trang_thai }
    });
  } catch(e) {
    return res.status(500).json({ success:false, error:e.message });
  }
}
