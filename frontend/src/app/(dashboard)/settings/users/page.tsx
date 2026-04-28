'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  employeeId?: string;
  createdAt: string;
}

interface Role {
  id: string;
  name: string;
}

export default function UserManagementPage() {
  const { hasPermission } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  
  // Create User State
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'EMPLOYEE' });
  const [updateRole, setUpdateRole] = useState('');

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = document.cookie.split('ezyhrm_token=')[1]?.split(';')[0];
      const [usersRes, rolesRes] = await Promise.all([
        fetch(`${apiBaseUrl}/users`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBaseUrl}/roles`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (usersRes.ok && rolesRes.ok) {
        const userData = await usersRes.json();
        setUsers(userData.users || []);
        setRoles(await rolesRes.json());
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async () => {
    if (!selectedUser || !updateRole) return;
    try {
      const token = document.cookie.split('ezyhrm_token=')[1]?.split(';')[0];
      const res = await fetch(`${apiBaseUrl}/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ role: updateRole })
      });

      if (res.ok) {
        fetchData();
        setIsUpdateModalOpen(false);
        setSelectedUser(null);
      }
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) return;
    try {
      const token = document.cookie.split('ezyhrm_token=')[1]?.split(';')[0];
      const res = await fetch(`${apiBaseUrl}/users`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newUser)
      });

      if (res.ok) {
        fetchData();
        setIsCreateModalOpen(false);
        setNewUser({ name: '', email: '', password: '', role: 'EMPLOYEE' });
      }
    } catch (err) {
      console.error('Creation failed:', err);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-24 animate-pulse">
      <div className="h-12 w-12 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin mb-4"></div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Synching Quantum identities...</p>
    </div>
  );

  if (!hasPermission('user:manage')) return (
    <div className="p-24 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 text-red-500 mb-6">🚫</div>
      <h2 className="text-xl font-black text-slate-900 uppercase tracking-widest">Protocol Access Denied</h2>
      <p className="text-xs text-slate-400 mt-4 max-w-sm mx-auto">Your identity level lacks the required administrative clearance to modify system credentials.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-950 uppercase tracking-tighter">Identity Management</h2>
          <p className="text-[11px] font-bold text-slate-400 mt-3 uppercase tracking-[0.2em] flex items-center gap-3">
             Credential Control Center
             <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
             Direct Auth Access Active
          </p>
        </div>
        <button 
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-indigo-600 hover:bg-slate-950 text-white px-8 py-3.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-indigo-500/20 active:scale-95"
        >
          Provision New Identity
        </button>
      </div>

      {/* User Table (Indigo Enterprise Style) */}
      <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 overflow-hidden group">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/50">
            <tr>
              <th className="px-8 py-5 text-left text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">System Identity</th>
              <th className="px-8 py-5 text-left text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Operational Group</th>
              <th className="px-8 py-5 text-left text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Clearance Status</th>
              <th className="px-8 py-5 text-left text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Protocol Sync</th>
              <th className="px-8 py-5 text-right text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-50">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-slate-50/80 transition-colors group/row">
                <td className="px-8 py-6 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="h-10 w-10 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center text-[10px] font-black text-indigo-400 shadow-xl group-hover/row:scale-110 transition-transform">
                      {u.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="ml-5">
                      <div className="text-[12px] font-black text-slate-900 uppercase tracking-wide">{u.name}</div>
                      <div className="text-[10px] font-bold text-slate-400 mt-1">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-8 py-6 whitespace-nowrap">
                  <span className={`inline-flex items-center px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                    u.role === 'SUPER_ADMIN' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 
                    u.role === 'HR_ADMIN' ? 'bg-slate-900 text-white border-slate-800' : 
                    'bg-slate-50 text-slate-500 border-slate-100'
                  }`}>
                    {u.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-8 py-6 whitespace-nowrap">
                   <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${u.isActive ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`}></span>
                      <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">{u.isActive ? 'Active' : 'Locked'}</span>
                   </div>
                </td>
                <td className="px-8 py-6 whitespace-nowrap text-[10px] font-bold text-slate-400 tabular-nums">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-8 py-6 whitespace-nowrap text-right">
                  <button 
                    onClick={() => { setSelectedUser(u); setUpdateRole(u.role); setIsUpdateModalOpen(true); }}
                    className="text-[9px] font-black text-indigo-600 uppercase tracking-[0.2em] border border-indigo-100 px-4 py-1.5 rounded-full hover:bg-indigo-600 hover:text-white transition-all active:scale-95"
                  >
                    Adjust Clearances
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Provision Update Modal (Glassmorphism) */}
      {isUpdateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300">
            <div className="p-10 border-b border-slate-50">
              <h3 className="text-xl font-black text-slate-950 uppercase tracking-tighter">Update Authorization</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest flex items-center gap-2">
                 Assigning new protocol level for <span className="text-slate-900 font-extrabold">{selectedUser?.name}</span>
              </p>
            </div>
            <div className="p-10 space-y-8">
              <div className="space-y-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Protocol Allocation</label>
                <select 
                  value={updateRole}
                  onChange={(e) => setUpdateRole(e.target.value)}
                  className="w-full bg-slate-50 border-slate-100 rounded-2xl p-4 text-[12px] font-bold text-slate-950 focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                >
                  <option value="">Select clearance level...</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.name}>{r.name.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 flex gap-4">
                 <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-black shrink-0">!</div>
                 <p className="text-[10px] text-indigo-700 leading-relaxed font-bold uppercase tracking-wide">
                    Elevating clearance will immediately propagate permissions across all microservices (Payroll, Recruitment, Leave) on next sync.
                 </p>
              </div>
            </div>
            <div className="p-10 bg-slate-50 flex justify-end gap-5">
              <button onClick={() => setIsUpdateModalOpen(false)} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-950 transition-colors">Cancel</button>
              <button onClick={handleUpdateRole} className="bg-indigo-600 text-white px-8 py-3.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-500/20 active:scale-95 transition-all">Confirm Protocol</button>
            </div>
          </div>
        </div>
      )}

      {/* Provision New Identity Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300">
            <div className="p-10 border-b border-slate-50">
              <h3 className="text-xl font-black text-slate-950 uppercase tracking-tighter">Provision New Identity</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">Registering a new system operator in the EzyHRM core.</p>
            </div>
            <div className="p-10 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Full Name</label>
                  <input 
                    type="text" 
                    value={newUser.name}
                    onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                    placeholder="e.g. Samuel Mavrone"
                    className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
                <div className="space-y-3">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Email Address</label>
                  <input 
                    type="email" 
                    value={newUser.email}
                    onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                    placeholder="user@ezyhrm.sg"
                    className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Initial Password</label>
                  <input 
                    type="password" 
                    value={newUser.password}
                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                    placeholder="••••••••"
                    className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
                <div className="space-y-3">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Initial Clearance</label>
                  <select 
                    value={newUser.role}
                    onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                    className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-600"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.name}>{r.name.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="p-10 bg-slate-50 flex justify-end gap-5">
              <button onClick={() => setIsCreateModalOpen(false)} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-950 transition-colors">Abort</button>
              <button 
                id="create-identity-btn"
                onClick={handleCreateUser} 
                className="bg-slate-950 text-white px-10 py-4 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all"
              >
                Inject Identity
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
