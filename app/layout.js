import './globals.css';
import AppShell from '../components/AppShell';

export const metadata = {
  title: 'RS ZEVAR ERP',
  description: 'Enterprise Resource Planning for RS ZEVAR',
  // PWA-ish hints — browser ko bata dete hain ke ye ek app-like experience hai
  applicationName: 'RS ZEVAR ERP',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'RS ZEVAR',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/rs_zevar_logo_transparent.png',
    apple: '/rs_zevar_logo_transparent.png',
  },
};

// Viewport + theme color — ye sab se zaroori hai mobile optimization ke liye.
// `width=device-width` mobile browser ko kehta hai "apni asli width use karo"
// (warna ye 980px desktop width assume karke poora page zoom out kar deta hai).
// `user-scalable=yes` + `maximumScale=5` — users pinch-zoom kar sakte hain if needed
// (accessibility ke liye zaroori hai).
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#080c16',
  viewportFit: 'cover', // iPhone notch ke niche tak background extend kar do
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
