import { Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { ENV, type Env } from '../config/env.js';

export interface PrintableQr {
  token: string;
  storeName: string;
  tableLabel: string;
}

@Injectable()
export class QrService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  orderUrl(token: string) {
    return this.env.orderQrUrlTemplate.replace('{token}', encodeURIComponent(token));
  }

  png(token: string): Promise<Buffer> {
    return QRCode.toBuffer(this.orderUrl(token), { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 600 });
  }

  /** A4 한 장에 2×3 개씩 테이블 QR 을 배치한 인쇄용 PDF */
  async printPdf(items: PrintableQr[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: 'Table QR codes' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    // PDF 기본 글꼴은 한글을 표시하지 못해 테이블 라벨의 영문·숫자만 인쇄한다. 한글 글꼴 내장은 6단계에서 추가
    const cols = 2;
    const rows = 3;
    const cellW = (doc.page.width - 72) / cols;
    const cellH = (doc.page.height - 72) / rows;
    for (let i = 0; i < items.length; i++) {
      const slot = i % (cols * rows);
      if (i > 0 && slot === 0) doc.addPage();
      const x = 36 + (slot % cols) * cellW;
      const y = 36 + Math.floor(slot / cols) * cellH;
      const png = await this.png(items[i]!.token);
      const size = Math.min(cellW, cellH) - 70;
      doc.image(png, x + (cellW - size) / 2, y + 10, { width: size, height: size });
      doc
        .fontSize(16)
        .text(`TABLE ${asciiLabel(items[i]!.tableLabel)}`, x, y + size + 18, { width: cellW, align: 'center' })
        .fontSize(9)
        .fillColor('#555')
        .text('Scan to order', x, y + size + 40, { width: cellW, align: 'center' })
        .fillColor('#000');
    }
    doc.end();
    return done;
  }
}

function asciiLabel(label: string) {
  const ascii = label.replace(/[^\x20-\x7E]/g, '');
  return ascii.length ? ascii : '?';
}
