'use client';

import Link from 'next/link';
import { Badge, Card, CardHeader, Icon } from '@/components/ui';
import { SectionHeader } from './_components/SectionHeader';

export default function SettingsPage() {
  const sections = [
    {
      title: 'Identity and access',
      desc: 'Manage system users, roles, and permission matrices.',
      links: [
        { label: 'User management', href: '/settings/users', badge: 'Identity provisioning' },
        { label: 'Roles and permissions', href: '/settings/roles', badge: 'Permission matrix' },
      ]
    },
    {
      title: 'Statutory configuration',
      desc: 'CPF, SDL, FWL rate tables and compliance settings.',
      links: [
        { label: 'Statutory rate tables', href: '/settings/rates', badge: 'Super Admin only' },
        { label: 'Payroll overrides', href: '/settings/overrides', badge: 'Super Admin only' },
        { label: 'PDPA data retention', href: '/settings/pdpa', badge: 'Super Admin only' },
      ]
    },
    {
      title: 'System and integrations',
      desc: 'SSO, MFA, API keys, webhook endpoints and audit logs.',
      links: [
        { label: 'SSO and MFA', href: '/settings/security', badge: 'IT Admin' },
        { label: 'API keys and webhooks', href: '/settings/api', badge: 'IT Admin' },
        { label: 'Audit log', href: '/settings/audit', badge: 'Read-only' },
      ]
    },
  ];

  return (
    <>
      <SectionHeader
        title="Overview"
        description="Where each part of the workspace is configured. Access is checked again on every page."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title} padding="px-[22px] pt-5 pb-1">
            <CardHeader title={section.title} caption={section.desc} />
            <ul className="flex flex-col">
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="group flex items-center justify-between gap-4 border-t border-rule py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <span className="text-sm font-semibold text-ink group-hover:text-accent">{link.label}</span>
                    <span className="flex items-center gap-3">
                      {link.badge && <Badge>{link.badge}</Badge>}
                      <Icon name="chevronRight" size={16} className="text-faint group-hover:text-accent" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
