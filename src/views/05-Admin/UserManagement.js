import React, { useState, useEffect } from 'react';
import { getUsers, inviteUser, updateUserRole, deleteUser } from '../../api/userService';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import Modal from '../../components/shared/Modal';
import { Users, UserPlus, Shield, Mail, Trash2, Edit } from 'lucide-react';

export default function UserManagement() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showInviteModal, setShowInviteModal] = useState(false);
    
    // Invite Form State
    const [inviteForm, setInviteForm] = useState({ email: '', role: 'cashier', name: '' });

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const data = await getUsers();
            setUsers(data);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleInvite = async (e) => {
        e.preventDefault();
        try {
            await inviteUser(inviteForm.email, inviteForm.role, inviteForm.name);
            setShowInviteModal(false);
            setInviteForm({ email: '', role: 'cashier', name: '' });
            fetchUsers();
            alert('Invitation sent successfully');
        } catch (err) {
            alert('Failed to invite user: ' + err.message);
        }
    };

    const handleRoleChange = async (userId, newRole) => {
        if (!window.confirm(`Change role to ${newRole}?`)) return;
        await updateUserRole(userId, newRole);
        fetchUsers();
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <PageTitle title="User Management" subtitle="Access control & Staff roles" />
                <Button onClick={() => setShowInviteModal(true)} icon={UserPlus}>Invite User</Button>
            </div>

            <Card className="p-0 overflow-hidden">
                <table className="w-full text-left text-sm text-gray-400">
                    <thead className="bg-white/5 text-gray-300 uppercase text-xs">
                        <tr>
                            <th className="p-4">User</th>
                            <th className="p-4">Role</th>
                            <th className="p-4">Status</th>
                            <th className="p-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {users.map(user => (
                            <tr key={user.id} className="hover:bg-white/5">
                                <td className="p-4">
                                    <div className="flex items-center">
                                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-300 font-bold mr-3">
                                            {user.name?.[0] || 'U'}
                                        </div>
                                        <div>
                                            <p className="text-white font-medium">{user.name}</p>
                                            <p className="text-xs">{user.email}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4">
                                    <select 
                                        value={user.role} 
                                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                                        className="bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-white"
                                    >
                                        <option value="admin">Admin</option>
                                        <option value="manager">Manager</option>
                                        <option value="cashier">Cashier</option>
                                        <option value="driver">Driver</option>
                                        <option value="customer">Customer</option>
                                    </select>
                                </td>
                                <td className="p-4">
                                    <span className={`px-2 py-1 rounded text-xs ${user.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                        {user.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td className="p-4 text-right">
                                    <button onClick={() => deleteUser(user.id).then(fetchUsers)} className="text-red-400 hover:text-red-300 p-2">
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>

            {/* Invite Modal */}
            {showInviteModal && (
                <Modal title="Invite New Staff" onClose={() => setShowInviteModal(false)}>
                    <form onSubmit={handleInvite} className="space-y-4">
                        <input required placeholder="Full Name" className="glass-input w-full p-3" value={inviteForm.name} onChange={e => setInviteForm({...inviteForm, name: e.target.value})} />
                        <input required type="email" placeholder="Email Address" className="glass-input w-full p-3" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} />
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Role</label>
                            <select className="glass-input w-full p-3 bg-slate-800" value={inviteForm.role} onChange={e => setInviteForm({...inviteForm, role: e.target.value})}>
                                <option value="manager">Manager</option>
                                <option value="cashier">Cashier</option>
                                <option value="driver">Driver</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div className="flex justify-end pt-4"><Button type="submit">Send Invitation</Button></div>
                    </form>
                </Modal>
            )}
        </div>
    );
}