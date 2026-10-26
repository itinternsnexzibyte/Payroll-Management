import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { BRAND_LOGOS } from '../logos';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ file: string }> }
) {
  const { file } = await context.params;

  // 1. Fast path: embedded verified brand assets
  if (BRAND_LOGOS[file]) {
    const entry = BRAND_LOGOS[file];
    const buffer = Buffer.from(entry.data, 'base64');
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': entry.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': buffer.length.toString(),
      },
    });
  }

  // 2. Fallback: file system lookup
  const candidates = [
    path.join(process.cwd(), 'apps/payroll-web/public/brand', file),
    path.join(process.cwd(), 'public/brand', file),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const buffer = fs.readFileSync(candidate);
        const ext = path.extname(file).toLowerCase();
        const contentType = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Length': buffer.length.toString(),
          },
        });
      }
    } catch {
      // Continue to next candidate
    }
  }

  return new NextResponse('Not found', { status: 404 });
}
