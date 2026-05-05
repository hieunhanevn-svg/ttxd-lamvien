const { sheetsGet, sheetsAppend, sheetsUpdate, sheetsBatchGet, sheetsWriteRow, sheetsDeleteRow, getSheetIds, driveCreateFolder, getAccessToken, getDriveToken, verifyToken, cors, today, formatDate, safeNum, DRIVE_FOLDER } = require('./_sheets');

function bpLbl(n) { return ['','PA1: Tháo dỡ','PA2: Mời LV','PA3: Dán TB','PA4: Lập HS'][parseInt(n)] || 'PA'+n; }

function isQH(deadline, trang_thai) {
  if (trang_thai === 'hoan_thanh' || !deadline) return false;
  return new Date(deadline) < new Date(today());
}

function parseCase(r, idx) {
  const deadline = formatDate(r[12]);
  const status = r[13] || 'dang_xu_ly';
  return {
    ma_ho_so: r[0], ngay_tao: formatDate(r[1]), can_bo: r[2],
    dia_chi_chi_tiet: r[3], dia_gioi_cu: r[4],
    toa_do_lat: r[5], toa_do_lng: r[6],
    ngay_phat_hien: formatDate(r[8]), chu_dau_tu: r[9],
    loai_vi_pham: r[10], bien_phap: r[11], bien_phap_label: bpLbl(r[11]),
    deadline, trang_thai: status,
    ngay_hoan_thanh: formatDate(r[14]),
    drive_folder_id: r[15], drive_folder_link: r[15] ? `https://drive.google.com/drive/folders/${r[15]}` : '',
    anh_goc_ids: r[16] || '', ghi_chu: r[17] || '',
    is_qua_han: isQH(deadline, status),
    _row: idx + 2
  };
}

async function nextMaHoSo() {
  const year = new Date().getFullYear();
  const prefix = 'HS-' + year + '-';
  
  // Đọc TẤT CẢ mã hồ sơ hiện có để tìm max thực tế
  const rows = await sheetsGet('HO_SO!A2:A');
  let maxNum = 0;
  for (const r of rows) {
    if (r[0] && r[0].startsWith(prefix)) {
      const n = parseInt(r[0].replace(prefix, ''));
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  }
  
  // Tăng thêm 1 từ max thực tế
  let num = maxNum + 1;
  let maHoSo = prefix + String(num).padStart(3, '0');
  
  // Double-check: đảm bảo không trùng (phòng race condition)
  const existing = rows.map(r => r[0]).filter(Boolean);
  while (existing.includes(maHoSo)) {
    num++;
    maHoSo = prefix + String(num).padStart(3, '0');
  }
  
  return maHoSo;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const body = req.body || {};
  const { action, token } = body;
  const user = verifyToken(token);
  if (!user) return res.json({ success: false, error: 'Phiên đăng nhập hết hạn' });

  try {
    if (action === 'getCases') {
      const { tab, dia_gioi_cu, page=1, page_size=20 } = body;
      const rows = await sheetsGet('HO_SO!A2:R');
      let cases = rows.map((r,i) => parseCase(r,i)).filter(c => c.ma_ho_so);
      // Lọc theo quyền
      if (user.role !== 'admin') cases = cases.filter(c => c.can_bo === user.username);
      // Lọc tab
      if (tab === 'dang_xu_ly') cases = cases.filter(c => c.trang_thai !== 'hoan_thanh');
      else if (tab === 'hoan_thanh') cases = cases.filter(c => c.trang_thai === 'hoan_thanh');
      // Lọc địa giới
      if (dia_gioi_cu) cases = cases.filter(c => c.dia_gioi_cu === dia_gioi_cu);
      // Sắp xếp mới nhất trước
      cases.sort((a,b) => (b.ngay_tao||'').localeCompare(a.ngay_tao||''));
      const total = cases.length;
      const pg = parseInt(page);
      const ps = parseInt(page_size);
      const paged = cases.slice((pg-1)*ps, pg*ps);
      return res.json({ success:true, cases:paged, total_count:total, has_more: pg*ps < total, total_pages: Math.ceil(total/ps) });
    }

    if (action === 'getCaseDetail') {
      const { ma_ho_so } = body;
      const [hsRows, nkRows] = await sheetsBatchGet(['HO_SO!A2:R', 'NHAT_KY!A2:H']);
      const idx = hsRows.findIndex(r => r[0] === ma_ho_so);
      if (idx < 0) return res.json({ success:false, error:'Không tìm thấy hồ sơ' });
      const c = parseCase(hsRows[idx], idx);
      const nk = nkRows.filter(r => r[1] === ma_ho_so).map(r => ({
        ma_nhat_ky: r[0], ma_ho_so: r[1], ngay_cap_nhat: formatDate(r[2]),
        can_bo: r[3], loai: r[4], noi_dung: r[5],
        deadline_cap_nhat: formatDate(r[6]), anh_drive_ids: r[7]||''
      }));
      return res.json({ success:true, ho_so:c, nhat_ky:nk });
    }

    if (action === 'addCase') {
      const { dia_chi_chi_tiet, dia_gioi_cu, toa_do_lat, toa_do_lng, ngay_phat_hien, chu_dau_tu, loai_vi_pham, bien_phap, deadline, ghi_chu } = body;
      if (!dia_chi_chi_tiet || !dia_gioi_cu) return res.json({ success:false, error:'Thiếu địa chỉ hoặc địa giới hành chính' });
      console.log('addCase by:', user.username, 'role:', user.role);
      const maHoSo = await nextMaHoSo();
      // Tạo folder Drive
      const folderName = maHoSo; // Folder tên = Mã hồ sơ
      let folderId = '';
      try { folderId = await driveCreateFolder(folderName, DRIVE_FOLDER); } catch(e) { console.log('folder err:',e.message); }
      const now = new Date().toISOString();
      // Ghi vào đúng hàng tiếp theo (không bị lỗi offset)
      await sheetsWriteRow('HO_SO', [
        maHoSo, now, user.username, dia_chi_chi_tiet, dia_gioi_cu,
        toa_do_lat ? parseFloat(toa_do_lat) : '', toa_do_lng ? parseFloat(toa_do_lng) : '', '', ngay_phat_hien||today(),
        chu_dau_tu||'', loai_vi_pham||'khong_phep', String(bien_phap||1),
        deadline||'', 'dang_xu_ly', '', folderId, '', ghi_chu||''
      ]);
      // Nhật ký khởi tạo
      try {
        await sheetsWriteRow('NHAT_KY', [
          'NK-'+Date.now(), maHoSo, now, user.username, 'phat_hien',
          'Lập hồ sơ vi phạm. Biện pháp: '+bpLbl(bien_phap||1), deadline||'', ''
        ]);
      } catch(e) { console.log('NHAT_KY warn:', e.message); }
      return res.json({ success:true, ma_ho_so:maHoSo, drive_folder_id:folderId });
    }

    if (action === 'addUpdate') {
      const { ma_ho_so, noi_dung, deadline_moi } = body;
      if (!ma_ho_so || !noi_dung) return res.json({ success:false, error:'Thiếu nội dung' });
      const now = new Date().toISOString();
      await sheetsWriteRow('NHAT_KY', ['NK-'+Date.now(), ma_ho_so, now, user.username, 'cap_nhat', noi_dung, deadline_moi||'', '']);
      if (deadline_moi) {
        const rows = await sheetsGet('HO_SO!A2:M');
        const idx = rows.findIndex(r => r[0] === ma_ho_so);
        if (idx >= 0) await sheetsUpdate(`HO_SO!M${idx+2}`, [[deadline_moi]]);
      }
      return res.json({ success:true, message:'Đã cập nhật tiến độ' });
    }

    if (action === 'completeCase') {
      const { ma_ho_so, noi_dung } = body;
      const rows = await sheetsGet('HO_SO!A2:P');
      const idx = rows.findIndex(r => r[0] === ma_ho_so);
      if (idx < 0) return res.json({ success:false, error:'Không tìm thấy hồ sơ' });
      const todayStr = today();
      await sheetsUpdate(`HO_SO!N${idx+2}:O${idx+2}`, [['hoan_thanh', todayStr]]);
      await sheetsWriteRow('NHAT_KY', ['NK-'+Date.now(), ma_ho_so, new Date().toISOString(), user.username, 'hoan_thanh', noi_dung||'Hoàn thành xử lý', '', '']);
      return res.json({ success:true, message:'Đã đánh dấu hoàn thành' });
    }

    if (action === 'deleteCase') {
      if (user.role !== 'admin') return res.json({ success:false, error:'Chỉ Admin mới có quyền xóa' });
      const { ma_ho_so } = body;
      const [hsRows, nkRows] = await sheetsBatchGet(['HO_SO!A2:R', 'NHAT_KY!A2:B']);
      const idx = hsRows.findIndex(r => r[0] === ma_ho_so);
      if (idx < 0) return res.json({ success:false, error:'Không tìm thấy hồ sơ' });
      const folderId = hsRows[idx][15];
      // Xóa folder Drive nếu có
      if (folderId) {
        try {
          const tok = await getDriveToken(); // OAuth cá nhân mới xóa được Drive
          const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${tok}` }
          });
          if (delRes.status === 204) console.log('Deleted Drive folder:', folderId);
          else console.log('Drive delete status:', delRes.status);
        } catch(e) { console.log('Drive delete err:', e.message); }
      }
      // Lấy sheet IDs để xóa hàng thật sự
      const sheetIds = await getSheetIds();
      const hoSoSheetId = sheetIds['HO_SO'];
      const nhatKySheetId = sheetIds['NHAT_KY'];
      
      // Xóa nhật ký liên quan TRƯỚC (từ dưới lên để không lệch index)
      const nkIdxs = nkRows.map((r,i)=>r[1]===ma_ho_so?i:null).filter(i=>i!==null).reverse();
      for (const ni of nkIdxs) {
        try { await sheetsDeleteRow(nhatKySheetId, ni + 1); } // +1 vì bỏ header
        catch(e) { console.log('NK delete warn:', e.message); }
      }
      
      // Xóa hồ sơ (xóa hàng thật sự - không để trống)
      await sheetsDeleteRow(hoSoSheetId, idx + 1); // +1 vì bỏ header (row 0-based)
      return res.json({ success:true, message:'Đã xóa hồ sơ '+ma_ho_so+' và folder Drive' });
    }

    if (action === 'cleanupSheets') {
      if (user.role !== 'admin') return res.json({ success:false, error:'Không có quyền' });
      const sheetIds = await getSheetIds();
      const hoSoId = sheetIds['HO_SO'];
      const nkId = sheetIds['NHAT_KY'];
      let deleted = { ho_so_empty: 0, nk_orphan: 0, nk_empty: 0 };

      // 1. Lấy danh sách mã hồ sơ hợp lệ
      const hsRows = await sheetsGet('HO_SO!A2:A');
      const validMaCodes = new Set(hsRows.map(r => r[0]).filter(v => v && v.toString().trim()));

      // 2. Xóa hàng trống trong HO_SO (từ dưới lên)
      for (let i = hsRows.length - 1; i >= 0; i--) {
        if (!hsRows[i][0] || !hsRows[i][0].toString().trim()) {
          await sheetsDeleteRow(hoSoId, i + 1); // +1 bỏ header
          deleted.ho_so_empty++;
        }
      }

      // 3. Xử lý NHAT_KY
      const nkRows = await sheetsGet('NHAT_KY!A2:B');
      for (let i = nkRows.length - 1; i >= 0; i--) {
        const maHS = nkRows[i][1];
        const maNK = nkRows[i][0];
        if (!maNK || !maNK.toString().trim()) {
          await sheetsDeleteRow(nkId, i + 1);
          deleted.nk_empty++;
        } else if (maHS && !validMaCodes.has(maHS.toString())) {
          await sheetsDeleteRow(nkId, i + 1);
          deleted.nk_orphan++;
        }
      }

      return res.json({ success:true, message:'Dọn dẹp xong', deleted });
    }

    if (action === 'saveImageUrls') {
      const { ma_ho_so, urls } = body;
      if (!ma_ho_so || !urls?.length) return res.json({ success:false, error:'Thiếu dữ liệu' });
      const rows = await sheetsGet('HO_SO!A2:Q');
      const idx = rows.findIndex(r => r[0] === ma_ho_so);
      if (idx < 0) return res.json({ success:false, error:'Không tìm thấy hồ sơ' });
      const existing = rows[idx][16] ? rows[idx][16] + ',' : '';
      await sheetsUpdate(`HO_SO!Q${idx+2}`, [[existing + urls.join(',')]]);
      return res.json({ success:true, saved:urls.length });
    }

    return res.json({ success:false, error:'Action không hợp lệ' });
  } catch(e) {
    console.error('cases error:', e);
    return res.status(500).json({ success:false, error:e.message });
  }
}
