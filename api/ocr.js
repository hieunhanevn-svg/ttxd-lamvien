export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.json({success:false, error:'Chưa cài ANTHROPIC_API_KEY trong Vercel'});

  const { image_base64, mime_type } = req.body;
  if (!image_base64) return res.json({success:false, error:'Thiếu ảnh'});

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type:'image', source:{ type:'base64', media_type: mime_type||'image/jpeg', data: image_base64 } },
            { type:'text', text:'Đây là ảnh Timemark chụp công trình. Đọc thông tin watermark và trả về JSON (chỉ JSON, không giải thích): {"lat":<vĩ độ số thực>,"lng":<kinh độ số thực>,"date":"<YYYY-MM-DD>","address":"<địa chỉ>"}. Ví dụ: tọa độ "11.964472°N, 108.475180°E" → lat=11.964472, lng=108.475180.' }
          ]
        }]
      })
    });
    const data = await resp.json();
    if (data.error) return res.json({success:false, error:data.error.message});
    const text = (data.content[0].text||'').replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(text);
    return res.json({success:true, lat:parsed.lat, lng:parsed.lng, date:parsed.date, address:parsed.address||''});
  } catch(e) {
    return res.json({success:false, error:'Lỗi OCR: '+e.message});
  }
}

