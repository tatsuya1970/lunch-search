import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: 'ごはんガチャ',
  description: '現在地周辺の営業中の飲食店をランダムに1件提案するアプリ。価格帯・検索範囲を選んでタップするだけ！',
  openGraph: {
    title: 'ごはんガチャ',
    description: '現在地周辺の営業中の飲食店をランダムに1件提案するアプリ。価格帯・検索範囲を選んでタップするだけ！',
    url: siteUrl,
    siteName: 'ごはんガチャ',
    images: [
      {
        url: '/ogp.png',
        width: 1200,
        height: 630,
        alt: 'ごはんガチャ',
      },
    ],
    locale: 'ja_JP',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ごはんガチャ',
    description: '現在地周辺の営業中の飲食店をランダムに1件提案するアプリ。',
    images: ['/ogp.png'],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9626616142283740"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
