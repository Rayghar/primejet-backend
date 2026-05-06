import React from 'react';

export default function StatCard({ title, value, icon: Icon, color, trend }) {
    const colors = {
        blue: 'text-blue-400 bg-blue-500/10',
        green: 'text-green-400 bg-green-500/10',
        purple: 'text-purple-400 bg-purple-500/10',
        orange: 'text-orange-400 bg-orange-500/10',
    };

    return (
        <div className="glass rounded-2xl p-6 border border-white/5 hover:bg-white/5 transition-all">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-gray-400 text-sm font-medium uppercase tracking-wider">{title}</p>
                    <h3 className="text-2xl font-bold text-white mt-2">{value}</h3>
                    {trend && (
                        <p className={`text-xs mt-2 flex items-center ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {trend > 0 ? '+' : ''}{trend}% from last month
                        </p>
                    )}
                </div>
                <div className={`p-3 rounded-xl ${colors[color] || colors.blue}`}>
                    <Icon size={24} />
                </div>
            </div>
        </div>
    );
}