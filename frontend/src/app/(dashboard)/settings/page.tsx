'use client';

import Link from 'next/link';

export default function SettingsPage() {
  const sections = [
    {
      title: 'Identity & Access',
      desc: 'Manage system users, roles, and permission matrices.',
      icon: '◪',
      links: [
        { label: 'User Management', href: '/settings/users', badge: 'Identity Provisioning' },
        { label: 'Role & Permissions', href: '/settings/roles', badge: 'RBAC Matrix' },
      ]
    },
    {
      title: 'Statutory Configuration',
      desc: 'CPF, SDL, FWL rate tables and compliance settings.',
      icon: '◎',
      links: [
        { label: 'CPF Rate Tables', href: '/settings/cpf', badge: 'SA Only' },
        { label: 'SDL / FWL Config', href: '/settings/sdl', badge: 'SA Only' },
        { label: 'PDPA Data Retention', href: '/settings/pdpa', badge: 'SA Only' },
      ]
    },
    {
      title: 'System & Integrations',
      desc: 'SSO, MFA, API keys, webhook endpoints and audit logs.',
      icon: '◇',
      links: [
        { label: 'SSO / MFA Config', href: '/settings/sso', badge: 'IT Admin' },
        { label: 'API Keys & Webhooks', href: '/settings/api', badge: 'IT Admin' },
        { label: 'Audit Log', href: '/settings/audit', badge: 'Read-Only' },
      ]
    },
    {
      title: 'Organisation',
      desc: 'Departments, cost centres, and public holiday calendar.',
      icon: '▣',
      links: [
        { label: 'Departments & Cost Centres', href: '/settings/departments', badge: '' },
        { label: 'Public Holiday Calendar', href: '/settings/holidays', badge: '' },
        { label: 'Company Profile', href: '/settings/company', badge: '' },
      ]
    },
  ];

  return (
    <div className="flex flex-col gap-10 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">
      
      {/* Header */}
      <div className="flex flex-col gap-2 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-40 h-40 bg-indigo-600/5 rounded-full blur-3xl"></div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-2 h-2 bg-indigo-600 rounded-full"></div>
          <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.4em]">System Administration</span>
        </div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tighter">System <span className="text-indigo-600">Configuration</span></h1>
        <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest max-w-xl">
          Sovereign governance controls, statutory rate management, and enterprise security configuration.
        </p>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {sections.map((section) => (
          <div key={section.title} className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden group hover:border-indigo-600/20 transition-all">
            <div className="p-8 border-b border-slate-50">
              <div className="flex items-center gap-4 mb-3">
                <span className="text-xl text-indigo-600">{section.icon}</span>
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">{section.title}</h2>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{section.desc}</p>
            </div>
            <div className="p-6 space-y-2">
              {section.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-indigo-600/30 hover:bg-indigo-50/30 transition-all group/link"
                >
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest group-hover/link:text-indigo-600 transition-colors">
                    {link.label}
                  </span>
                  <div className="flex items-center gap-3">
                    {link.badge && (
                      <span className="text-[8px] font-black px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full uppercase tracking-widest">{link.badge}</span>
                    )}
                    <svg className="w-3 h-3 text-slate-300 group-hover/link:text-indigo-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path>
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
