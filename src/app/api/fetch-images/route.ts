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

function deepFindImages(obj: any, depth = 0): string[] {
  const found: string[] = [];
  if (depth > 12 || !obj) return found;
  if (typeof obj === 'string') {
    if (obj.match(/^https?:\/\//) && (obj.includes('tiktokcdn') || obj.includes('byteimg') || obj.includes('bytedance'))) {
      if (obj.match(/\.(jpg|jpeg|png|webp|avif)/i) || obj.match(/\/~tplv|\/obj|\/spectrum|\/tos/)) {
        found.push(obj);
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) found.push(...deepFindImages(item, depth + 1));
  } else if (typeof obj === 'object') {
    for (const val of Object.values(obj)) found.push(...deepFindImages(val, depth + 1));
  }
  return found;
}

// Try multiple CORS proxies to bypass TikTok blocking
async function fetchViaProxy(targetUrl: string): Promise<string | null> {
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await fetchWithTimeout(proxyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }, 12000);
      if (res.ok) {
        const text = await res.text();
        if (text.length > 500 && (text.includes('tiktok') || text.includes('video'))) {
          return text;
        }
      }
    } catch {}
  }
  return null;
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

    let images: string[] = [];

    // 1) Try oEmbed first (never blocked)
    const videoMatch = url.match(/\/video\/(\d+)/);
    if (videoMatch) {
      try {
        const oembedUrl = `https://www.tiktok.com/oembed?url=https://www.tiktok.com/video/${videoMatch[1]}`;
        const oembedRes = await fetchWithTimeout(oembedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }, 5000);
        if (oembedRes.ok) {
          const oembed = await oembedRes.json();
          if (oembed.thumbnail_url) images.push(oembed.thumbnail_url);
          // oEmbed also returns author info, try to get more from thumbnail
        }
      } catch {}
    }

    // 2) Try fetching via CORS proxies
    if (images.length === 0) {
      const tryUrls = [url];
      if (videoMatch) tryUrls.push(`https://www.tiktok.com/video/${videoMatch[1]}`);

      for (const tryUrl of tryUrls) {
        if (images.length > 0) break;
        const html = await fetchViaProxy(tryUrl);
        if (!html) continue;

        // Extract from script JSON data
        const jsonPatterns = [
          /<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/,
          /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
          /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
          /window\._ROUTER_DATA\s*=\s*({[\s\S]*?})\s*<\/script>/,
        ];

        for (const pat of jsonPatterns) {
          const m = html.match(pat);
          if (!m) continue;
          try {
            const data = JSON.parse(m[1]);
            images.push(...deepFindImages(data));
          } catch {}
        }

        // Regex fallback on raw HTML
        if (images.length === 0) {
          const imgPatterns = [
            /https?:\/\/p\d+-sign-[^"'\s\\]+\.tiktokcdn\.com\/[^"'\s\\]+/g,
            /https?:\/\/[^"'\s\\]*tiktokcdn\.com\/[^"'\s\\]+\.(jpg|jpeg|png|webp|avif)/gi,
            /https?:\/\/[^"'\s\\]*byteimg\.com\/[^"'\s\\]+/gi,
          ];
          for (const pat of imgPatterns) {
            const found = html.match(pat);
            if (found) images.push(...found);
          }
        }

        // og:image
        if (images.length === 0) {
          const ogMatch = html.match(/property="og:image"[^>]*content="([^"]+)"/i)
            || html.match(/content="([^"]+)"[^>]*property="og:image"/i);
          if (ogMatch && ogMatch[1].includes('http')) images.push(ogMatch[1]);
        }
      }
    }

    // 3) If we got video thumbnail from oEmbed, try to find product images from the page
    // For TikTok Shop product pages specifically
    if (images.length > 0 && /\/product\//.test(url)) {
      // Try to find more images from the product page via proxy
      const html = await fetchViaProxy(url);
      if (html) {
        const allImgUrls = html.match(/https?:\/\/[^"'\s\\]+\.(jpg|jpeg|png|webp|avif)/gi) || [];
        for (const img of allImgUrls) {
          if ((img.includes('tiktokcdn') || img.includes('byteimg') || img.includes('bytedance'))
              && !img.includes('icon') && !img.includes('logo') && !img.includes('avatar')) {
            images.push(img);
          }
        }
      }
    }

    // Deduplicate & clean
    images = [...new Set(images)].filter(img => {
      const l = img.toLowerCase();
      return !l.includes('/icon') && !l.includes('/logo') && !l.includes('/avatar') && !l.includes('/emoji') && !l.includes('favicon');
    });

    if (images.length === 0) {
      return NextResponse.json({
        erro: 'Nao foi possivel buscar as imagens. O TikTok bloqueia acesso automatizado. Tente copiar o link novamente ou use outro link.',
      }, { status: 404 });
    }

    return NextResponse.json({ images });
  } catch {
    return NextResponse.json({ erro: 'Erro interno ao processar a requisicao.' }, { status: 500 });
  }
}
