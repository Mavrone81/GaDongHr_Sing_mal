'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';

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

const MODULE_META: Record<string, { icon: string; color: string }> = {
  AUTH:        { icon: '🔐', color: 'text-accent bg-page border-accent' },
  EMPLOYEE:    { icon: '👤', color: 'text-accent bg-page border-accent' },
  LEAVE:       { icon: '🌴', color: 'text-accent bg-page border-accent' },
  PAYROLL:     { icon: '💰', color: 'text-ink bg-page border-highlight' },
  CLAIMS:      { icon: '🧾', color: 'text-ink bg-page border-highlight' },
  ATTENDANCE:  { icon: '🕐', color: 'text-accent bg-page border-accent' },
  RECRUITMENT: { icon: '🎯', color: 'text-ink bg-page border-ink' },
  ASSET:       { icon: '💻', color: 'text-accent bg-page border-accent' },
  OFFBOARDING: { icon: '🚪', color: 'text-ink bg-page border-ink' },
  REPORTING:   { icon: '📊', color: 'text-accent bg-page border-accent' },
};

const ROLE_ICONS: Record<string, string> = {
  SUPER_ADMIN:     '👑',
  IT_ADMIN:        '🖥️',
  HR_ADMIN:        '🏢',
  HR_MANAGER:      '👔',
  PAYROLL_OFFICER: '💳',
  FINANCE_ADMIN:   '📈',
  LINE_MANAGER:    '🧑‍💼',
  RECRUITER:       '🎯',
  EMPLOYEE:        '👤',
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
    <div className="flex flex-col items-center justify-center p-24 animate-pulse">
      <div className="h-12 w-12 border-4 border-accent border-t-transparent animate-spin mb-4 rounded-full" />
      <p className="text-[10px] font-black text-muted uppercase tracking-[0.3em]">Loading permission matrix…</p>
    </div>
  );

  if (!hasPermission('role:manage')) return (
    <div className="p-24 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-page text-ink mb-6 text-3xl">🚫</div>
      <h2 className="text-xl font-black text-ink uppercase tracking-widest">Access Denied</h2>
      <p className="text-xs text-muted mt-4 max-w-sm mx-auto">Role management is restricted to administrators with the role:manage permission.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3.5  text-[11px] font-black uppercase tracking-widest  animate-in slide-in-from-bottom-4 duration-300 ${
          toast.type === 'success' ? 'bg-shadow text-paper' : 'bg-ink text-paper'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Create Role Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-shadow backdrop- flex items-center justify-center p-4">
          <div className="bg-paper w-full max-w-md p-8 flex flex-col gap-5 animate-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-sm font-black text-ink uppercase tracking-widest">Create Custom Role</h3>
              <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1">You can assign permissions after creation.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest">Role Name</label>
              <input
                type="text"
                value={newRoleName}
                onChange={e => setNewRoleName(e.target.value)}
                placeholder="e.g. FINANCE_MANAGER"
                className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent uppercase placeholder:normal-case placeholder:font-normal placeholder:text-muted"
                onKeyDown={e => e.key === 'Enter' && handleCreateRole()}
                autoFocus
              />
              <p className="text-[9px] font-bold text-muted uppercase tracking-widest">Spaces will be replaced with underscores.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest">Description</label>
              <input
                type="text"
                value={newRoleDesc}
                onChange={e => setNewRoleDesc(e.target.value)}
                placeholder="Brief description of responsibilities"
                className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent placeholder:font-normal placeholder:text-muted"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowCreate(false); setNewRoleName(''); setNewRoleDesc(''); }}
                className="flex-1 py-3 text-[10px] font-black text-muted uppercase tracking-widest hover:text-ink transition-colors border border-rule "
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRole}
                disabled={!newRoleName.trim() || creating}
                className="flex-1 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
              >
                {creating ? 'Creating…' : 'Create Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-3xl font-black text-ink uppercase tracking-tighter">Authorization Matrix</h2>
          <p className="text-[11px] font-bold text-muted mt-2 uppercase tracking-[0.2em] flex items-center gap-3">
            {roles.length} roles · {allPermissions.length} permissions
            <span className="w-1.5 h-1.5 bg-accent animate-pulse" />
            RBAC Active
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-shadow hover:bg-accent text-paper px-7 py-3.5 text-[10px] font-black uppercase tracking-[0.2em] transition-all active:scale-95"
        >
          + Custom Role
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* Role sidebar — hidden while editing so the permission grid gets full width */}
        <div className={`lg:col-span-4 flex-col gap-3 ${isEditing ? 'hidden' : 'flex'}`}>
          {roles.map(role => {
            const icon = ROLE_ICONS[role.name] ?? '🔲';
            const active = selectedRole?.id === role.id;
            const pct = allPermissions.length > 0 ? (role.permissions.length / allPermissions.length) * 100 : 0;
            return (
              <div
                key={role.id}
                onClick={() => { setSelectedRole(role); setIsEditing(false); }}
                className={`p-5  border transition-all duration-300 cursor-pointer group ${
                  active ? 'border-accent bg-shadow ' : 'border-rule bg-paper hover:border-accent hover:'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{icon}</span>
                    <div>
                      <p className={`text-[11px] font-black uppercase tracking-widest leading-none ${active ? 'text-paper' : 'text-ink'}`}>
                        {role.name.replace(/_/g, ' ')}
                      </p>
                      {role.isSystem && (
                        <span className={`text-[8px] font-black uppercase tracking-widest ${active ? 'text-muted' : 'text-muted'}`}>System</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!role.isSystem && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteRole(role); }}
                        className={`text-[9px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity ${active ? 'text-ink hover:text-ink' : 'text-ink hover:text-ink'}`}
                      >
                        Delete
                      </button>
                    )}
                    <span className={`text-[9px] font-black px-2 py-0.5  ${active ? 'bg-paper/10 text-accent' : 'bg-page text-muted'}`}>
                      {role.permissions.length}
                    </span>
                  </div>
                </div>
                <p className={`text-[9px] font-bold leading-relaxed line-clamp-2 mb-3 ${active ? 'text-muted' : 'text-muted'}`}>
                  {role.description}
                </p>
                <div className={`h-1 w-full  overflow-hidden ${active ? 'bg-paper/10' : 'bg-page'}`}>
                  <div className="h-full bg-accent transition-all duration-700" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Permission panel — full width when editing, otherwise alongside the role sidebar */}
        <div className={`bg-paper   border border-rule overflow-hidden ${isEditing ? 'lg:col-span-12' : 'lg:col-span-8'}`}>
          {selectedRole ? (
            <div className="flex flex-col">
              {/* Panel header */}
              <div className="px-8 py-6 border-b border-rule bg-page flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="text-sm font-black text-ink uppercase tracking-tight">
                    {ROLE_ICONS[selectedRole.name] ?? '🔲'} {selectedRole.name.replace(/_/g, ' ')}
                  </h3>
                  <p className="text-[10px] font-bold text-muted mt-1 uppercase tracking-widest">
                    {selectedRole.permissions.length} of {allPermissions.length} permissions granted
                  </p>
                </div>
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="bg-accent text-paper px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-accent transition-all active:scale-95"
                  >
                    Edit Permissions
                  </button>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setIsEditing(false); fetchAll().then(() => {}); }}
                      className="eyebrow-tight hover:text-ink transition-colors px-4"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpdatePermissions}
                      disabled={saving}
                      className="bg-shadow text-paper px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-accent transition-all active:scale-95 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                )}
              </div>

              {/* Module grid */}
              <div className="p-8 flex flex-col gap-8 max-h-[70vh] overflow-y-auto">
                {modules.map(module => {
                  const meta = MODULE_META[module] ?? { icon: '⚙️', color: 'text-ink bg-page border-rule' };
                  const modulePerms = allPermissions.filter(p => p.module === module);
                  const grantedCount = modulePerms.filter(p => selectedRole.permissions.includes(p.code)).length;
                  return (
                    <div key={module}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`flex items-center gap-2 px-3 py-1.5  border text-[10px] font-black uppercase tracking-widest ${meta.color}`}>
                          <span>{meta.icon}</span>
                          <span>{module}</span>
                        </div>
                        <span className="text-[9px] font-bold text-muted uppercase tracking-widest">{grantedCount}/{modulePerms.length}</span>
                        <div className="flex-1 h-px bg-page" />
                        {isEditing && (
                          <button
                            onClick={() => {
                              const allGranted = modulePerms.every(p => selectedRole.permissions.includes(p.code));
                              const moduleCodes = modulePerms.map(p => p.code);
                              const newPerms = allGranted
                                ? selectedRole.permissions.filter(c => !moduleCodes.includes(c))
                                : [...new Set([...selectedRole.permissions, ...moduleCodes])];
                              setSelectedRole({ ...selectedRole, permissions: newPerms });
                            }}
                            className="text-[9px] font-black text-accent hover:text-accent uppercase tracking-widest transition-colors"
                          >
                            {modulePerms.every(p => selectedRole.permissions.includes(p.code)) ? 'Remove All' : 'Grant All'}
                          </button>
                        )}
                      </div>
                      <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${isEditing ? 'xl:grid-cols-3' : ''}`}>
                        {modulePerms.map(p => {
                          const isGranted = selectedRole.permissions.includes(p.code);
                          return (
                            <div
                              key={p.code}
                              onClick={() => {
                                if (!isEditing) return;
                                const newPerms = isGranted
                                  ? selectedRole.permissions.filter(c => c !== p.code)
                                  : [...selectedRole.permissions, p.code];
                                setSelectedRole({ ...selectedRole, permissions: newPerms });
                              }}
                              className={`p-4  border transition-all duration-200 relative ${
                                isGranted ? 'border-accent bg-page' : 'border-rule bg-paper'
                              } ${isEditing ? 'cursor-pointer hover:border-accent' : ''}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className={`text-[10px] font-black uppercase tracking-wide ${isGranted ? 'text-accent' : 'text-ink'}`}>
                                    {p.name}
                                  </p>
                                  <p className="text-[9px] font-bold text-muted mt-1 leading-relaxed line-clamp-2">
                                    {p.description}
                                  </p>
                                  <code className="text-[8px] text-muted font-mono mt-1 block">{p.code}</code>
                                </div>
                                <div className={`w-5 h-5  border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                                  isGranted ? 'bg-accent border-accent ' : 'border-rule bg-paper'
                                }`}>
                                  {isGranted && <span className="text-paper text-[9px] font-black">✓</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[500px] p-16 text-center">
              <div className="w-20 h-20 bg-shadow flex items-center justify-center mb-6 text-3xl ">
                🔑
              </div>
              <h3 className="text-lg font-black text-ink uppercase tracking-tight">Select a Role</h3>
              <p className="text-[10px] font-bold text-muted mt-3 max-w-xs uppercase tracking-widest leading-loose">
                Choose a role from the sidebar to view and edit its permission set.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
