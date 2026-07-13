import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ erro: 'URL nao fornecida.' }, { status: 400 });
    }

    const tiktokMatch = url.match(/tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/);
    if (!tiktokMatch) {
      return NextResponse.json({ erro: 'URL nao parece ser do TikTok.' }, { status: 400 });
    }

    let resolvedUrl = url;

    // Resolve short URLs
    if (url.includes('vt.tiktok.com') || url.includes('vm.tiktok.com')) {
      try {
        const headRes = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          },
        });
        resolvedUrl = headRes.url || url;
      } catch {
        // Could not resolve short URL
      }
    }

    let images: string[] = [];

    // Try to fetch the page HTML
    try {
      const pageRes = await fetch(resolvedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.tiktok.com/',
        },
      });

      if (pageRes.ok) {
        const html = await pageRes.text();

        // Method 1: Look for SIGI_STATE or UNIVERSAL_DATA
        const sigiMatch = html.match(/<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
        const universalMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
        const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);

        const jsonSources = [sigiMatch, universalMatch, nextDataMatch].filter(Boolean);

        for (const match of jsonSources) {
          if (!match) continue;
          try {
            const data = JSON.parse(match[1]);
            const jsonStr = JSON.stringify(data);

            // Extract image URLs from TikTok CDN patterns
            const imgPatterns = [
              /https?:\/\/p\d+-sign-[^"'\s]+\.tiktokcdn\.com\/[^"'\s]+/g,
              /https?:\/\/[^"'\s]*tiktokcdn\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi,
              /https?:\/\/[^"'\s]*\.tiktok\.com\/obj\/[^"'\s]+/g,
            ];

            for (const pattern of imgPatterns) {
              const found = jsonStr.match(pattern);
              if (found) {
                images.push(...found);
              }
            }

            // Also look for image URLs in nested structures
            const findImages = (obj: any, depth = 0): void => {
              if (depth > 8 || !obj) return;
              if (typeof obj === 'string') {
                if (obj.match(/\.(jpg|jpeg|png|webp)/i) && obj.includes('tiktok')) {
                  images.push(obj);
                }
              } else if (Array.isArray(obj)) {
                obj.forEach(item => findImages(item, depth + 1));
              } else if (typeof obj === 'object') {
                Object.values(obj).forEach(val => findImages(val, depth + 1));
              }
            };

            findImages(data);
          } catch {
            // JSON parse failed
          }
        }

        // Method 2: Regex for image URLs in HTML
        if (images.length === 0) {
          const imgRegex = /https?:\/\/[^"'\s]*tiktokcdn\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi;
          const found = html.match(imgRegex);
          if (found) {
            images.push(...found);
          }
        }

        // Method 3: Look for og:image meta tags
        if (images.length === 0) {
          const ogImages = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/gi);
          if (ogImages) {
            for (const tag of ogImages) {
              const contentMatch = tag.match(/content="([^"]+)"/);
              if (contentMatch) {
                images.push(contentMatch[1]);
              }
            }
          }
        }

        // Method 4: Look for any product images in img tags
        if (images.length === 0) {
          const imgTags = html.match(/<img[^>]*src="([^"]*tiktok[^"]*)"/gi);
          if (imgTags) {
            for (const tag of imgTags) {
              const srcMatch = tag.match(/src="([^"]+)"/);
              if (srcMatch && srcMatch[1].match(/\.(jpg|jpeg|png|webp)/i)) {
                images.push(srcMatch[1]);
              }
            }
          }
        }
      }
    } catch {
      // Page fetch failed
    }

    // Deduplicate
    images = [...new Set(images)];

    // Filter out tiny images (icons, logos, etc.)
    images = images.filter(img => {
      const lower = img.toLowerCase();
      // Skip very small images and icons
      if (lower.includes('icon') || lower.includes('logo') || lower.includes('avatar')) return false;
      return true;
    });

    if (images.length === 0) {
      return NextResponse.json({
        erro: 'Nao foi possivel buscar as imagens. O link pode ser invalido, o produto pode estar indisponivel, ou o TikTok pode estar bloqueando o acesso automatico.',
      }, { status: 404 });
    }

    return NextResponse.json({ images });
  } catch {
    return NextResponse.json({ erro: 'Erro interno ao processar a requisicao.' }, { status: 500 });
  }
}
