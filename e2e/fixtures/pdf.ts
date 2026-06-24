// Builds a minimal, valid single-page PDF containing one line of selectable
// text — enough for PDF.js to render a real text layer in the e2e. Pure, no deps.
export function makeTextPdf(text: string): Buffer {
  return makeMultiPageTextPdf([text]);
}

// Builds a minimal, valid MULTI-page PDF — one line of selectable text per page,
// each on its own US-Letter page. Used by the scroll regression test: enough pages
// that the PDFViewer's scroll container must actually scroll to reach later pages.
// Pure, no deps.
export function makeMultiPageTextPdf(texts: string[]): Buffer {
  const pageCount = texts.length;
  // Object layout: 1=Catalog, 2=Pages, 3=shared Font, then per page a Page object
  // and its Contents stream object (2 objects each), appended after object 3.
  const objects: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  };

  const kids: string[] = [];
  let nextObj = 4;
  for (let i = 0; i < pageCount; i += 1) {
    const escaped = texts[i].replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const stream = `BT /F1 24 Tf 72 700 Td (${escaped}) Tj ET`;
    const pageObj = nextObj;
    const contentObj = nextObj + 1;
    nextObj += 2;
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents ${contentObj} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    kids.push(`${pageObj} 0 R`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`;

  const total = nextObj - 1; // highest object number
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i <= total; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
