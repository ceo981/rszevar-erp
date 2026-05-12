import './globals.css';
import AppShell from '../components/AppShell';
import { ThemeProvider } from './context/ThemeContext';

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
//
// NOTE: themeColor is dark by default; ThemeContext updates the meta tag dynamically
// when user toggles to light mode.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#080c16',
  viewportFit: 'cover', // iPhone notch ke niche tak background extend kar do
};

// ════════════════════════════════════════════════════════════════════════════
// No-flash theme script — runs synchronously before <body> content paints
// ────────────────────────────────────────────────────────────────────────────
// Bina iske, agar user ne light mode save kiya hua hai, to page pehle dark
// flash karega phir React load hoke light mode lagega — ugly experience.
//
// Ye script <body> ka pehla element hai. Browsers HTML ko top-to-bottom parse
// karte hain, aur inline scripts synchronously execute hote hain — to ye script
// kisi bhi visible content se pehle chal jaata hai aur <html> par data-theme
// attribute set kar deta hai. CSS variables phir us ke hisab se resolve hote hain.
//
// IMPORTANT: Next.js 16 + Turbopack ke saath, root layout mein <head> use
// karne se prerender errors aate hain. Is liye script <body> ke andar rakha
// hai (Next.js recommended pattern).
// ════════════════════════════════════════════════════════════════════════════
const noFlashScript = `
(function() {
  try {
    var t = localStorage.getItem('rszevar-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* No-flash script — must be first body child, runs before paint */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
