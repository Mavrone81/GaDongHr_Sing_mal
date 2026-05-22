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
  AUTH:        { icon: '🔐', color: 'text-violet-700 bg-violet-50 border-violet-100' },
  EMPLOYEE:    { icon: '👤', color: 'text-blue-700 bg-blue-50 border-blue-100' },
  LEAVE:       { icon: '🌴', color: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
  PAYROLL:     { icon: '💰', color: 'text-amber-700 bg-amber-50 border-amber-100' },
  CLAIMS:      { icon: '🧾', color: 'text-orange-700 bg-orange-50 border-orange-100' },
  ATTENDANCE:  { icon: '🕐', color: 'text-sky-700 bg-sky-50 border-sky-100' },
  RECRUITMENT: { icon: '🎯', color: 'text-pink-700 bg-pink-50 border-pink-100' },
  ASSET:       { icon: '💻', color: 'text-teal-700 bg-teal-50 border-teal-100' },
  OFFBOARDING: { icon: '🚪', color: 'text-red-700 bg-red-50 border-red-100' },
  REPORTING:   { icon: '📊', color: 'text-indigo-700 bg-indigo-50 border-indigo-100' },
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
      <div className="h-12 w-12 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin mb-4" />
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Loading permission matrix…</p>
    </div>
  );

  if (!hasPermission('role:manage')) return (
    <div className="p-24 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 text-red-500 mb-6 text-3xl">🚫</div>
      <h2 className="text-xl font-black text-slate-900 uppercase tracking-widest">Access Denied</h2>
      <p className="text-xs text-slate-400 mt-4 max-w-sm mx-auto">Role management is restricted to administrators with the role:manage permission.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-2xl animate-in slide-in-from-bottom-4 duration-300 ${
          toast.type === 'success' ? 'bg-slate-950 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Create Role Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-8 flex flex-col gap-5 animate-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Create Custom Role</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">You can assign permissions after creation.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Role Name</label>
              <input
                type="text"
                value={newRoleName}
                onChange={e => setNewRoleName(e.target.value)}
                placeholder="e.g. FINANCE_MANAGER"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 uppercase placeholder:normal-case placeholder:font-normal placeholder:text-slate-300"
                onKeyDown={e => e.key === 'Enter' && handleCreateRole()}
                autoFocus
              />
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Spaces will be replaced with underscores.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Description</label>
              <input
                type="text"
                value={newRoleDesc}
                onChange={e => setNewRoleDesc(e.target.value)}
                placeholder="Brief description of responsibilities"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 placeholder:font-normal placeholder:text-slate-300"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowCreate(false); setNewRoleName(''); setNewRoleDesc(''); }}
                className="flex-1 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-slate-800 transition-colors border border-slate-200 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRole}
                disabled={!newRoleName.trim() || creating}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95"
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
          <h2 className="text-3xl font-black text-slate-950 uppercase tracking-tighter">Authorization Matrix</h2>
          <p className="text-[11px] font-bold text-slate-400 mt-2 uppercase tracking-[0.2em] flex items-center gap-3">
            {roles.length} roles · {allPermissions.length} permissions
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
            RBAC Active
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-slate-950 hover:bg-indigo-600 text-white px-7 py-3.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-xl active:scale-95"
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
                className={`p-5 rounded-2xl border transition-all duration-300 cursor-pointer group ${
                  active ? 'border-indigo-600 bg-slate-950 shadow-2xl shadow-indigo-500/10' : 'border-slate-100 bg-white hover:border-indigo-200 hover:shadow-sm'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{icon}</span>
                    <div>
                      <p className={`text-[11px] font-black uppercase tracking-widest leading-none ${active ? 'text-white' : 'text-slate-900'}`}>
                        {role.name.replace(/_/g, ' ')}
                      </p>
                      {role.isSystem && (
                        <span className={`text-[8px] font-black uppercase tracking-widest ${active ? 'text-slate-500' : 'text-slate-400'}`}>System</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!role.isSystem && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteRole(role); }}
                        className={`text-[9px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity ${active ? 'text-red-400 hover:text-red-300' : 'text-red-400 hover:text-red-600'}`}
                      >
                        Delete
                      </button>
                    )}
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${active ? 'bg-white/10 text-indigo-300' : 'bg-slate-100 text-slate-500'}`}>
                      {role.permissions.length}
                    </span>
                  </div>
                </div>
                <p className={`text-[9px] font-bold leading-relaxed line-clamp-2 mb-3 ${active ? 'text-slate-400' : 'text-slate-500'}`}>
                  {role.description}
                </p>
                <div className={`h-1 w-full rounded-full overflow-hidden ${active ? 'bg-white/10' : 'bg-slate-100'}`}>
                  <div className="h-full bg-indigo-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Permission panel — full width when editing, otherwise alongside the role sidebar */}
        <div className={`bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden ${isEditing ? 'lg:col-span-12' : 'lg:col-span-8'}`}>
          {selectedRole ? (
            <div className="flex flex-col">
              {/* Panel header */}
              <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="text-sm font-black text-slate-950 uppercase tracking-tight">
                    {ROLE_ICONS[selectedRole.name] ?? '🔲'} {selectedRole.name.replace(/_/g, ' ')}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">
                    {selectedRole.permissions.length} of {allPermissions.length} permissions granted
                  </p>
                </div>
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="bg-indigo-600 text-white px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] hover:bg-indigo-700 transition-all active:scale-95"
                  >
                    Edit Permissions
                  </button>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setIsEditing(false); fetchAll().then(() => {}); }}
                      className="eyebrow-tight hover:text-slate-700 transition-colors px-4"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpdatePermissions}
                      disabled={saving}
                      className="bg-slate-950 text-white px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] hover:bg-indigo-600 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                )}
              </div>

              {/* Module grid */}
              <div className="p-8 flex flex-col gap-8 max-h-[70vh] overflow-y-auto">
                {modules.map(module => {
                  const meta = MODULE_META[module] ?? { icon: '⚙️', color: 'text-slate-700 bg-slate-50 border-slate-100' };
                  const modulePerms = allPermissions.filter(p => p.module === module);
                  const grantedCount = modulePerms.filter(p => selectedRole.permissions.includes(p.code)).length;
                  return (
                    <div key={module}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest ${meta.color}`}>
                          <span>{meta.icon}</span>
                          <span>{module}</span>
                        </div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{grantedCount}/{modulePerms.length}</span>
                        <div className="flex-1 h-px bg-slate-100" />
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
                            className="text-[9px] font-black text-indigo-500 hover:text-indigo-700 uppercase tracking-widest transition-colors"
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
                              className={`p-4 rounded-xl border transition-all duration-200 relative ${
                                isGranted ? 'border-indigo-100 bg-indigo-50/40' : 'border-slate-100 bg-white'
                              } ${isEditing ? 'cursor-pointer hover:border-indigo-300' : ''}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className={`text-[10px] font-black uppercase tracking-wide ${isGranted ? 'text-indigo-700' : 'text-slate-800'}`}>
                                    {p.name}
                                  </p>
                                  <p className="text-[9px] font-bold text-slate-400 mt-1 leading-relaxed line-clamp-2">
                                    {p.description}
                                  </p>
                                  <code className="text-[8px] text-slate-300 font-mono mt-1 block">{p.code}</code>
                                </div>
                                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                                  isGranted ? 'bg-indigo-600 border-indigo-600 shadow-sm shadow-indigo-500/20' : 'border-slate-200 bg-white'
                                }`}>
                                  {isGranted && <span className="text-white text-[9px] font-black">✓</span>}
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
              <div className="w-20 h-20 bg-slate-950 rounded-[1.5rem] flex items-center justify-center mb-6 text-3xl shadow-xl">
                🔑
              </div>
              <h3 className="text-lg font-black text-slate-950 uppercase tracking-tight">Select a Role</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-3 max-w-xs uppercase tracking-widest leading-loose">
                Choose a role from the sidebar to view and edit its permission set.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
