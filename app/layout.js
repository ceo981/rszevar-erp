import './globals.css';
import AppShell from '../components/AppShell';

export const metadata = {
  title: 'RS ZEVAR ERP',
  description: 'Enterprise Resource Planning for RS ZEVAR',
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
