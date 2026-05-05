const APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycbxn3je0b7U_I6H5Gk_NW639uDo-XdexcWUgyF3VibrlXX6kRz9TgZv5tdfVC2pNUm8k/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = req.body;

  try {
    // Bước 1: POST đến Apps Script, KHÔNG auto-follow redirect
    const resp1 = await fetch(APPS_SCRIPT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body),
      redirect: 'manual'
    });

    let text;

    if (resp1.status >= 300 && resp1.status < 400) {
      // Apps Script redirect 302 → POST lại đến URL đích (giữ body)
      const location = resp1.headers.get('location');
      const resp2 = await fetch(location, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(body)
      });
      text = await resp2.text();
    } else {
      text = await resp1.text();
    }

    try {
      return res.json(JSON.parse(text));
    } catch(e) {
      return res.json({ success: false, error: 'Parse error: ' + text.substring(0, 300) });
    }
  } catch(e) {
    return res.json({ success: false, error: e.message });
  }
}
