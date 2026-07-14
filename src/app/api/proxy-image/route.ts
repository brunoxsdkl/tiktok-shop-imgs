import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get('src');

  if (!src) {
    return NextResponse.json({ erro: 'Parametro src obrigatorio.' }, { status: 400 });
  }

  try {
    const parsedUrl = new URL(src);

    const isAllowed = parsedUrl.hostname.includes('tiktokcdn') ||
      parsedUrl.hostname.includes('tiktok.com') ||
      parsedUrl.hostname.includes('byteimg') ||
      parsedUrl.hostname.includes('bytedance');

    if (!isAllowed) {
      return NextResponse.json({ erro: 'Host nao permitido.' }, { status: 403 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(src, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.tiktok.com/',
      },
    });

    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ erro: 'Falha ao buscar imagem.' }, { status: 502 });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ erro: 'Erro ao proxy da imagem.' }, { status: 500 });
  }
}
