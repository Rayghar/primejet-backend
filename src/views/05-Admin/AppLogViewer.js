import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient'; // Using Node API now
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import { formatDate } from '../../utils/formatters';
import { AlertCircle, Terminal } from 'lucide-react';

export default function AppLogViewer() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Assuming endpoint exists or is mocked
        apiClient.get('/api/v1/admin/logs')
            .then(res => setLogs(res.data))
            .catch(() => setLogs([])) // Graceful fail if not impl yet
            .finally(() => setLoading(false));
    }, []);

    const getLevelColor = (level) => {
        switch (level) {
            case 'ERROR': return 'bg-red-100 text-red-800';
            case 'WARN': return 'bg-yellow-100 text-yellow-800';
            default: return 'bg-blue-100 text-blue-800';
        }
    };

    return (
        <div className="space-y-6">
            <PageTitle title="Application Logs" subtitle="System diagnostics" />
            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-400">
                        <thead className="bg-white/5 text-gray-300">
                            <tr>
                                <th className="p-4">Time</th>
                                <th className="p-4">Level</th>
                                <th className="p-4">Message</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {loading ? (
                                <tr><td colSpan="3" className="p-8 text-center">Loading logs...</td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan="3" className="p-8 text-center text-gray-500">No logs found.</td></tr>
                            ) : logs.map((log, i) => (
                                <tr key={i} className="hover:bg-white/5">
                                    <td className="p-4 font-mono">{formatDate(log.timestamp)}</td>
                                    <td className="p-4"><span className={`px-2 py-1 rounded text-xs font-bold ${getLevelColor(log.level)}`}>{log.level}</span></td>
                                    <td className="p-4">{log.message}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}