import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { 
    LayoutDashboard, Truck, TrendingUp, Users, ShoppingCart, 
    MessageSquare, Settings, LogOut, ChevronLeft, ChevronRight,
    PieChart, Map, Activity, FileText, Shield, Database, 
    ClipboardList, DollarSign, Briefcase
} from 'lucide-react';

const MENU_GROUPS = [
    {
        title: "Command",
        items: [
            { id: 'Dashboard', label: 'Executive View', icon: LayoutDashboard },
            { id: 'Logistics', label: 'Dispatch Map', icon: Truck },
        ]
    },
    {
        title: "Intelligence",
        items: [
            { id: 'BusinessAnalytics', label: 'Growth & LTV', icon: PieChart },
            { id: 'DeliveryHeatmap', label: 'Geospatial', icon: Map },
            { id: 'DriverScorecards', label: 'Fleet Perf.', icon: Activity },
        ]
    },
    {
        title: "Operations",
        items: [
            { id: 'Inventory', label: 'Stock & Cylinders', icon: ShoppingCart },
            { id: 'StockControlCenter', label: 'Stock Control', icon: Database },
{ id: 'ProductPriceBranchConfig', label: 'Product & Pricing', icon: Settings },
            { id: 'PlantStatus', label: 'Plant & Maint.', icon: Database },
        ]
    },
    {
        title: "Finance & ERP",
        items: [
            { id: 'PostingReadinessControl', label: 'Posting Readiness', icon: Shield },
            { id: 'FinancialStatements', label: 'P&L / Balance', icon: TrendingUp },
            { id: 'FinanceControlReports', label: 'Finance Controls', icon: FileText },
            { id: 'OptionalSettlementControl', label: 'Settlement Control', icon: DollarSign },
            { id: 'TrialBalance', label: 'Trial Balance', icon: FileText },
            { id: 'GLHealth', label: 'GL Health', icon: Activity },
            { id: 'AssetAndLoan', label: 'Assets & Loans', icon: Briefcase },
            { id: 'PlantProfitability', label: 'Unit Economics', icon: DollarSign },
            { id: 'RevenueAssurance', label: 'Audit / Fraud', icon: Shield },
            { id: 'TaxCompliance', label: 'Tax & VAT', icon: FileText },
        ]
    },
    {
        title: "Sales & CRM",
        items: [
            { id: 'CustomerHub', label: 'Customer DB', icon: Users },
            { id: 'SalesAnalytics', label: 'Sales Trends', icon: TrendingUp },
            { id: 'SupportDesk', label: 'Live Chat', icon: MessageSquare },
        ]
    },
    {
        title: "Point of Sale",
        items: [
            { id: 'DailyLog', label: 'Cashier POS', icon: ClipboardList },
            { id: 'CloseWorkspace', label: 'Close Workspace', icon: ClipboardList },
            { id: 'DailyCloseControlDashboard', label: 'Close Control', icon: Activity },
            { id: 'ApprovalQueue', label: 'EOD Approvals', icon: FileText },
            { id: 'TransactionHistory', label: 'Ledger', icon: Database },
        ]
    },
    {
        title: "Administration",
        items: [
            { id: 'UserManagement', label: 'Staff Access', icon: Users },
            { id: 'Configuration', label: 'System Config', icon: Settings },
            { id: 'AuditLog', label: 'Security Logs', icon: Shield },
            { id: 'AppLogViewer', label: 'System Diagnostics', icon: Activity },
        ]
    }
];

export default function Sidebar({ activeView, setActiveView }) {
    const { user, logout } = useAuth();
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className={`h-screen bg-[#0f172a]/95 backdrop-blur-xl border-r border-white/5 flex flex-col transition-all duration-300 z-50 ${collapsed ? 'w-20' : 'w-72'}`}>
            {/* Header */}
            <div className="p-6 flex items-center justify-between border-b border-white/5">
                {!collapsed && (
                    <div className="flex items-center">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center mr-3 shadow-lg shadow-blue-500/30">
                            <span className="font-bold text-white">P</span>
                        </div>
                        <span className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-white">
                            PrimeJet<span className="text-blue-500">OS</span>
                        </span>
                    </div>
                )}
                <button onClick={() => setCollapsed(!collapsed)} className="text-gray-400 hover:text-white p-1 hover:bg-white/5 rounded-lg transition-all">
                    {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                </button>
            </div>

            {/* Menu */}
            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6 custom-scrollbar">
                {MENU_GROUPS.map((group, idx) => (
                    <div key={idx}>
                        {!collapsed && (
                            <h3 className="px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                                {group.title}
                            </h3>
                        )}
                        <div className="space-y-1">
                            {group.items.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveView(item.id)}
                                    className={`w-full flex items-center p-3 rounded-xl transition-all duration-200 group relative ${
                                        activeView === item.id 
                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                                        : 'text-gray-400 hover:bg-white/5 hover:text-blue-300'
                                    }`}
                                >
                                    <item.icon size={20} className={`${collapsed ? 'mx-auto' : 'mr-3'} ${activeView === item.id ? 'text-white' : 'text-gray-500 group-hover:text-blue-400'}`} />
                                    
                                    {!collapsed && <span className="font-medium text-sm">{item.label}</span>}
                                    
                                    {/* Tooltip for Collapsed Mode */}
                                    {collapsed && (
                                        <div className="absolute left-16 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 border border-white/10">
                                            {item.label}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* User Profile */}
            <div className="p-4 border-t border-white/5 bg-black/20">
                <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
                    {!collapsed && (
                        <div className="flex items-center">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 flex items-center justify-center text-xs font-bold text-white border border-white/20">
                                {user?.name?.[0]}
                            </div>
                            <div className="ml-3 overflow-hidden">
                                <p className="text-sm font-bold text-white truncate w-32">{user?.name}</p>
                                <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
                            </div>
                        </div>
                    )}
                    <button onClick={logout} className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                        <LogOut size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
}