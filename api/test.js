const { getAccessToken, sheetsGet, SS_ID } = require('./_sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = {};

  try {
    // Kiểm tra header row HO_SO
    const headers = await sheetsGet('HO_SO!A1:R1');
    results.ho_so_headers = headers[0] || [];
    results.ho_so_col_count = (headers[0] || []).length;

    // Xem 3 dòng đầu dữ liệu (row 2-4)
    const rows = await sheetsGet('HO_SO!A1:R5');
    results.ho_so_rows = rows.length;
    results.ho_so_sample = rows.slice(0,3).map(r => ({
      A: r[0], B: r[1], C: r[2], D: r[3],
      col_count: r.length
    }));

    // Kiểm tra sheet IDs (cần để xóa row đúng)
    const token = await getAccessToken();
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SS_ID}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = await metaRes.json();
    results.sheets = meta.sheets?.map(s => ({
      name: s.properties.title,
      id: s.properties.sheetId
    }));
  } catch(e) {
    results.error = e.message;
  }

  res.json(results);
};
