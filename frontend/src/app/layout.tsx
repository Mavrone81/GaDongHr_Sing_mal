import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Vorkhive - SG Compliant HRMS',
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
        {/* Suppress browser extension errors (e.g. MetaMask) before Next.js error overlay registers */}
        <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var _oe = window.onerror;
  window.onerror = function(msg, src, line, col, err) {
    if (src && (src.indexOf('chrome-extension://') === 0 || src.indexOf('moz-extension://') === 0)) return true;
    if (typeof msg === 'string' && msg.indexOf('MetaMask') !== -1) return true;
    return _oe ? _oe.apply(this, arguments) : false;
  };
  window.addEventListener('unhandledrejection', function(e) {
    var msg = (e.reason && (e.reason.message || String(e.reason))) || '';
    if (msg.indexOf('MetaMask') !== -1 || msg.indexOf('chrome-extension') !== -1) {
      e.stopImmediatePropagation(); e.preventDefault();
    }
  }, true);
})();
        `}} />
      </head>
      <body className={inter.className}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
