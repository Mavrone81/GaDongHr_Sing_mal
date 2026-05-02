'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

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

export default function RoleManagementPage() {
  const { hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  useEffect(() => {
    fetchRolesAndPermissions();
  }, []);

  const fetchRolesAndPermissions = async () => {
    try {
      const token = document.cookie.split('vorkhive_token=')[1]?.split(';')[0];
      const [rolesRes, permsRes] = await Promise.all([
        fetch(`${apiBaseUrl}/roles`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBaseUrl}/roles/permissions`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (rolesRes.ok && permsRes.ok) {
        setRoles(await rolesRes.json());
        setAllPermissions(await permsRes.json());
      }
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePermissions = async (role: Role, perms: string[]) => {
    try {
      const token = document.cookie.split('vorkhive_token=')[1]?.split(';')[0];
      const res = await fetch(`${apiBaseUrl}/roles/${role.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ permissions: perms })
      });

      if (res.ok) {
        fetchRolesAndPermissions();
        setIsEditing(false);
        setSelectedRole(null);
      }
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-24 animate-pulse">
      <div className="h-12 w-12 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin mb-4"></div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Mapping Permission Matrices...</p>
    </div>
  );

  if (!hasPermission('role:manage')) return (
    <div className="p-24 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 text-red-500 mb-6">🚫</div>
      <h2 className="text-xl font-black text-slate-900 uppercase tracking-widest">Protocol Access Denied</h2>
      <p className="text-xs text-slate-400 mt-4 max-w-sm mx-auto">Access to the global authorization matrix is restricted to Tier-1 system administrators.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-950 uppercase tracking-tighter">Authorization Matrix</h2>
          <p className="text-[11px] font-bold text-slate-400 mt-3 uppercase tracking-[0.2em] flex items-center gap-3">
             Functional Role Allocation
             <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></span>
             RBAC Governance Active
          </p>
        </div>
        <button className="bg-slate-950 hover:bg-indigo-600 text-white px-8 py-3.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-xl active:scale-95">
          + Create Custom Role
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Role Sidebar (3/12) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {roles.map(role => (
            <div 
              key={role.id}
              onClick={() => { setSelectedRole(role); setIsEditing(false); }}
              className={`p-6 rounded-[2rem] border transition-all duration-500 group cursor-pointer ${
                selectedRole?.id === role.id 
                  ? 'border-indigo-600 bg-slate-950 shadow-2xl shadow-indigo-500/10' 
                  : 'border-slate-100 bg-white hover:border-indigo-200'
              }`}
            >
              <div className="flex justify-between items-center mb-4">
                <h4 className={`text-[12px] font-black uppercase tracking-widest ${selectedRole?.id === role.id ? 'text-white' : 'text-slate-900'}`}>
                  {role.name.replace('_', ' ')}
                </h4>
                {role.isSystem && (
                  <span className={`text-[8px] font-black px-2.5 py-1 rounded-full uppercase tracking-tighter ${selectedRole?.id === role.id ? 'bg-white/10 text-white border border-white/20' : 'bg-slate-100 text-slate-400'}`}>
                    SYSTEM
                  </span>
                )}
              </div>
              <p className={`text-[10px] font-bold leading-relaxed line-clamp-2 ${selectedRole?.id === role.id ? 'text-slate-400' : 'text-slate-500'}`}>
                {role.description || 'Global operational capabilities assigned to this identity cohort.'}
              </p>
              <div className="mt-6 flex items-center gap-3">
                <div className={`h-1 flex-1 rounded-full overflow-hidden ${selectedRole?.id === role.id ? 'bg-white/10' : 'bg-slate-50'}`}>
                   <div 
                    className="h-full bg-indigo-500 transition-all duration-1000" 
                    style={{ width: `${(role.permissions.length / allPermissions.length) * 100}%` }}
                   ></div>
                </div>
                <span className={`text-[9px] font-black uppercase tracking-widest ${selectedRole?.id === role.id ? 'text-indigo-400' : 'text-slate-400'}`}>
                  {role.permissions.length} Units
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Permission Hub (8/12) */}
        <div className="lg:col-span-8 bg-white rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 overflow-hidden relative">
          
          {selectedRole ? (
            <div className="flex flex-col min-h-[600px]">
              
              {/* Hub Header */}
              <div className="p-10 border-b border-slate-50 bg-slate-50/30 backdrop-blur-md flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                  <h3 className="text-xl font-black text-slate-950 uppercase tracking-tighter">Permission Matrix: {selectedRole.name.replace('_', ' ')}</h3>
                  <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest italic">Modifying {selectedRole.permissions.length} active authorization signatures</p>
                </div>
                {!isEditing ? (
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="bg-indigo-600 text-white px-8 py-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-500/10 hover:bg-slate-950 transition-all active:scale-95"
                  >
                    Adjust Signatures
                  </button>
                ) : (
                  <div className="flex gap-4">
                    <button 
                      onClick={() => setIsEditing(false)}
                      className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-950 transition-colors"
                    >
                      Abort
                    </button>
                    <button 
                      id="save-role-btn"
                      onClick={() => handleUpdatePermissions(selectedRole, selectedRole.permissions)}
                      className="bg-slate-950 text-white px-8 py-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all outline-none ring-2 ring-indigo-500 ring-offset-4"
                    >
                      Deploy Logic
                    </button>
                  </div>
                )}
              </div>
              
              {/* Matrix Grid */}
              <div className="p-10">
                {Array.from(new Set(allPermissions.map(p => p.module))).map(module => (
                  <div key={module} className="mb-12 last:mb-0 animate-in fade-in duration-700">
                    <div className="flex items-center gap-4 mb-8">
                       <h5 className="text-[10px] font-black text-slate-900 uppercase tracking-[0.3em]">{module} COMMANDS</h5>
                       <div className="h-px bg-slate-100 flex-1"></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {allPermissions.filter(p => p.module === module).map(p => {
                        const isGranted = selectedRole.permissions.includes(p.code);
                        return (
                          <div 
                            key={p.code} 
                            onClick={() => {
                              if (!isEditing) return;
                              const newPerms = !isGranted 
                                ? [...selectedRole.permissions, p.code]
                                : selectedRole.permissions.filter(code => code !== p.code);
                              setSelectedRole({ ...selectedRole, permissions: newPerms });
                            }}
                            className={`p-6 rounded-3xl border transition-all duration-300 relative group/card ${
                              isGranted 
                                ? 'border-indigo-100 bg-indigo-50/30' 
                                : 'border-slate-100 bg-white'
                            } ${isEditing ? 'cursor-pointer hover:border-indigo-300' : 'opacity-80'}`}
                          >
                            <div className="flex justify-between items-start gap-4">
                              <div className="min-w-0">
                                <p className={`text-[11px] font-black uppercase tracking-wide transition-colors ${isGranted ? 'text-indigo-600' : 'text-slate-900'}`}>
                                  {p.name}
                                </p>
                                <p className="text-[9px] font-bold text-slate-400 mt-2 leading-relaxed h-8 line-clamp-2">
                                  {p.description}
                                </p>
                              </div>
                              <div className={`w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center shrink-0 ${
                                isGranted 
                                  ? 'bg-indigo-600 border-indigo-600 shadow-lg shadow-indigo-500/20' 
                                  : 'border-slate-200 bg-white'
                              }`}>
                                {isGranted && <span className="text-white text-[10px] font-black">✓</span>}
                              </div>
                            </div>
                            {isGranted && (
                              <div className="absolute top-2 right-2 w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[600px] p-20 text-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-slate-50/50 backdrop-blur-sm -z-10"></div>
              <div className="w-24 h-24 bg-slate-950 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-2xl rotate-12 group-hover:rotate-0 transition-transform duration-700">
                <span className="text-4xl text-indigo-500 animate-pulse">🔑</span>
              </div>
              <h3 className="text-xl font-black text-slate-950 uppercase tracking-tighter">Awaiting Role Selection</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-4 max-w-xs uppercase tracking-widest leading-loose">
                Please select a functional identity cohort from the matrix sidebar to initiate authorization adjustments.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
