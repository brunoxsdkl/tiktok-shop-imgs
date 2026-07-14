import { NextRequest, NextResponse } from 'next/server';

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch {
    clearTimeout(timer);
    throw new Error('timeout');
  }
}

async function resolveShortUrl(shortUrl: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(shortUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    }, 8000);

    const location = res.headers.get('location');
    if (location) return location;

    // Some redirects are in the body via meta refresh or JS
    if (res.status >= 300 && res.status < 400) {
      const body = await res.text();
      const metaRefresh = body.match(/url=([^"'\s>]+)/i);
      if (metaRefresh) return metaRefresh[1];
    }
  } catch {}

  // Fallback: follow redirects fully
  try {
    const res = await fetchWithTimeout(shortUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    }, 10000);
    return res.url;
  } catch {}

  return shortUrl;
}

function extractOgInfo(resolvedUrl: string): { images: string[]; title: string } {
  const images: string[] = [];
  let title = '';

  // Extract og_info from URL query params
  try {
    const urlObj = new URL(resolvedUrl);
    const ogInfoRaw = urlObj.searchParams.get('og_info');
    if (ogInfoRaw) {
      const parsed = JSON.parse(ogInfoRaw);
      if (parsed.image) {
        // Unescape the URL
        let imgUrl = parsed.image.replace(/\\\//g, '/');
        images.push(imgUrl);
      }
      if (parsed.title) {
        title = decodeURIComponent(parsed.title.replace(/\+/g, ' '));
      }
    }
  } catch {}

  return { images, title };
}

async function tryFetchProductPage(productUrl: string): Promise<string[]> {
  const images: string[] = [];

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(productUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(productUrl)}`,
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await fetchWithTimeout(proxyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }, 12000);

      if (!res.ok) continue;
      const html = await res.text();
      if (html.length < 500 || html.includes('Security Check') || html.includes('captcha')) continue;

      // Extract from JSON scripts
      const jsonPatterns = [
        /<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/,
        /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
      ];

      for (const pat of jsonPatterns) {
        const m = html.match(pat);
        if (!m) continue;
        try {
          const data = JSON.parse(m[1]);
          const jsonStr = JSON.stringify(data);
          const imgUrls = jsonStr.match(/https?:\/\/[^"'\s\\]+(?:tiktokcdn|byteimg|ibyteimg)[^"'\s\\]+\.(?:jpg|jpeg|png|webp|avif)/gi);
          if (imgUrls) images.push(...imgUrls);
        } catch {}
      }

      // og:image fallback
      if (images.length === 0) {
        const ogMatch = html.match(/content="(https?:\/\/[^"]*(?:tiktok|tiktokcdn|ibyteimg|byteimg)[^"]*)"[^>]*property="og:image"/i);
        if (ogMatch) images.push(ogMatch[1]);
      }

      if (images.length > 0) break;
    } catch {}
  }

  return images;
}

async function tryOembed(videoId: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(
      `https://www.tiktok.com/oembed?url=https://www.tiktok.com/video/${videoId}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
      5000
    );
    if (res.ok) {
      const data = await res.json();
      if (data.thumbnail_url) return [data.thumbnail_url];
    }
  } catch {}
  return [];
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
    let title = '';

    // Step 1: Resolve short URL
    let resolvedUrl = url;
    if (url.includes('vt.tiktok.com') || url.includes('vm.tiktok.com')) {
      resolvedUrl = await resolveShortUrl(url);
    }

    // Step 2: Extract og_info from resolved URL (works without CAPTCHA!)
    const ogData = extractOgInfo(resolvedUrl);
    images.push(...ogData.images);
    title = ogData.title;

    // Step 3: Extract product ID and try more sources
    const productIdMatch = resolvedUrl.match(/\/view\/product\/(\d+)/) || resolvedUrl.match(/\/product\/(\d+)/);
    const videoMatch = resolvedUrl.match(/\/video\/(\d+)/);
    const uniqueIdMatch = resolvedUrl.match(/unique_id=([^&]+)/);

    // Try oEmbed for video links
    if (videoMatch && images.length === 0) {
      const oembedImgs = await tryOembed(videoMatch[1]);
      images.push(...oembedImgs);
    }

    // Try fetching product page via proxy
    if (productIdMatch) {
      const shopUrl = `https://www.tiktok.com/view/product/${productIdMatch[1]}`;
      const pageImages = await tryFetchProductPage(shopUrl);
      images.push(...pageImages);

      // Also try with username if we have it
      if (uniqueIdMatch) {
        const altUrl = `https://www.tiktok.com/@${uniqueIdMatch[1]}/product/${productIdMatch[1]}`;
        const altImages = await tryFetchProductPage(altUrl);
        images.push(...altImages);
      }
    }

    // Try fetching the original URL via proxy
    if (images.length <= 1) {
      const pageImages = await tryFetchProductPage(url);
      images.push(...pageImages);
    }

    // Deduplicate and clean
    images = [...new Set(images)].filter(img => {
      if (!img.startsWith('http')) return false;
      const l = img.toLowerCase();
      return !l.includes('/icon') && !l.includes('/logo') && !l.includes('/avatar') && !l.includes('favicon');
    });

    if (images.length === 0) {
      return NextResponse.json({
        erro: 'Nao foi possivel buscar as imagens. O TikTok bloqueia acesso automatizado. Tente copiar o link novamente.',
      }, { status: 404 });
    }

    return NextResponse.json({ images, title });
  } catch {
    return NextResponse.json({ erro: 'Erro interno ao processar a requisicao.' }, { status: 500 });
  }
}
