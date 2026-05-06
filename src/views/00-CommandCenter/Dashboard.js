import React, { useState, useEffect } from 'react';
import { getDashboardKpis, getSalesChartData } from '../../api/analyticsService';
import { getOnlineDrivers } from '../../api/operationsService';
import PageTitle from '../../components/shared/PageTitle';
import BarChart from '../../components/charts/BarChart';
import { 
    TrendingUp, ShoppingCart, Truck, Users, Activity, 
    ArrowUpRight, AlertCircle, Zap, ExternalLink 
} from 'lucide-react';

// Enhanced Glass Card
const StatCard = ({ title, value, icon: Icon, color, trend }) => (
    <div className="glass-card relative overflow-hidden group hover:border-white/20 transition-all duration-300">
        <div className={`absolute -right-6 -top-6 p-8 rounded-full opacity-10 group-hover:opacity-20 transition-all ${color} blur-xl`}></div>
        <div className="relative z-10">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">{title}</p>
                    <h3 className="text-3xl font-bold text-white mt-2">{value}</h3>
                </div>
                <div className={`p-3 rounded-xl bg-white/5 border border-white/10 ${color.replace('bg-', 'text-')}`}>
                    <Icon size={24} />
                </div>
            </div>
            {trend && (
                <div className="mt-4 flex items-center text-xs font-medium text-green-400">
                    <ArrowUpRight size={14} className="mr-1" />
                    {trend} since last month
                </div>
            )}
        </div>
    </div>
);

export default function Dashboard({ setActiveView }) {
    const [stats, setStats] = useState({ totalRevenue: 0, totalKgSold: 0, activeDeliveries: 0, onlineDrivers: 0 });
    const [chartData, setChartData] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            // ✅ FIX: Use allSettled so one failure doesn't crash the whole dashboard
            const results = await Promise.allSettled([
                getDashboardKpis(),
                getOnlineDrivers(),
                getSalesChartData('monthly')
            ]);

            // 1. KPIs
            const kpis = results[0].status === 'fulfilled' ? results[0].value : { totalRevenue: 0, totalKgSold: 0, activeDeliveries: 0 };
            
            // 2. Drivers (Handle the 404 gracefully if backend isn't fixed yet)
            const drivers = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : [];
            
            // 3. Sales Chart
            const sales = results[2].status === 'fulfilled' ? results[2].value : null;

            setStats({
                ...kpis,
                onlineDrivers: drivers.length
            });

            if (sales?.breakdown) {
                setChartData(sales.breakdown.map(item => ({
                    label: item.label,
                    value: item.revenue
                })));
            }
        } catch (error) {
            console.error("Dashboard Partial Sync Failed", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    // Quick Actions Component
    const QuickAction = ({ label, icon: Icon, view, color }) => (
        <button 
            onClick={() => setActiveView(view)}
            className="flex items-center p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all group w-full text-left"
        >
            <div className={`p-2 rounded-lg mr-4 ${color} text-white`}>
                <Icon size={20} />
            </div>
            <div>
                <h4 className="text-sm font-bold text-white group-hover:text-blue-300 transition-colors">{label}</h4>
                <p className="text-[10px] text-gray-500">Jump to module</p>
            </div>
            <ExternalLink size={14} className="ml-auto text-gray-600 group-hover:text-white opacity-0 group-hover:opacity-100 transition-all" />
        </button>
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Area */}
            <div className="flex justify-between items-end">
                <PageTitle title="Command Center" subtitle="Real-time Operational Intelligence" />
                <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-mono">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span>SYSTEM ONLINE</span>
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard 
                    title="Total Revenue" 
                    value={loading ? '...' : `₦${(stats.totalRevenue || 0).toLocaleString()}`} 
                    icon={TrendingUp} 
                    color="bg-green-500" 
                    trend="+12.5%"
                />
                <StatCard 
                    title="LPG Output" 
                    value={loading ? '...' : `${(stats.totalKgSold || 0).toLocaleString()} kg`} 
                    icon={ShoppingCart} 
                    color="bg-blue-500" 
                    trend="+5.2%"
                />
                <StatCard 
                    title="Live Deliveries" 
                    value={loading ? '...' : stats.activeDeliveries || 0} 
                    icon={Truck} 
                    color="bg-purple-500" 
                />
                <StatCard 
                    title="Active Fleet" 
                    value={loading ? '...' : stats.onlineDrivers || 0} 
                    icon={Users} 
                    color="bg-orange-500" 
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Chart */}
                <div className="lg:col-span-2 glass-card min-h-[400px]">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-white flex items-center">
                            <Activity size={20} className="mr-2 text-blue-400"/> Revenue Trajectory
                        </h3>
                    </div>
                    <BarChart data={chartData} />
                </div>
                
                {/* Right Column: Quick Actions & Health */}
                <div className="space-y-6">
                    {/* Quick Actions */}
                    <div className="glass-card">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center">
                            <Zap size={16} className="mr-2 text-yellow-400"/> Quick Actions
                        </h3>
                        <div className="space-y-3">
                            <QuickAction label="Dispatch Order" icon={Truck} view="Logistics" color="bg-blue-600" />
                            <QuickAction label="Log Sale (POS)" icon={ShoppingCart} view="DailyLog" color="bg-green-600" />
                            <QuickAction label="Customer Chat" icon={Users} view="SupportDesk" color="bg-purple-600" />
                        </div>
                    </div>

                    {/* System Alerts */}
                    <div className="glass-card border-t-4 border-red-500">
                        <h3 className="text-white font-bold mb-3 flex items-center">
                            <AlertCircle size={18} className="mr-2 text-red-500"/> System Alerts
                        </h3>
                        <div className="space-y-2">
                            <div className="text-xs text-gray-400 p-2 bg-white/5 rounded border-l-2 border-yellow-500">
                                <span className="text-white font-bold">Low Stock:</span> Main Plant (Lekki) at 15% capacity.
                            </div>
                            <div className="text-xs text-gray-400 p-2 bg-white/5 rounded border-l-2 border-blue-500">
                                <span className="text-white font-bold">Audit:</span> 3 Unreconciled EOD reports pending.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}