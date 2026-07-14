import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ erro: 'URL nao fornecida.' }, { status: 400 });
    }

    if (!/(tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/.test(url)) {
      return NextResponse.json({ erro: 'URL nao parece ser do TikTok.' }, { status: 400 });
    }

    // Step 1: Resolve short URL to get the full URL with og_info
    let resolvedUrl = url;
    if (url.includes('vt.tiktok.com') || url.includes('vm.tiktok.com')) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
          signal: AbortSignal.timeout(8000),
        });
        const location = res.headers.get('location');
        if (location) resolvedUrl = location;
      } catch {}
    }

    // Step 2: Extract og_info from resolved URL
    let images: string[] = [];
    let title = '';
    try {
      const urlObj = new URL(resolvedUrl);
      const ogInfoRaw = urlObj.searchParams.get('og_info');
      if (ogInfoRaw) {
        const parsed = JSON.parse(ogInfoRaw);
        if (parsed.image) images.push(parsed.image.replace(/\\\//g, '/'));
        if (parsed.title) title = decodeURIComponent(parsed.title.replace(/\+/g, ' '));
      }
    } catch {}

    // Step 3: Return the resolved URL so the client can try to fetch the full page
    const productIdMatch = resolvedUrl.match(/\/view\/product\/(\d+)/) || resolvedUrl.match(/\/product\/(\d+)/);
    const uniqueIdMatch = resolvedUrl.match(/unique_id=([^&]+)/);

    return NextResponse.json({
      images,
      title,
      resolvedUrl,
      productId: productIdMatch?.[1],
      uniqueId: uniqueIdMatch?.[1],
    });
  } catch {
    return NextResponse.json({ erro: 'Erro interno.' }, { status: 500 });
  }
}
