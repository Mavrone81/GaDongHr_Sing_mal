import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';

// Operator console = Direction C (dark). The wrapper's data-theme flips every CSS
// token, so the shared UI kit renders dark without any page-level colour.
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-plex-mono' });

export const metadata = { title: 'GaDongHR platform' };

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark" className={`platform-console min-h-screen bg-page text-ink ${plexSans.variable} ${plexMono.variable}`}>
      {children}
    </div>
  );
}
