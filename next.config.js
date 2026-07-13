/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'p16-sign-sg.tiktokcdn.com' },
      { protocol: 'https', hostname: 'lf16-tiktok-common.tiktokcdn-us.com' },
      { protocol: 'https', hostname: 'p30-sign-sg.tiktokcdn.com' },
      { protocol: 'https', hostname: 'p9-sign-sg.tiktokcdn.com' },
      { protocol: 'https', hostname: '*.tiktokcdn.com' },
      { protocol: 'https', hostname: '*.tiktok.com' },
    ],
  },
};

module.exports = nextConfig;
