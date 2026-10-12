import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FFC Tracker',
  description: 'Fresh Fit Consulting internal patient tracker',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'FFC Tracker', statusBarStyle: 'default' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#2f5d62' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
