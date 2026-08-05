const fs = require('fs');
const pdfParse = require('pdf-parse');

const filePath = process.argv[2];
pdfParse(fs.readFileSync(filePath)).then((data) => {
  console.log(data.text);
});
