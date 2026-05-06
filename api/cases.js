const { sheetsGet, sheetsAppend, sheetsUpdate, sheetsBatchGet, sheetsWriteRow, sheetsWriteRows, sheetsDeleteRow, getSheetIds, createSheet, driveCreateFolder, getAccessToken, getDriveToken, verifyToken, cors, today, formatDate, safeNum, DRIVE_FOLDER } = require('./_sheets');

const HS_HEADERS = ['ma_ho_so','ngay_tao','can_bo','dia_chi_chi_tiet','dia_gioi_cu','toa_do_lat','toa_do_lng','timemark_dia_chi','ngay_phat_hien','chu_dau_tu','loai_vi_pham','bien_phap','deadline','trang_thai','ngay_hoan_thanh','drive_folder_id','anh_goc_ids','ghi_chu'];
const NK_HEADERS = ['ma_nhat_ky','ma_ho_so','ngay_cap_nhat','can_bo','loai','noi_dung','deadline_cap_nhat','anh_drive_ids'];

function bpLbl(n) { return ['','PA1: Thao do','PA2: Moi LV','PA3: Dan TB','PA4: Lap HS'][parseInt(n)] || 'PA'+n; }

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
    drive_folder_id: r[15], drive_folder_link: r[15] ? 'https://drive.google.com/drive/folders/'+r[15] : '',
    anh_goc_ids: r[16] || '', ghi_chu: r[17] || '',
    is_qua_han: isQH(deadline, status),
    _row: idx + 2
  };
}

async function nextMaHoSo() {
  const year = new Date().getFullYear();
  const prefix = 'HS-' + year + '-';
  const rows = await sheetsGet('HO_SO!A2:A');
  let maxNum = 0;
  for (const r of rows) {
    if (r[0] && r[0].startsWith(prefix)) {
      const n = parseInt(r[0].replace(prefix, ''));
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  }
  let num = maxNum + 1;
  let maHoSo = prefix + String(num).padStart(3, '0');
  const existing = rows.map(r => r[0]).filter(Boolean);
  while (existing.includes(maHoSo)) { num++; maHoSo = prefix + String(num).padStart(3, '0'); }
  return maHoSo;
}

// Tính ngày cắt lưu trữ (3 tháng trước hôm nay)
function getArchiveCutoff() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().split('T')[0];
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const body = req.body || {};
  const { action, token } = body;
  const user = verifyToken(token);
  if (!user) return res.json({ success: false, error: 'Phien dang nhap het han' });

  try {
    if (action === 'getCases') {
      const { tab, dia_gioi_cu, page=1, page_size=20 } = body;
      const rows = await sheetsGet('HO_SO!A2:R');
      let cases = rows.map((r,i) => parseCase(r,i)).filter(c => c.ma_ho_so);
      if (user.role !== 'admin') cases = cases.filter(c => c.can_bo === user.username);
      if (tab === 'dang_xu_ly') cases = cases.filter(c => c.trang_thai !== 'hoan_thanh');
      else if (tab === 'hoan_thanh') cases = cases.filter(c => c.trang_thai === 'hoan_thanh');
      if (dia_gioi_cu) cases = cases.filter(c => c.dia_gioi_cu === dia_gioi_cu);
      cases.sort((a,b) => (b.ngay_tao||'').localeCompare(a.ngay_tao||''));
      const total = cases.length;
      const pg = parseInt(page), ps = parseInt(page_size);
      const paged = cases.slice((pg-1)*ps, pg*ps);
      return res.json({ success:true, cases:paged, total_count:total, has_more: pg*ps < total, total_pages: Math.ceil(total/ps) });
    }

    if (action === 'getCaseDetail') {
      const { ma_ho_so, source } = body;
      // source = null → HO_SO, source = 'LICHSU_2025' → sheet lịch sử
      const hsSheet = source || 'HO_SO';
      const nkSheet = source ? 'NHAT_KY_' + source : 'NHAT_KY';
      const [hsRows, nkRows] = await sheetsBatchGet([hsSheet+'!A2:R', nkSheet+'!A2:H']);
      const idx = hsRows.findIndex(r => r[0] === ma_ho_so);
      if (idx < 0) return res.json({ success:false, error:'Khong tim thay ho so' });
      const c = parseCase(hsRows[idx], idx);
      c.source = source || null;
      c.is_lichsu = !!source;
      const nk = nkRows.filter(r => r[1] === ma_ho_so).map(r => ({
        ma_nhat_ky: r[0], ma_ho_so: r[1], ngay_cap_nhat: formatDate(r[2]),
        can_bo: r[3], loai: r[4], noi_dung: r[5],
        deadline_cap_nhat: formatDate(r[6]), anh_drive_ids: r[7]||''
      }));
      return res.json({ success:true, ho_so:c, nhat_ky:nk });
    }

    if (action === 'addCase') {
      const { dia_chi_chi_tiet, dia_gioi_cu, toa_do_lat, toa_do_lng, ngay_phat_hien, chu_dau_tu, loai_vi_pham, bien_phap, deadline, ghi_chu } = body;
      if (!dia_chi_chi_tiet || !dia_gioi_cu) return res.json({ success:false, error:'Thieu dia chi hoac dia gioi hanh chinh' });
      const maHoSo = await nextMaHoSo();
      let folderId = '';
      try { folderId = await driveCreateFolder(maHoSo, DRIVE_FOLDER); } catch(e) { console.log('folder err:',e.message); }
      const now = new Date().toISOString();
      await sheetsWriteRow('HO_SO', [
        maHoSo, now, user.username, dia_chi_chi_tiet, dia_gioi_cu,
        toa_do_lat ? parseFloat(toa_do_lat) : '', toa_do_lng ? parseFloat(toa_do_lng) : '',
        '', ngay_phat_hien||today(), chu_dau_tu||'', loai_vi_pham||'khong_phep',
        String(bien_phap||1), deadline||'', 'dang_xu_ly', '', folderId, '', ghi_chu||''
      ]);
      try {
        await sheetsWriteRow('NHAT_KY', [
          'NK-'+Date.now(), maHoSo, now, user.username, 'phat_hien',
          'Lap ho so vi pham. Bien phap: '+bpLbl(bien_phap||1), deadline||'', ''
        ]);
      } catch(e) { console.log('NHAT_KY warn:', e.message); }
      return res.json({ success:true, ma_ho_so:maHoSo, drive_folder_id:folderId });
    }

    if (action === 'addUpdate') {
      const { ma_ho_so, noi_dung, deadline_moi, source } = body;
      if (!ma_ho_so || !noi_dung) return res.json({ success:false, error:'Thieu noi dung' });
      const now = new Date().toISOString();

      if (source) {
        // Ho so lich su - chi admin duoc them ghi chu
        if (user.role !== 'admin') return res.json({ success:false, error:'Chi admin duoc them ghi chu vao ho so lich su' });
        const nkSheet = 'NHAT_KY_' + source;
        await sheetsWriteRow(nkSheet, ['NK-'+Date.now(), ma_ho_so, now, user.username, 'ghi_chu', noi_dung, '', '']);
        return res.json({ success:true, message:'Da them ghi chu vao ho so lich su' });
      }

      // Ho so hien tai
      await sheetsWriteRow('NHAT_KY', ['NK-'+Date.now(), ma_ho_so, now, user.username, 'cap_nhat', noi_dung, deadline_moi||'', '']);
      if (deadline_moi) {
        const rows = await sheetsGet('HO_SO!A2:M');
        const idx = rows.findIndex(r => r[0] === ma_ho_so);
        if (idx >= 0) await sheetsUpdate('HO_SO!M'+(idx+2), [[deadline_moi]]);
      }
      return res.json({ success:true, message:'Da cap nhat tien do' });
    }

    if (action === 'completeCase') {
      const { ma_ho_so, noi_dung } = body;
      const rows = await sheetsGet('HO_SO!A2:P');
      const idx = rows.findIndex(r => r[0] === ma_ho_so);
      if (idx < 0) return res.json({ success:false, error:'Khong tim thay ho so' });
      await sheetsUpdate('HO_SO!N'+(idx+2)+':O'+(idx+2), [['hoan_thanh', today()]]);
      await sheetsWriteRow('NHAT_KY', ['NK-'+Date.now(), ma_ho_so, new Date().toISOString(), user.username, 'hoan_thanh', noi_dung||'Hoan thanh xu ly', '', '']);
      return res.json({ success:true, message:'Da danh dau hoan thanh' });
    }

    if (action === 'deleteCase') {
      if (user.role !== 'admin') return res.json({ success:false, error:'Chi Admin moi co quyen xoa' });
      const { ma_ho_so, source } = body;
      // Không cho xóa hồ sơ lịch sử qua app - có tính pháp lý cao
      if (source && source.startsWith('LICHSU_')) {
        return res.json({ success:false, error:'Khong the xoa ho so lich su qua ung dung. Vui long thao tac truc tiep tren Google Sheets.' });
      }
      const [hsRows, nkRows] = await sheetsBatchGet(['HO_SO!A2:R', 'NHAT_KY!A2:B']);
      const idx = hsRows.findIndex(r => r[0] === ma_ho_so);
      if (idx < 0) return res.json({ success:false, error:'Khong tim thay ho so' });
      const folderId = hsRows[idx][15];
      if (folderId) {
        try {
          const tok = await getDriveToken();
          await fetch('https://www.googleapis.com/drive/v3/files/'+folderId, { method: 'DELETE', headers: { Authorization: 'Bearer '+tok } });
        } catch(e) { console.log('Drive delete err:', e.message); }
      }
      const sheetIds = await getSheetIds();
      const nkIdxs = nkRows.map((r,i)=>r[1]===ma_ho_so?i:null).filter(i=>i!==null).reverse();
      for (const ni of nkIdxs) {
        try { await sheetsDeleteRow(sheetIds['NHAT_KY'], ni + 1); } catch(e) {}
      }
      await sheetsDeleteRow(sheetIds['HO_SO'], idx + 1);
      return res.json({ success:true, message:'Da xoa ho so '+ma_ho_so+' va folder Drive' });
    }

    if (action === 'cleanupSheets') {
      if (user.role !== 'admin') return res.json({ success:false, error:'Khong co quyen' });
      const sheetIds = await getSheetIds();
      const hoSoId = sheetIds['HO_SO'], nkId = sheetIds['NHAT_KY'];
      let deleted = { ho_so_empty:0, nk_orphan:0, nk_empty:0 };
      const hsRows = await sheetsGet('HO_SO!A2:A');
      const validMa = new Set(hsRows.map(r=>r[0]).filter(v=>v&&v.toString().trim()));
      for (let i = hsRows.length-1; i >= 0; i--) {
        if (!hsRows[i][0]||!hsRows[i][0].toString().trim()) { await sheetsDeleteRow(hoSoId,i+1); deleted.ho_so_empty++; }
      }
      const nkRows = await sheetsGet('NHAT_KY!A2:B');
      for (let i = nkRows.length-1; i >= 0; i--) {
        const maHS=nkRows[i][1], maNK=nkRows[i][0];
        if (!maNK||!maNK.toString().trim()) { await sheetsDeleteRow(nkId,i+1); deleted.nk_empty++; }
        else if (maHS&&!validMa.has(maHS.toString())) { await sheetsDeleteRow(nkId,i+1); deleted.nk_orphan++; }
      }
      return res.json({ success:true, message:'Don dep xong', deleted });
    }

    // PREVIEW ARCHIVE - xem trước sẽ archive gì
    if (action === 'previewArchive') {
      if (user.role !== 'admin') return res.json({ success:false, error:'Khong co quyen' });
      const cutoff = getArchiveCutoff();
      const hsRows = await sheetsGet('HO_SO!A2:O');
      const eligible = hsRows.filter(r => r[13]==='hoan_thanh' && r[14] && formatDate(r[14])<=cutoff && r[0]);
      const byYear = {};
      eligible.forEach(r => {
        const yr = new Date(formatDate(r[14])).getFullYear();
        if (!byYear[yr]) byYear[yr] = 0;
        byYear[yr]++;
      });
      return res.json({ success:true, total:eligible.length, by_year:byYear, cutoff });
    }

    // ARCHIVE TO HISTORY - chuyển dữ liệu vào sheet lịch sử
    if (action === 'archiveToHistory') {
      if (user.role !== 'admin') return res.json({ success:false, error:'Khong co quyen' });
      const cutoff = getArchiveCutoff();
      const [hsRows, nkRows] = await sheetsBatchGet(['HO_SO!A2:R', 'NHAT_KY!A2:H']);
      const sheetIds = await getSheetIds();

      // Tìm hồ sơ đủ điều kiện archive
      const eligibleIdxs = [];
      hsRows.forEach((r,i) => {
        if (r[13]==='hoan_thanh' && r[14] && formatDate(r[14])<=cutoff && r[0]) eligibleIdxs.push(i);
      });
      if (eligibleIdxs.length === 0) return res.json({ success:true, message:'Khong co ho so nao can luu tru', archived:0 });

      // Nhóm theo năm hoàn thành
      const byYear = {};
      eligibleIdxs.forEach(i => {
        const yr = new Date(formatDate(hsRows[i][14])).getFullYear();
        if (!byYear[yr]) byYear[yr] = [];
        byYear[yr].push(i);
      });

      let totalArchived = 0;

      for (const [yr, idxs] of Object.entries(byYear)) {
        const lsSheet = 'LICHSU_'+yr;
        const nkLsSheet = 'NHAT_KY_LICHSU_'+yr;

        // Tạo sheet nếu chưa có
        const freshIds = await getSheetIds();
        if (!freshIds[lsSheet]) await createSheet(lsSheet, HS_HEADERS);
        if (!freshIds[nkLsSheet]) await createSheet(nkLsSheet, NK_HEADERS);

        // Copy hồ sơ sang LICHSU_[năm]
        const casesToArchive = idxs.map(i => hsRows[i]);
        await sheetsWriteRows(lsSheet, casesToArchive);

        // Copy nhật ký liên quan sang NHAT_KY_LICHSU_[năm]
        const maCodes = new Set(casesToArchive.map(r => r[0]));
        const nkToArchive = nkRows.filter(r => r[1] && maCodes.has(r[1]));
        if (nkToArchive.length) await sheetsWriteRows(nkLsSheet, nkToArchive);

        totalArchived += casesToArchive.length;
      }

      // Lấy lại sheetIds sau khi tạo sheet mới
      const latestIds = await getSheetIds();

      // Xóa nhật ký khỏi NHAT_KY (từ dưới lên)
      const archivedMa = new Set(eligibleIdxs.map(i => hsRows[i][0]));
      const nkDelIdxs = nkRows.map((r,i)=>archivedMa.has(r[1])?i:null).filter(i=>i!==null).reverse();
      for (const ni of nkDelIdxs) {
        try { await sheetsDeleteRow(latestIds['NHAT_KY'], ni+1); } catch(e) { console.log('NK del warn:',e.message); }
      }

      // Xóa hồ sơ khỏi HO_SO (từ dưới lên)
      const hoSoDelIdxs = [...eligibleIdxs].reverse();
      for (const hi of hoSoDelIdxs) {
        await sheetsDeleteRow(latestIds['HO_SO'], hi+1);
      }

      return res.json({ success:true, message:'Da luu tru '+totalArchived+' ho so', archived:totalArchived, by_year:Object.fromEntries(Object.entries(byYear).map(([y,v])=>[y,v.length])) });
    }

    if (action === 'saveImageUrls') {
      const { ma_ho_so, urls } = body;
      if (!ma_ho_so || !urls?.length) return res.json({ success:false, error:'Thieu du lieu' });
      const rows = await sheetsGet('HO_SO!A2:Q');
      const idx = rows.findIndex(r => r[0] === ma_ho_so);
      if (idx < 0) return res.json({ success:false, error:'Khong tim thay ho so' });
      const existing = rows[idx][16] ? rows[idx][16] + ',' : '';
      await sheetsUpdate('HO_SO!Q'+(idx+2), [[existing + urls.join(',')]]);
      return res.json({ success:true, saved:urls.length });
    }

    return res.json({ success:false, error:'Action khong hop le' });
  } catch(e) {
    console.error('cases error:', e);
    return res.status(500).json({ success:false, error:e.message });
  }
}
