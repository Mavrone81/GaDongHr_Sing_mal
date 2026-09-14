import { Manrope } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import { ToastProvider } from '@/components/ui/Toast'

// 2026-09 redesign: Manrope replaces Inter. The CSS variable feeds --font-sans
// in globals.css and the Tailwind `font-sans` family.
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-manrope',
})

export const metadata = {
  title: 'GaDongHR - SG Compliant HRMS',
  description: 'Singapore Payroll, CPF, and Leave Management',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* Suppress browser-extension errors (MetaMask, wallet/content-script messaging, etc.)
            before Next.js error overlay registers. These come from the user's extensions,
            not the app. */}
        <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var EXT = ['MetaMask','chrome-extension','moz-extension','No Listener','tabs:outgoing',
    'Extension context invalidated','Could not establish connection',
    'Receiving end does not exist','message channel closed','message port closed'];
  function isExt(msg, src){
    if (src && (src.indexOf('chrome-extension://') === 0 || src.indexOf('moz-extension://') === 0)) return true;
    if (typeof msg !== 'string') return false;
    for (var i=0;i<EXT.length;i++){ if (msg.indexOf(EXT[i]) !== -1) return true; }
    return false;
  }
  var _oe = window.onerror;
  window.onerror = function(msg, src, line, col, err) {
    if (isExt(typeof msg === 'string' ? msg : '', src)) return true;
    return _oe ? _oe.apply(this, arguments) : false;
  };
  window.addEventListener('unhandledrejection', function(e) {
    var msg = (e.reason && (e.reason.message || String(e.reason))) || '';
    if (isExt(msg)) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
})();
        `}} />
      </head>
      <body className={`${manrope.variable} font-sans`}>
        <ToastProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  )
}
