import { PDFDocument } from "pdf-lib";
import fs from "node:fs/promises";

export async function mergePDFs(files, outFile) {
  const pdfDoc = await PDFDocument.create();
  for (const f of files) {
    const bytes = await fs.readFile(f);
    const donor = await PDFDocument.load(bytes);
    const pages = await pdfDoc.copyPages(donor, donor.getPageIndices());
    for (const p of pages) pdfDoc.addPage(p);
  }
  const pdfBytes = await pdfDoc.save();
  await fs.writeFile(outFile, pdfBytes);
  return outFile;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const out = process.argv[2];
  const files = process.argv.slice(3);
  if (!out || !files.length) {
    console.error("usage: node merge.js <out.pdf> <in1.pdf> <in2.pdf> ...");
    process.exit(1);
  }
  mergePDFs(files, out)
    .then((f) => console.log("merged:", f))
    .catch((e) => console.error(e));
}