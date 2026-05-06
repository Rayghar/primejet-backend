import React from 'react';
import { BarChart as RechartsBar, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function BarChart({ data }) {
    if (!data || data.length === 0) return <div className="text-gray-500 text-center py-10">No data available</div>;

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <RechartsBar data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                    <XAxis 
                        dataKey="label" 
                        stroke="#94a3b8" 
                        tick={{fill: '#94a3b8', fontSize: 12}} 
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis 
                        stroke="#94a3b8" 
                        tick={{fill: '#94a3b8', fontSize: 12}} 
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `₦${value/1000}k`}
                    />
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                        itemStyle={{ color: '#fff' }}
                        cursor={{fill: '#ffffff05'}}
                    />
                    <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
                </RechartsBar>
            </ResponsiveContainer>
        </div>
    );
}