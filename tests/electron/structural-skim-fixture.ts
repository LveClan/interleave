/** Minimal text PDF, following packages/importers/scripts/make-fixtures.mjs. */
export function structuralSkimPdf(): Buffer {
  const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pages: number[] = [];
  for (let page = 1; page <= 300; page++) {
    const pageObject = objects.length + 1;
    pages.push(pageObject);
    const text =
      `BT\n/F1 16 Tf\n72 720 Td\n(T134 structural reading - page ${page}) Tj\n` +
      "0 -28 Td\n/F1 12 Tf\n(Every chapter retains its original source and page location.) Tj\n" +
      "0 -24 Td\n(Selected sections return independently for deliberate reading.) Tj\nET\n";
    objects.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject + 1} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}endstream`,
    );
  }
  const outlineRoot = objects.length + 1;
  objects.push(
    `<< /Type /Outlines /First ${outlineRoot + 1} 0 R /Last ${outlineRoot + 15} 0 R /Count 15 >>`,
  );
  for (let chapter = 0; chapter < 15; chapter++) {
    const number = outlineRoot + chapter + 1;
    const title =
      chapter === 0 ? "Front matter" : `Chapter ${String(chapter + 1).padStart(2, "0")}`;
    objects.push(
      `<< /Title (${title}) /Parent ${outlineRoot} 0 R ` +
        `/Dest [${pages[chapter * 20]} 0 R /Fit] ` +
        (chapter ? `/Prev ${number - 1} 0 R ` : "") +
        (chapter < 14 ? `/Next ${number + 1} 0 R ` : "") +
        ">>",
    );
  }
  objects[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineRoot} 0 R >>`;
  objects[1] = `<< /Type /Pages /Kids [${pages.map((n) => `${n} 0 R`).join(" ")}] /Count 300 >>`;
  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}
