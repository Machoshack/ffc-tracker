import type { MetadataRoute } from 'next';

// Lets staff add the tracker to a phone's home screen and open it like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FFC Tracker',
    short_name: 'FFC Tracker',
    description: 'Fresh Fit Consulting internal patient tracker',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f8f9',
    theme_color: '#2f5d62',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
