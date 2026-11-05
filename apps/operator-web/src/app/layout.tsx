import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = { title: 'Park2All Operator', description: 'Smart parking operations console' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@600;700&display=swap" />
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('p2a.theme');if(t)document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
