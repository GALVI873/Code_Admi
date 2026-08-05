const XLSX = require('xlsx');
const filePath = process.argv[2];

const wb = XLSX.readFile(filePath);
for (const sheetName of wb.SheetNames) {
  console.log(`\n===== HOJA: ${sheetName} =====`);
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  rows.slice(0, 60).forEach((row, i) => {
    const nonEmpty = row.some((c) => String(c).trim() !== '');
    if (nonEmpty) console.log(`${i + 1}: ${JSON.stringify(row)}`);
  });
}
