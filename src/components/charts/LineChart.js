import React from 'react';
import { LineChart as RechartsLine, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function LineChart({ data, dataKey = "value", color = "#10b981" }) {
    if (!data || data.length === 0) return <div className="text-gray-500 text-center py-10">No trend data</div>;

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <RechartsLine data={data}>
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
                    />
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                    />
                    <Line 
                        type="monotone" 
                        dataKey={dataKey} 
                        stroke={color} 
                        strokeWidth={3} 
                        dot={{fill: color, strokeWidth: 2}} 
                        activeDot={{r: 6}}
                    />
                </RechartsLine>
            </ResponsiveContainer>
        </div>
    );
}