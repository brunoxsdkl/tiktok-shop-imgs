'use client';

import { useState, useCallback } from 'react';

interface FetchResult {
  images: string[];
  title?: string;
  erro?: string;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadingAll, setDownloadingAll] = useState(false);

  const isValidTiktokUrl = (link: string) => {
    return /(tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/.test(link);
  };

  const buscarImagens = useCallback(async () => {
    if (!url.trim()) {
      setError('Cole um link do TikTok primeiro.');
      return;
    }

    if (!isValidTiktokUrl(url)) {
      setError('Link invalido. Cole um link de produto ou video do TikTok.');
      return;
    }

    setLoading(true);
    setError('');
    setImages([]);

    try {
      const res = await fetch('/api/fetch-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data: FetchResult = await res.json();

      if (!res.ok || data.erro) {
        setError(data.erro || 'Erro ao buscar imagens.');
        return;
      }

      setImages(data.images);
      setTitle(data.title || '');
    } catch {
      setError('Erro de conexao. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [url]);

  const baixarImagem = async (src: string, index: number) => {
    try {
      const proxyUrl = `/api/proxy-image?src=${encodeURIComponent(src)}`;
      const res = await fetch(proxyUrl);
      const blob = await res.blob();
      const urlBlob = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = urlBlob;
      a.download = `tiktok-img-${index + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(urlBlob);
    } catch {
      window.open(src, '_blank');
    }
  };

  const baixarTodas = async () => {
    if (images.length === 0) return;
    setDownloadingAll(true);

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder('tiktok-imagens')!;

      const promises = images.map(async (src, i) => {
        try {
          const proxyUrl = `/api/proxy-image?src=${encodeURIComponent(src)}`;
          const res = await fetch(proxyUrl);
          const blob = await res.blob();
          folder.file(`tiktok-img-${i + 1}.jpg`, blob);
        } catch {
          // Skip failed images
        }
      });

      await Promise.all(promises);

      if (Object.keys(folder.files).length === 0) {
        setError('Nao foi possivel baixar as imagens.');
        return;
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const urlBlob = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = urlBlob;
      a.download = 'tiktok-imagens.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(urlBlob);
    } catch {
      setError('Erro ao criar o arquivo ZIP.');
    } finally {
      setDownloadingAll(false);
    }
  };

  const limpar = () => {
    setUrl('');
    setImages([]);
    setTitle('');
    setError('');
  };

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-8 md:py-16">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-5xl font-bold bg-gradient-to-r from-cyan-400 via-pink-500 to-red-500 bg-clip-text text-transparent mb-3">
            TikTok Shop Imagens
          </h1>
          <p className="text-gray-400 text-sm md:text-base">
            Cole o link de um produto ou video e baixe todas as imagens
          </p>
        </div>

        {/* Input Area */}
        <div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl p-6 mb-8">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.tiktok.com/@usuario/video/... ou https://shop.tiktok.com/..."
              className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition text-sm"
              onKeyDown={(e) => e.key === 'Enter' && buscarImagens()}
            />
            <button
              onClick={buscarImagens}
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-pink-500 hover:from-cyan-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl transition transform hover:scale-[1.02] active:scale-[0.98] text-sm whitespace-nowrap"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Buscando...
                </span>
              ) : 'Buscar imagens'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-start gap-2">
              <span className="mt-0.5">!</span>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Results */}
        {images.length > 0 && (
          <div>
            {/* Actions */}
            <div className="flex items-center justify-between mb-4">
              <div>
                {title && <p className="text-white text-sm font-medium mb-1">{title}</p>}
                <p className="text-gray-400 text-sm">
                {images.length} imagem{images.length !== 1 ? 'ns' : ''} encontrada{images.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={baixarTodas}
                  disabled={downloadingAll}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                >
                  {downloadingAll ? 'Baixando...' : 'Baixar todas (ZIP)'}
                </button>
                <button
                  onClick={limpar}
                  className="bg-white/10 hover:bg-white/20 text-white text-sm px-4 py-2 rounded-lg transition"
                >
                  Limpar
                </button>
              </div>
            </div>

            {/* Gallery Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {images.map((src, i) => (
                <div
                  key={i}
                  className="group relative bg-white/5 border border-white/10 rounded-xl overflow-hidden aspect-square"
                >
                  <img
                    src={`/api/proxy-image?src=${encodeURIComponent(src)}`}
                    alt={`Imagem ${i + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={() => baixarImagem(src, i)}
                      className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-2 rounded-lg backdrop-blur transition"
                    >
                      Baixar
                    </button>
                    <a
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-2 rounded-lg backdrop-blur transition"
                    >
                      Abrir
                    </a>
                  </div>
                  <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur">
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-12 text-gray-600 text-xs">
          <p>Esta ferramenta busca imagens publicas do TikTok.</p>
          <p className="mt-1">Nao armazena nem redistribui conteudo.</p>
        </div>
      </div>
    </main>
  );
}
