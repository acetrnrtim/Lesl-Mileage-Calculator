const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const pdfPath = path.join(process.cwd(), 'public', 'blank-form.pdf');
    const buffer  = fs.readFileSync(pdfPath);
    const base64  = buffer.toString('base64');
    return res.status(200).json({ base64 });
  } catch (err) {
    console.error('fetch-pdf error:', err);
    return res.status(500).json({ error: err.message });
  }
};
