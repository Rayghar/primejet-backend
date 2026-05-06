import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import { ShieldAlert, Search } from 'lucide-react';

export default function AuditLog() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // ✅ FIX: Use the V2 audit log endpoint
        apiClient.get('/api/v2/logs/audit')
            .then(res => setLogs(res.data.logs || [])) // Handle pagination structure
            .catch(err => {
                console.error("Audit Logs Error:", err);
                setLogs([]);
            })
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="space-y-6">
            <PageTitle title="System Audit Logs" subtitle="Security and operational events" />
            
            <Card className="p-0 overflow-hidden">
                <div className="bg-white/5 p-4 border-b border-white/10 flex justify-between items-center">
                    <div className="relative w-64">
                        <input type="text" placeholder="Search logs..." className="glass-input pl-9 pr-4 py-2 w-full text-sm"/>
                        <Search size={16} className="absolute left-3 top-3 text-gray-400"/>
                    </div>
                </div>
                
                {loading ? <div className="p-8 text-center text-gray-500">Loading logs...</div> : (
                    <table className="w-full text-sm text-left text-gray-400">
                        <thead className="bg-white/5 text-gray-300 font-medium border-b border-white/10">
                            <tr>
                                <th className="p-4">Timestamp</th>
                                <th className="p-4">User</th>
                                <th className="p-4">Action</th>
                                <th className="p-4">IP Address</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {logs.length === 0 ? (
                                <tr><td colSpan="4" className="p-8 text-center text-gray-500">No logs found.</td></tr>
                            ) : logs.map((log, i) => (
                                <tr key={i} className="hover:bg-white/5">
                                    <td className="p-4">{new Date(log.timestamp).toLocaleString()}</td>
                                    <td className="p-4 font-medium text-white">{log.userEmail || log.userId}</td>
                                    <td className="p-4">
                                        <span className="bg-blue-500/20 text-blue-300 px-2 py-1 rounded-full text-xs border border-blue-500/30">
                                            {log.action}
                                        </span>
                                    </td>
                                    <td className="p-4 font-mono text-xs">{log.ipAddress}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>
        </div>
    );
}