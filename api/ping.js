module.exports = function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ ok: true, version: '1.1', time: new Date().toISOString() });
};
