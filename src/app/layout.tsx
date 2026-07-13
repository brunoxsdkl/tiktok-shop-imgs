import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TikTok Shop Imagens - Baixar Imagens de Produtos',
  description: 'Baixe todas as imagens de qualquer produto do TikTok Shop de forma rapida e facil.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
