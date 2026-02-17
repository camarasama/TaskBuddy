import type { Metadata, Viewport } from 'next';
import { Inter, Poppins } from 'next/font/google';
import '@/styles/globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  title: 'TaskBuddy - Family Task Management',
  description: 'Help your family manage tasks, earn rewards, and have fun together!',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'TaskBuddy',
  },
  icons: {
    icon: '/icon-192x192.png',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0ea5e9',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable}`}>
      <body className="font-sans min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
