import { NextRequest, NextResponse } from 'next/server';

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e: any) {
    clearTimeout(timer);
    throw e;
  }
}

function extractJsonFromHtml(html: string): any[] {
  const results: any[] = [];
  const patterns = [
    /<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/,
    /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    /window\._ROUTER_DATA\s*=\s*({[\s\S]*?})\s*<\/script>/,
    /<script[^>]*>\s*self\.__next_f\.push\s*\(\s*\[[\d,"]*"([\s\S]*?)"\]\s*\)\s*<\/script>/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      try { results.push(JSON.parse(m[1])); } catch {}
    }
  }
  return results;
}

function deepFindImages(obj: any, depth = 0): string[] {
  const found: string[] = [];
  if (depth > 10 || !obj) return found;
  if (typeof obj === 'string') {
    if (obj.match(/^https?:\/\//) && obj.match(/\.(jpg|jpeg|png|webp|avif)/i) && obj.includes('tiktok')) {
      found.push(obj);
    }
    if (obj.match(/p\d+-sign-\w+\.tiktokcdn\.com/) || obj.match(/lf\d+-tiktok-common\.tiktokcdn/)) {
      found.push(obj);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) found.push(...deepFindImages(item, depth + 1));
  } else if (typeof obj === 'object') {
    for (const val of Object.values(obj)) found.push(...deepFindImages(val, depth + 1));
  }
  return found;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ erro: 'URL nao fornecida.' }, { status: 400 });
    }

    if (!/(tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/.test(url)) {
      return NextResponse.json({ erro: 'URL nao parece ser do TikTok.' }, { status: 400 });
    }

    // Extract video/product ID from URL
    const videoMatch = url.match(/\/video\/(\d+)/);
    const productMatch = url.match(/\/product\/([^/?]+)/) || url.match(/\/product\/(\d+)/);
    const itemIdMatch = url.match(/item_id=(\d+)/);

    const videoId = videoMatch?.[1];
    const productId = productMatch?.[1] || itemIdMatch?.[1];

    let images: string[] = [];

    // Strategy 1: Try oEmbed API (works for video URLs, returns thumbnail)
    if (videoId) {
      try {
        const oembedUrl = `https://www.tiktok.com/oembed?url=https://www.tiktok.com/video/${videoId}`;
        const oembedRes = await fetchWithTimeout(oembedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }, 5000);
        if (oembedRes.ok) {
          const oembed = await oembedRes.json();
          if (oembed.thumbnail_url) {
            images.push(oembed.thumbnail_url);
          }
        }
      } catch {}
    }

    // Strategy 2: Fetch the HTML page with various approaches
    const urls = [url];
    if (videoId) urls.push(`https://www.tiktok.com/video/${videoId}`);
    if (productId) urls.push(`https://shop.tiktok.com/product/${productId}`);

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    ];

    for (const tryUrl of urls) {
      if (images.length > 0) break;

      for (const ua of userAgents) {
        if (images.length > 0) break;

        try {
          const res = await fetchWithTimeout(tryUrl, {
            headers: {
              'User-Agent': ua,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8',
              'Accept-Encoding': 'gzip, deflate, br',
              'Cache-Control': 'no-cache',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
              'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"Windows"',
            },
          }, 10000);

          if (!res.ok) continue;
          const html = await res.text();
          if (html.length < 500) continue;

          // Extract from JSON in script tags
          const jsonData = extractJsonFromHtml(html);
          for (const data of jsonData) {
            const found = deepFindImages(data);
            images.push(...found);
          }

          // Fallback: regex on raw HTML
          if (images.length === 0) {
            const patterns = [
              /https?:\/\/p\d+-sign-[^"'\s\\]+\.tiktokcdn\.com\/[^"'\s\\]+/g,
              /https?:\/\/[^"'\s\\]*tiktokcdn\.com\/[^"'\s\\]+\.(jpg|jpeg|png|webp|avif)/gi,
              /https?:\/\/[^"'\s\\]*\.tiktok\.com\/obj\/[^"'\s\\]+/g,
            ];
            for (const pat of patterns) {
              const found = html.match(pat);
              if (found) images.push(...found);
            }
          }

          // og:image fallback
          if (images.length === 0) {
            const ogMatch = html.match(/content="(https?:\/\/[^"]*(?:tiktok|tiktokcdn)[^"]*)"[^>]*property="og:image"/i)
              || html.match(/property="og:image"[^>]*content="(https?:\/\/[^"]*(?:tiktok|tiktokcdn)[^"]*)"/i);
            if (ogMatch) images.push(ogMatch[1]);
          }

          // Any large image fallback
          if (images.length === 0) {
            const allImgs = html.match(/https?:\/\/[^"'\s\\]+\.(jpg|jpeg|png|webp|avif)/gi);
            if (allImgs) {
              images.push(...allImgs.filter(i => i.includes('tiktok') || i.includes('byteimg')));
            }
          }
        } catch {}
      }
    }

    // Deduplicate
    images = [...new Set(images)];

    // Filter junk
    images = images.filter(img => {
      const l = img.toLowerCase();
      if (l.includes('/icon') || l.includes('/logo') || l.includes('/avatar') || l.includes('/emoji')) return false;
      if (l.includes('favicon')) return false;
      return true;
    });

    if (images.length === 0) {
      return NextResponse.json({
        erro: 'Nao foi possivel buscar as imagens. O TikTok pode estar bloqueando acesso automatico. Tente copiar o link novamente diretamente do app/site.',
      }, { status: 404 });
    }

    return NextResponse.json({ images });
  } catch {
    return NextResponse.json({ erro: 'Erro interno ao processar a requisicao.' }, { status: 500 });
  }
}
