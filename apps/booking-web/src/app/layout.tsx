import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { Header } from '@/components/header';
import { AuthProvider } from '@/components/auth';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Park2All — Book parking near you', template: '%s · Park2All' },
  description: 'Find live parking availability, compare prices and reserve a spot at malls, airports, stations and offices.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@600;700&display=swap" />
      </head>
      <body>
        <AuthProvider>
          <Header />
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">{children}</main>
          <footer className="border-t border-border py-8 text-center text-sm text-muted">© Park2All · Smart Mobility &amp; Parking</footer>
          <Toaster richColors position="top-center" />
        </AuthProvider>
      </body>
    </html>
  );
}
