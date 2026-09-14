'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Field, Icon, Input, type IconName } from '@/components/ui';
import { SectionHeader } from '../_components/SectionHeader';
import { Dialog } from '../_components/Dialog';
import { Toast } from '../_components/Toast';
import { sentenceCase } from '../_components/format';

interface Permission {
  id: string;
  code: string;
  name: string;
  description: string;
  module: string;
}

interface Role {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}

const MODULE_ICON: Record<string, IconName> = {
  AUTH:        'lock',
  EMPLOYEE:    'user',
  LEAVE:       'calendar',
  PAYROLL:     'wallet',
  CLAIMS:      'receipt',
  ATTENDANCE:  'clock',
  RECRUITMENT: 'briefcase',
  ASSET:       'grid',
  OFFBOARDING: 'logout',
  REPORTING:   'chart',
};

export default function RoleManagementPage() {
  const { hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Create custom role modal state
  const [showCreate, setShowCreate] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      const [rolesData, permsData] = await Promise.all([
        apiFetch('/roles'),
        apiFetch('/roles/permissions'),
      ]);
      setRoles(rolesData ?? []);
      setAllPermissions(permsData ?? []);
    } catch { showToast('Failed to load roles', 'error'); }
    finally { setLoading(false); }
  };

  const handleUpdatePermissions = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await apiFetch(`/roles/${selectedRole.id}`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: selectedRole.permissions }),
      });
      await fetchAll();
      setIsEditing(false);
      showToast(`${selectedRole.name.replace(/_/g, ' ')} permissions updated`);
    } catch (e: any) {
      showToast(e.message || 'Failed to update permissions', 'error');
    } finally { setSaving(false); }
  };

  const handleCreateRole = async () => {
    const name = newRoleName.trim().toUpperCase().replace(/\s+/g, '_');
    if (!name) return;
    setCreating(true);
    try {
      const created = await apiFetch('/roles', {
        method: 'POST',
        body: JSON.stringify({ name, description: newRoleDesc.trim(), permissions: [] }),
      });
      await fetchAll();
      setShowCreate(false);
      setNewRoleName('');
      setNewRoleDesc('');
      showToast(`Role "${name}" created`);
      setSelectedRole({ ...created, permissions: [] });
      setIsEditing(true);
    } catch (e: any) {
      showToast(e.message || 'Failed to create role', 'error');
    } finally { setCreating(false); }
  };

  const handleDeleteRole = async (role: Role) => {
    if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/roles/${role.id}`, { method: 'DELETE' });
      await fetchAll();
      if (selectedRole?.id === role.id) setSelectedRole(null);
      showToast(`Role "${role.name}" deleted`);
    } catch (e: any) {
      showToast(e.message || 'Failed to delete role', 'error');
    }
  };

  const modules = Array.from(new Set(allPermissions.map(p => p.module)));

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-4 p-24">
      <div className="h-10 w-10 border-4 border-accent border-t-transparent animate-spin rounded-full" />
      <p className="text-sm text-muted">Loading roles and permissions…</p>
    </div>
  );

  if (!hasPermission('role:manage')) return (
    <Card padding="p-0">
      <EmptyState
        icon="lock"
        title="You don't have access to roles"
        description="Role management is restricted to administrators with the role:manage permission."
      />
    </Card>
  );

  const closeCreate = () => { setShowCreate(false); setNewRoleName(''); setNewRoleDesc(''); };

  return (
    <>
      <Toast toast={toast} />

      {/* Create role */}
      {showCreate && (
        <Dialog
          title="New role"
          caption="Name it now; grant permissions right after it is created."
          onClose={closeCreate}
          footer={
            <>
              <Button variant="secondary" onClick={closeCreate}>Cancel</Button>
              <Button onClick={handleCreateRole} disabled={!newRoleName.trim() || creating}>
                {creating ? 'Creating…' : 'Create role'}
              </Button>
            </>
          }
        >
          <Field
            label="Role name"
            required
            help={!newRoleName.trim() ? 'A name is required. Spaces become underscores.' : 'Spaces become underscores.'}
          >
            <Input
              type="text"
              value={newRoleName}
              onChange={e => setNewRoleName(e.target.value)}
              placeholder="e.g. Finance manager"
              className="uppercase placeholder:normal-case"
              onKeyDown={e => e.key === 'Enter' && handleCreateRole()}
              autoFocus
            />
          </Field>
          <Field label="Description">
            <Input
              type="text"
              value={newRoleDesc}
              onChange={e => setNewRoleDesc(e.target.value)}
              placeholder="What this role is responsible for"
            />
          </Field>
        </Dialog>
      )}

      <SectionHeader
        title="Roles and permissions"
        description={<><span className="tabular-nums">{roles.length}</span> roles · <span className="tabular-nums">{allPermissions.length}</span> permissions</>}
        actions={<Button icon="plus" onClick={() => setShowCreate(true)}>New role</Button>}
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">

        {/* Role list — hidden while editing so the permission grid gets full width */}
        <div className={`flex-col gap-2.5 lg:col-span-4 ${isEditing ? 'hidden' : 'flex'}`}>
          {roles.length === 0 && (
            <Card padding="p-0">
              <EmptyState icon="shield" title="No roles yet" description="Create one with New role." />
            </Card>
          )}
          {roles.map(role => {
            const active = selectedRole?.id === role.id;
            const pct = allPermissions.length > 0 ? (role.permissions.length / allPermissions.length) * 100 : 0;
            const select = () => { setSelectedRole(role); setIsEditing(false); };
            return (
              <div
                key={role.id}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                onClick={select}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } }}
                className={`flex cursor-pointer flex-col gap-2.5 rounded-card border p-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  active ? 'border-accent bg-tint' : 'border-rule bg-paper hover:border-accent'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className={`truncate text-sm font-bold ${active ? 'text-accent' : 'text-ink'}`}>{sentenceCase(role.name)}</span>
                    {role.isSystem && <Badge className="w-fit">System role</Badge>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!role.isSystem && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); handleDeleteRole(role); }}
                        aria-label={`Delete role ${sentenceCase(role.name)}`}
                        className="rounded-control px-2 py-1 text-[13px] font-semibold text-danger hover:bg-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        Delete
                      </button>
                    )}
                    <span className="text-xs font-semibold text-muted tabular-nums" aria-label={`${role.permissions.length} permissions`}>
                      {role.permissions.length}
                    </span>
                  </div>
                </div>
                {role.description && <p className="line-clamp-2 text-[13px] text-muted">{role.description}</p>}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-pill" aria-hidden="true">
                  <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Permission panel — full width when editing, otherwise beside the role list */}
        <Card padding="p-0" className={`overflow-hidden ${isEditing ? 'lg:col-span-12' : 'lg:col-span-8'}`}>
          {selectedRole ? (
            <div className="flex flex-col">
              {/* Panel header */}
              <div className="flex flex-col items-start justify-between gap-4 border-b border-rule px-5 py-4 sm:flex-row sm:items-center lg:px-6">
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-[15.5px] font-bold text-ink">{sentenceCase(selectedRole.name)}</h3>
                  <p className="text-[13px] text-muted">
                    <span className="tabular-nums">{selectedRole.permissions.length}</span> of <span className="tabular-nums">{allPermissions.length}</span> permissions granted
                  </p>
                </div>
                {!isEditing ? (
                  <Button onClick={() => setIsEditing(true)}>Edit permissions</Button>
                ) : (
                  <div className="flex gap-2.5">
                    <Button variant="secondary" onClick={() => { setIsEditing(false); fetchAll().then(() => {}); }}>
                      Cancel
                    </Button>
                    <Button onClick={handleUpdatePermissions} disabled={saving}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Module grid */}
              <div className="flex max-h-[70vh] flex-col gap-7 overflow-y-auto p-5 lg:p-6">
                {modules.map(module => {
                  const modulePerms = allPermissions.filter(p => p.module === module);
                  const grantedCount = modulePerms.filter(p => selectedRole.permissions.includes(p.code)).length;
                  const allGrantedNow = modulePerms.every(p => selectedRole.permissions.includes(p.code));
                  return (
                    <section key={module} aria-label={sentenceCase(module)}>
                      <div className="mb-3 flex items-center gap-3">
                        <div className="flex items-center gap-2 text-sm font-bold text-ink">
                          <span className="flex h-7 w-7 items-center justify-center rounded-control bg-tint text-accent">
                            <Icon name={MODULE_ICON[module] ?? 'settings'} size={15} />
                          </span>
                          {sentenceCase(module)}
                        </div>
                        <span className="text-xs text-muted tabular-nums">{grantedCount} of {modulePerms.length}</span>
                        <div className="h-px flex-1 bg-rule" />
                        {isEditing && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const allGranted = modulePerms.every(p => selectedRole.permissions.includes(p.code));
                              const moduleCodes = modulePerms.map(p => p.code);
                              const newPerms = allGranted
                                ? selectedRole.permissions.filter(c => !moduleCodes.includes(c))
                                : [...new Set([...selectedRole.permissions, ...moduleCodes])];
                              setSelectedRole({ ...selectedRole, permissions: newPerms });
                            }}
                          >
                            {allGrantedNow ? 'Remove all' : 'Grant all'}
                          </Button>
                        )}
                      </div>
                      <div className={`grid grid-cols-1 gap-2.5 md:grid-cols-2 ${isEditing ? 'xl:grid-cols-3' : ''}`}>
                        {modulePerms.map(p => {
                          const isGranted = selectedRole.permissions.includes(p.code);
                          return (
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={isGranted}
                              aria-disabled={!isEditing}
                              key={p.code}
                              onClick={() => {
                                if (!isEditing) return;
                                const newPerms = isGranted
                                  ? selectedRole.permissions.filter(c => c !== p.code)
                                  : [...selectedRole.permissions, p.code];
                                setSelectedRole({ ...selectedRole, permissions: newPerms });
                              }}
                              className={`flex items-start justify-between gap-3 rounded-control border p-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                                isGranted ? 'border-accent bg-tint' : 'border-rule bg-paper'
                              } ${isEditing ? 'cursor-pointer hover:border-accent' : 'cursor-default'}`}
                            >
                              <div className="flex min-w-0 flex-col gap-1">
                                <span className={`text-[13.5px] font-semibold ${isGranted ? 'text-accent' : 'text-ink'}`}>{p.name}</span>
                                {p.description && <span className="line-clamp-2 text-[12.5px] text-muted">{p.description}</span>}
                                <code className="font-mono text-xs text-faint">{p.code}</code>
                              </div>
                              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                                isGranted ? 'border-accent bg-accent text-paper' : 'border-rule bg-paper'
                              }`}>
                                {isGranted && <Icon name="check" size={13} strokeWidth={3} />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
                {modules.length === 0 && (
                  <EmptyState icon="shield" title="No permissions defined" description="The permission catalogue came back empty." />
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              icon="shield"
              title="Select a role"
              description="Choose a role to see its permissions and edit them."
              className="min-h-[360px]"
            />
          )}
        </Card>
      </div>
    </>
  );
}
