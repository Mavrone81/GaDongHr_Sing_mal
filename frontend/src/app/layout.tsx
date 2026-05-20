import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import ExtensionErrorFilter from '@/components/ExtensionErrorFilter'

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
      <body className={inter.className}>
        <ExtensionErrorFilter />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
