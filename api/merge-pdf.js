const { PDFDocument } = require('pdf-lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { filledPdfB64, ezpassB64 } = req.body;
    if (!filledPdfB64) return res.status(400).json({ error: 'Missing filledPdfB64' });
    if (!ezpassB64)   return res.status(400).json({ error: 'Missing ezpassB64' });
    const filledBytes = Buffer.from(filledPdfB64, 'base64');
    const ezpassBytes = Buffer.from(ezpassB64, 'base64');
    const filledDoc   = await PDFDocument.load(filledBytes);
    const ezpassDoc   = await PDFDocument.load(ezpassBytes);
    const pages = await filledDoc.copyPages(ezpassDoc, ezpassDoc.getPageIndices());
    pages.forEach(page => filledDoc.addPage(page));
    const mergedB64 = Buffer.from(await filledDoc.save()).toString('base64');
    return res.status(200).json({ mergedPdfB64: mergedB64 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
