const APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycbxn3je0b7U_I6H5Gk_NW639uDo-XdexcWUgyF3VibrlXX6kRz9TgZv5tdfVC2pNUm8k/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});

  try {
    const body = { action: 'uploadImage', ...req.body };
    
    // Gọi Apps Script từ server (không bị CORS)
    const resp = await fetch(APPS_SCRIPT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    });
    
    const text = await resp.text();
    try {
      return res.json(JSON.parse(text));
    } catch(e) {
      // Nếu Apps Script redirect → thử parse từ redirect response
      return res.json({ success: false, error: 'Apps Script response: ' + text.substring(0,200) });
    }
  } catch(e) {
    return res.json({ success: false, error: 'Upload proxy error: ' + e.message });
  }
}
