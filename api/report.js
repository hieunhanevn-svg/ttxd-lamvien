const { sheetsGet, sheetsBatchGet, getSheetIds, verifyToken, cors, today, formatDate } = require('./_sheets');

function bpLbl(n) { return ['','PA1: Thao do','PA2: Moi LV','PA3: Dan TB','PA4: Lap HS'][parseInt(n)]||'PA'+n; }
function isQH(dl, st) { return st!=='hoan_thanh' && dl && new Date(dl)<new Date(today()); }

function parseRow(r, source) {
  const deadline = formatDate(r[12]);
  const st = r[13]||'dang_xu_ly';
  const qh = isQH(deadline, st);
  return {
    ma_ho_so:r[0], ngay_tao:formatDate(r[1]), can_bo:r[2],
    dia_chi_chi_tiet:r[3], dia_gioi_cu:r[4],
    toa_do_lat:r[5], toa_do_lng:r[6],
    ngay_phat_hien:formatDate(r[8]), chu_dau_tu:r[9],
    loai_vi_pham:r[10]==='khong_phep'?'Khong phep':'Sai phep',
    bien_phap:bpLbl(r[11]), deadline,
    trang_thai:st, tinh_trang:st==='hoan_thanh'?'Hoan thanh':(qh?'Qua han':'Dang xu ly'),
    ngay_hoan_thanh:formatDate(r[14]),
    drive_folder_id:r[15],
    toa_do_gps:r[5]&&r[6]?r[5]+', '+r[6]:'',
    link_anh:r[15]?'https://drive.google.com/drive/folders/'+r[15]:'',
    is_qua_han:qh,
    source: source||null,
    is_lichsu: !!source,
    source_year: source ? source.replace('LICHSU_','') : null
  };
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { action, token, from_date, to_date, dia_gioi_cu, trang_thai, can_bo } = req.body || {};
  const user = verifyToken(token);
  if (!user) return res.json({ success:false, error:'Phien dang nhap het han' });

  try {
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(now.getMonth() - 3);
    const cutoffDate = threeMonthsAgo.toISOString().split('T')[0];

    // Xác định có cần query sheet lịch sử không
    const needHistory = from_date && from_date < cutoffDate;
    const historySheetNames = [];
    if (needHistory) {
      const sheetIds = await getSheetIds();
      const fromYear = new Date(from_date).getFullYear();
      const toYear = to_date ? new Date(to_date).getFullYear() : now.getFullYear();
      for (let y = fromYear; y <= toYear; y++) {
        const sn = 'LICHSU_'+y;
        if (sheetIds[sn]) historySheetNames.push(sn);
      }
    }

    // Query HO_SO + USERS + history sheets cùng lúc
    const ranges = ['HO_SO!A2:R', 'USERS!A2:G', ...historySheetNames.map(sn => sn+'!A2:R')];
    const results = await sheetsBatchGet(ranges);
    const hsRows = results[0];
    const usersRows = results[1];

    // Parse hồ sơ hiện tại
    let cases = hsRows.map(r => parseRow(r, null)).filter(c => c.ma_ho_so);

    // Parse hồ sơ lịch sử (nếu có)
    historySheetNames.forEach((sn, si) => {
      const histRows = results[2+si] || [];
      const histCases = histRows.map(r => parseRow(r, sn)).filter(c => c.ma_ho_so);
      cases = cases.concat(histCases);
    });

    // Lọc quyền
    if (user.role !== 'admin') cases = cases.filter(c => c.can_bo === user.username);

    // Lọc ngày phát hiện
    if (from_date) cases = cases.filter(c => c.ngay_phat_hien >= from_date);
    if (to_date) cases = cases.filter(c => c.ngay_phat_hien <= to_date);
    if (dia_gioi_cu) cases = cases.filter(c => c.dia_gioi_cu === dia_gioi_cu);
    if (can_bo) cases = cases.filter(c => c.can_bo === can_bo);
    if (trang_thai === 'qua_han') cases = cases.filter(c => c.is_qua_han);
    else if (trang_thai === 'dang_xu_ly') cases = cases.filter(c => c.trang_thai!=='hoan_thanh'&&!c.is_qua_han);
    else if (trang_thai === 'hoan_thanh') cases = cases.filter(c => c.trang_thai==='hoan_thanh');

    // Sắp xếp theo ngày phát hiện mới nhất
    cases.sort((a,b) => (b.ngay_phat_hien||'').localeCompare(a.ngay_phat_hien||''));
    cases = cases.map((c,i) => ({...c, stt:i+1}));

    const stats = {
      tong:cases.length,
      qua_han:cases.filter(c=>c.is_qua_han).length,
      dang_xu_ly:cases.filter(c=>c.trang_thai!=='hoan_thanh'&&!c.is_qua_han).length,
      hoan_thanh:cases.filter(c=>c.trang_thai==='hoan_thanh').length,
      lichsu:cases.filter(c=>c.is_lichsu).length
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

    // Users list cho filter - bao gồm cả admin
    const users_list = user.role==='admin'
      ? usersRows.filter(r=>r[4]==='active'||!r[4]).map(r=>({username:r[0],ho_ten:r[2],role:r[3]}))
      : [];

    return res.json({
      success:true, cases, stats, stats_can_bo, users:users_list,
      ten_don_vi:'UBND Phường Lâm Viên — Đà Lạt',
      generated_at: new Date().toLocaleString('vi-VN'),
      filter_info:{ from_date, to_date, dia_gioi_cu, trang_thai },
      has_history: historySheetNames.length > 0
    });
  } catch(e) {
    return res.status(500).json({ success:false, error:e.message });
  }
}
