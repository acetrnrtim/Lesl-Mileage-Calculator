const { PDFDocument } = require('pdf-lib');

const RATE = 0.725;

// Fields we intentionally skip (AP dept only, signatures, etc.)
const SKIP_FIELDS = new Set([
  'AP DEPARTMENT USE ONLY','Date Received','AP Review Date','PART I  TOTALSRow1','PART II  TOTALSRow1','PART II  TOTALSRow2',
  'AIR TRANSPORT EXPENSE300','LODGING EXPENSE300',
  'OTHER TRAVEL eg telephone300','NONTRAVEL EXPENSE list separately300',
  'TRAVEL MEAL EXPENSE list separately300',
  '373','25th of each month in order to be accounted for in correct fiscal period'
]);

function safeSet(form, fieldName, value) {
  if (SKIP_FIELDS.has(fieldName)) return;
  try {
    const field = form.getTextField(fieldName);
    field.setText(String(value === null || value === undefined ? '' : value));
  } catch(e) {
    // Field doesn't exist or wrong type — skip silently
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pdfBase64, cfg, entries, tolls } = req.body;

    if (!pdfBase64) return res.status(400).json({ error: 'Missing pdfBase64' });
    if (!cfg)       return res.status(400).json({ error: 'Missing cfg' });
    if (!entries)   return res.status(400).json({ error: 'Missing entries' });

    const pdfBytes = Buffer.from(pdfBase64, 'base64');
    const pdfDoc   = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form     = pdfDoc.getForm();

    // Set right alignment on DMR/total fields that default to left
    const rightAlignFields = ['DMR1','DMR2','DMR3','DMR4','DMR5','DMR6','DMR7','DMR8','DMR9','DMR10','DMRtotal','TotalR','Part total'];
    rightAlignFields.forEach(name => {
      try { form.getTextField(name).setAlignment(require('pdf-lib').TextAlignment.Right); } catch(e) {}
    });

    // ── HEADER ──────────────────────────────────────────────────────────
    safeSet(form, '2026 Employee Expense and Mileage Reimbursement', cfg.name);
    safeSet(form, 'EMPLOYEE',    cfg.empid);
    safeSet(form, 'LOCATION',    cfg.loc);
    safeSet(form, 'COST CENTER', cfg.cc);
    safeSet(form, 'DATE',        'Week ' + cfg.week);
    safeSet(form, 'PART II  MILEAGE Reimbursed per IRS business rate of 0725mile for Calendar 2026Row1', '$0.725');
    safeSet(form, 'undefined',   cfg.name); // User acknowledging compliance to Policy

    // Bottom DATE widget shares field name with top DATE but should show generation date
    // Target it directly via annotation rect (bottom widget has higher y value)
    const { PDFName, PDFString, PDFArray } = require('pdf-lib');
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yyyy = today.getFullYear();
    const todayStr = mm + '/' + dd + '/' + String(yyyy).slice(-2);
    try {
      const annots = pdfDoc.getPages()[0].node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (annots) {
        for (let i = 0; i < annots.size(); i++) {
          const annot = annots.lookup(i);
          const t = annot.lookupMaybe(PDFName.of('T'), PDFString);
          const rect = annot.lookupMaybe(PDFName.of('Rect'), PDFArray);
          if (t && t.value === 'DATE' && rect) {
            const y = parseFloat(rect.lookup(1).toString());
            if (y < 100) { // bottom DATE has low y in PDF coords (PDF y=0 is bottom)
              annot.set(PDFName.of('V'), PDFString.of(todayStr));
            }
          }
        }
      }
    } catch(e) { /* fallback — bottom DATE stays as Week X */ }

    // ── PART I — TOLLS ──────────────────────────────────────────────────
    const tollsArr = Array.isArray(tolls) ? tolls : [];

    // Build a set of trip dates in MM/DD/YY format for quick lookup
    const tripDates = new Set(entries.map(e => {
      const [yr, mo, dy] = e.date.split('-');
      return mo + '/' + dy + '/' + yr.slice(-2);
    }));

    // Only include tolls on dates that have a corresponding trip entry
    const matchedTolls = tollsArr.filter(t => tripDates.has(t.date));

    const sortedTolls = [...matchedTolls].sort((a, b) => {
      const [am, ad, ay] = a.date.split('/');
      const [bm, bd, by] = b.date.split('/');
      return new Date('20'+ay, am-1, ad) - new Date('20'+by, bm-1, bd);
    });
    let tollGrandTotal = 0;

    sortedTolls.slice(0, 13).forEach((toll, i) => {
      const n = i + 1;
      const amt = parseFloat(toll.total) || 0;
      tollGrandTotal += amt;
      safeSet(form, 'DATERow' + n, toll.date);
      safeSet(form, 'PURPOSE AND LOCATION OF TRAVEL DESCRIPTION OF EXPENSESRow' + n, 'Tolls');
      safeSet(form, '200Row' + n, amt.toFixed(2));
    });

    // Part I total (ground transport column total)
    if (tollGrandTotal > 0) {
      safeSet(form, 'PART I  TOTALSRow1', tollGrandTotal.toFixed(2));
    }

    // ── PART II — MILEAGE ────────────────────────────────────────────────
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    let totalNetMiles = 0;
    let totalDMR = 0;

    sorted.slice(0, 10).forEach((e, i) => {
      const n        = i + 1;
      const dateRow  = n + 1;  // DateRow2..DateRow11
      const storeSfx = i === 0 ? '00' : '00_' + (i + 1);
      const purpSfx  = i === 0 ? '00' : '00_' + (i + 1);

      const [yr, mo, dy] = e.date.split('-');
      const fmtDate = mo + '/' + dy + '/' + yr.slice(-2);

      const ms  = parseFloat(e.ms)  || 0;
      const me  = parseFloat(e.me)  || 0;
      const cm  = parseFloat(e.cm)  || 0;
      const tot = me - ms;
      const net = Math.max(0, tot - cm);
      const dmr = net * RATE;

      totalNetMiles += net;
      totalDMR      += dmr;

      // Data fields
      safeSet(form, 'DateRow' + dateRow, fmtDate);
      safeSet(form, 'Name of Business Store Name or Number' + storeSfx, e.store || '');
      safeSet(form, 'Purpose  Comments' + purpSfx, e.purpose || '');
      safeSet(form, 'MS' + n, String(Math.round(ms)));
      safeSet(form, 'ME' + n, String(Math.round(me)));
      safeSet(form, 'CM' + n, String(Math.round(cm)));

      // Calculated fields — we fill these ourselves since PDF JS won't run
      safeSet(form, 'MT' + n,       String(Math.round(tot)));
      safeSet(form, 'NetMiles' + n, String(Math.round(net)));
      safeSet(form, 'DMR' + n,      dmr.toFixed(2));
    });

    // Part II totals
    safeSet(form, 'DMRtotal',           totalDMR.toFixed(2));
    safeSet(form, 'PART II  TOTALSRow1', String(Math.round(totalNetMiles)));
    safeSet(form, 'PART II  TOTALSRow2', totalDMR.toFixed(2));

    // Part total = ground transport subtotal (tolls only)
    // TotalR = grand total (tolls + mileage)
    const grandTotal = tollGrandTotal + totalDMR;
    safeSet(form, 'Part total', tollGrandTotal.toFixed(2));
    safeSet(form, 'TotalR',     grandTotal.toFixed(2));

    const filledBytes = await pdfDoc.save();
    const filledB64   = Buffer.from(filledBytes).toString('base64');

    return res.status(200).json({ filledPdfB64: filledB64 });

  } catch (err) {
    console.error('fill-pdf error:', err);
    return res.status(500).json({ error: err.message });
  }
};
