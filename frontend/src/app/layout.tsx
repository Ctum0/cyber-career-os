import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import StatusBanner from '@/components/StatusBanner';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Cyber Career OS',
  description: 'Structured cybersecurity career development platform',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased selection:bg-cyber-500 selection:text-white">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 lg:ml-60 p-4 sm:p-8 pt-16 lg:pt-8 max-w-6xl w-full overflow-x-hidden">
            <StatusBanner />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
