import React from 'react';

function SidebarBtn({ icon, label, active, onClick, badge }) { 
    return (
        <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-cyan-500 text-black font-bold shadow-lg shadow-cyan-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
            <span className="text-lg">{icon}</span><span className="flex-1 text-left text-sm">{label}</span>
            {badge > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-bounce">{badge}</span>}
        </button>
    ); 
}

export default function Sidebar({ appName, activeTab, handleTabClick, isUnlocked, isSidebarOpen, setIsSidebarOpen, pendingOrdersCount, pendingPaymentOrdersCount, handleLockApp }) {
    return (
        <>
            {isSidebarOpen && (<div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm animate-fade-in"></div>)}
            <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-white/10 p-6 flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
                <div className="flex justify-between items-center mb-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-cyan-500 rounded-lg flex items-center justify-center font-bold text-black text-xl">{appName.charAt(0).toUpperCase()}</div>
                        <div><h1 className="text-md font-bold font-serif tracking-wide">{appName.toUpperCase()}</h1></div>
                    </div>
                    <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-gray-400">✕</button>
                </div>
                <nav className="space-y-2 flex-1 overflow-y-auto pr-2 scrollbar-hide">
                    {/* PUBLIC TABS */}
                    <SidebarBtn icon="🧾" label="Create Bill" active={activeTab === 'create_bill'} onClick={() => handleTabClick('create_bill')} />
                    <SidebarBtn icon="⚡" label="Live Orders" active={activeTab === 'orders'} onClick={() => handleTabClick('orders')} badge={pendingOrdersCount} />
                    <SidebarBtn icon="📊" label="History" active={activeTab === 'history'} onClick={() => handleTabClick('history')} />
                    
                    {/* RESTRICTED TABS */}
                    <SidebarBtn icon="⏳" label={`Pending Payments ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'pending_payments'} onClick={() => handleTabClick('pending_payments')} badge={pendingPaymentOrdersCount} />
                    <SidebarBtn icon="💸" label={`Expense Mgmt ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'expenses'} onClick={() => handleTabClick('expenses')} />
                    <SidebarBtn icon="🛒" label={`Stock Purchases ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'purchases'} onClick={() => handleTabClick('purchases')} />    
                    <SidebarBtn icon="🧑‍🍳" label={`Operations & Staff ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'staff'} onClick={() => handleTabClick('staff')} />
                    <SidebarBtn icon="📈" label={`Analytics & Txns ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'analytics'} onClick={() => handleTabClick('analytics')} />
                    <SidebarBtn icon="❓" label={`Missing Items ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'missing'} onClick={() => handleTabClick('missing')} />
                    <SidebarBtn icon="🍔" label={`Menu Manager ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'menu'} onClick={() => handleTabClick('menu')} />
                    <SidebarBtn icon="📦" label={`Inventory ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'inventory'} onClick={() => handleTabClick('inventory')} />
                    <SidebarBtn icon="📸" label={`Moments ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'moments'} onClick={() => handleTabClick('moments')} />
                    <SidebarBtn icon="👥" label={`Users Info ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'users'} onClick={() => handleTabClick('users')} />
                    <SidebarBtn icon="⚙️" label={`Settings ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'settings'} onClick={() => handleTabClick('settings')} />
                </nav>
                <button onClick={handleLockApp} className="mt-4 flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-xl transition-all">
                    <span className="text-sm font-bold">{isUnlocked ? 'Lock App 🔒' : 'App is Locked 🔒'}</span>
                </button>
            </aside>
        </>
    );
}