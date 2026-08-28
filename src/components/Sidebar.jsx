import React from 'react';

function SidebarBtn({ icon, label, active, onClick, badge }) { 
    return (
        <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-cyan-500 text-black font-bold shadow-lg shadow-cyan-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
            <span className="text-lg">{icon}</span><span className="flex-1 text-left text-sm">{label}</span>
            {badge > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-bounce">{badge}</span>}
        </button>
    ); 
}

export default function Sidebar({ appName, activeTab, setActiveTab, isSidebarOpen, setIsSidebarOpen, pendingOrdersCount, pendingPaymentOrdersCount, onLogout }) {
    return (
        <>
            {isSidebarOpen && (<div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm animate-fade-in"></div>)}
            <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-white/10 p-6 flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
                <div className="flex justify-between items-center mb-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-cyan-500 rounded-lg flex items-center justify-center font-bold text-black text-xl">{appName.charAt(0).toUpperCase()}</div>
                        <div><h1 className="text-md font-bold font-serif tracking-wide">{appName.toUpperCase()}</h1></div>
                    </div>
                    <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-gray-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <nav className="space-y-2 flex-1 overflow-y-auto pr-2 scrollbar-hide">
                    <SidebarBtn icon="🧾" label="Create Bill" active={activeTab === 'create_bill'} onClick={() => { setActiveTab('create_bill'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="⚡" label="Live Orders" active={activeTab === 'orders'} onClick={() => { setActiveTab('orders'); setIsSidebarOpen(false); }} badge={pendingOrdersCount} />
                    <SidebarBtn icon="⏳" label="Pending Payments" active={activeTab === 'pending_payments'} onClick={() => { setActiveTab('pending_payments'); setIsSidebarOpen(false); }} badge={pendingPaymentOrdersCount} />
                    <SidebarBtn icon="💸" label="Expense Mgmt" active={activeTab === 'expenses'} onClick={() => { setActiveTab('expenses'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="🧑‍🍳" label="Staff Accounts" active={activeTab === 'staff'} onClick={() => { setActiveTab('staff'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📈" label="Analytics & Txns" active={activeTab === 'analytics'} onClick={() => { setActiveTab('analytics'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="❓" label="Missing Items" active={activeTab === 'missing'} onClick={() => { setActiveTab('missing'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="🍔" label="Menu Manager" active={activeTab === 'menu'} onClick={() => { setActiveTab('menu'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📦" label="Inventory" active={activeTab === 'inventory'} onClick={() => { setActiveTab('inventory'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📸" label="Moments" active={activeTab === 'moments'} onClick={() => { setActiveTab('moments'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📊" label="History" active={activeTab === 'history'} onClick={() => { setActiveTab('history'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="👥" label="Users Info" active={activeTab === 'users'} onClick={() => { setActiveTab('users'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="⚙️" label="Settings" active={activeTab === 'settings'} onClick={() => { setActiveTab('settings'); setIsSidebarOpen(false); }} />
                </nav>
                <button onClick={onLogout} className="mt-4 flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-xl transition-all"><span className="text-sm font-bold">Logout</span></button>
            </aside>
        </>
    );
}