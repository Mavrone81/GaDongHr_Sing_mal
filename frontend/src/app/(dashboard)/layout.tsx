'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const handleSignOut = () => {
    document.cookie = 'ezyhrm_token=; Max-Age=0; path=/';
    router.push('/login');
  };

  const navItems = [
    { name: 'Dashboard', path: '/' },
    { name: 'Employees', path: '/employees' },
    { name: 'Payroll', path: '/payroll' },
    { name: 'Leave', path: '/leave' },
    { name: 'Claims', path: '/claims' },
    { name: 'Recruitment', path: '/recruitment' }
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-gray-50">
      <aside className="w-64 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="flex h-14 items-center border-b border-gray-200 px-6 flex-shrink-0">
          <span className="text-lg font-bold text-gray-800">Ezy<span className="text-brand-600">HRM</span></span>
        </div>
        <nav className="p-4 flex flex-col gap-1 overflow-y-auto flex-1">
          {navItems.map((item) => {
            const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
            return (
              <Link 
                key={item.name} 
                href={item.path} 
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive 
                    ? 'bg-brand-50 text-brand-700' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
          <h1 className="text-lg font-semibold text-gray-800">Executive Workforce Dashboard</h1>
          <div className="flex items-center gap-4">
            <span className="h-8 w-8 rounded-full bg-brand-100 border border-brand-200 flex items-center justify-center text-xs font-bold text-brand-700">AD</span>
            <button 
              onClick={handleSignOut}
              className="text-xs font-medium text-gray-500 hover:text-red-600 transition-colors px-3 py-1.5 rounded-md border border-transparent hover:border-red-200 hover:bg-red-50"
            >
              Sign Out
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6 relative">
          {children}
        </div>
      </main>
    </div>
  );
}
