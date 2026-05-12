module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pdfBase64 } = req.body;
    if (!pdfBase64) return res.status(400).json({ error: 'Missing pdfBase64' });

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: 'application/pdf',
                  data: pdfBase64
                }
              },
              {
                text: 'Extract toll transactions from this EZPass PDF. Group by TRANSACTION DATE (not posted date). Sum the amounts for each date. Return ONLY a JSON array, no markdown, no explanation. Format: [{"date":"MM/DD/YY","total":0.00},...] Use absolute values.'
              }
            ]
          }],
          generationConfig: { temperature: 0 }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.error ? data.error.message : 'Gemini API error');

    const text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : null;
    if (!text) throw new Error('No response from Gemini');

    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error('Unexpected response format');

    const tolls = parsed.map(function(t) {
      return { date: t.date, total: parseFloat(t.total) || 0 };
    });

    return res.status(200).json({ tolls: tolls });

  } catch (err) {
    console.error('extract-tolls error:', err);
    return res.status(500).json({ error: err.message });
  }
};
