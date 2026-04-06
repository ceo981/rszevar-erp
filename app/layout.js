import './globals.css';

export const metadata = {
  title: 'RS ZEVAR ERP',
  description: 'Enterprise Resource Planning for RS ZEVAR',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
