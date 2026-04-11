import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import OneSignal from 'react-onesignal'; 
let isOneSignalInitialized = false;
export default function AdminPanel() {
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('valo_admin_auth') === 'true');

    // Timer for Cinematic Splash Screen
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsLoading(false);
        }, 3000);
        return () => clearTimeout(timer);
    }, []);

    if (isLoading) {
        return <SplashScreen />;
    }

    if (!isAuthenticated) {
        return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;
    }

    return <AdminDashboard onLogout={() => setIsAuthenticated(false)} />;
}
// --- UPDATED SPLASH SCREEN WITH IMAGE ---
function SplashScreen() {
    // Replace '/logo.png' with your actual image path or URL
    const logoUrl = '/logo.png'; 

    return (
        <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center overflow-hidden relative">
            {/* Liquid Glow Background */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] animate-pulse"></div>
            
            <div className="relative z-10 flex flex-col items-center">
                {/* Image Container with Glassmorphism */}
                <div className="w-28 h-28 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] flex items-center justify-center shadow-2xl relative mb-8">
                    {/* Glowing effect behind the image */}
                    <div className="absolute inset-0 bg-cyan-500/20 blur-2xl opacity-50 rounded-[2.5rem]"></div>
                    
                    {/* Your Image Icon */}
                    <img 
                        src={logoUrl} 
                        alt="Logo" 
                        className="w-28 h-28 object-contain drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]"
                        onError={(e) => { e.target.src = "splash.png" }} // Fallback if image not found
                    />
                </div>
                
                <h1 className="text-4xl font-black tracking-[0.2em] text-white text-center mb-2">
                    VALO<span className="text-cyan-400"></span>
                </h1>
                <p className="text-gray-400  tracking-[0em] text-[18px] font-bold animate-pulse">
                    Experience 
                </p>

                <div className="mt-12 w-48 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 w-1/2 animate-loading-slide"></div>
                </div>
            </div>
        </div>
    );
}

// --- UPDATED LOGIN SCREEN WITH IMAGE ---
function AdminLogin({ onLogin }) {
    const [pin, setPin] = useState("");
    const [error, setError] = useState(false);
    const logoUrl = 'splash.png'; // Replace with your image path

    const handleSubmit = (e) => {
        e.preventDefault();
        const currentPin = localStorage.getItem('valo_admin_pin') || '1234';
        if (pin === currentPin) {
            localStorage.setItem('valo_admin_auth', 'true');
            onLogin();
        } else {
            setError(true);
            setPin("");
            setTimeout(() => setError(false), 500);
        }
    };
    const requestAllPermissions = async () => {
    try {
        // 1. Request Notifications (For OneSignal)
        if ('Notification' in window) {
            await Notification.requestPermission();
        }

        // 2. Request Location (For Tracking)
        // This will trigger the "Allow while using app" popup first
        const locPermission = await navigator.geolocation.getCurrentPosition(() => {});
        
        // 3. Alert for Background & Manual permissions
        // Note: Android requires "Background Location" to be enabled manually 
        // in settings after the first location popup is accepted.
        alert("Permissions Requested! For Background Tracking to work on your Realme, please go to App Info > Permissions > Location > Allow all the time.");
        
    } catch (err) {
        console.error("Permission request failed", err);
    }
};

    return (
        <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-4">
            <div className={`w-full max-w-sm bg-slate-800 border border-white/10 p-10 rounded-[3rem] shadow-2xl text-center transition-all ${error ? 'animate-shake border-red-500' : ''}`}>
                {/* Image Container */}
                <div className="w-28 h-28 bg-white/5 rounded-3xl mx-auto flex items-center justify-center mb-8 shadow-xl border border-white/5 relative">
                     <img 
                        src={logoUrl} 
                        alt="Logo" 
                        className="w-28 h-28 object-contain"
                        onError={(e) => { e.target.src = "./icon.png" }}
                    />
                </div>
                
                <h2 className="text-2xl font-bold text-white mb-1 uppercase tracking-tight">Access Locked</h2>
                <p className="text-gray-500 text-xs mb-8 uppercase font-bold tracking-widest text-[10px]">Security Protocols Active</p>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" placeholder="••••" maxLength="4" autoFocus className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-5 text-center text-white text-3xl tracking-[0.5em] focus:outline-none focus:border-cyan-500 transition-all" />
                    <button type="submit" className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-black py-4 rounded-2xl hover:opacity-90 transition-all shadow-lg active:scale-95  text-md tracking-wide">Verify PIN</button>
                </form>
            </div>
        </div>
    );
}

// --- MAIN DASHBOARD ---
function AdminDashboard({ onLogout }) {
    const [activeTab, setActiveTab] = useState('orders'); 
    
    // --- DYNAMIC SETTINGS STATE ---
    const [appName, setAppName] = useState(() => localStorage.getItem('valo_app_name') || 'VALO');
    const [alertTone, setAlertTone] = useState(() => localStorage.getItem('valo_alert_tone') || 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg');

    // --- DATABASE STATE ---
    const [orders, setOrders] = useState([]);
    const [users, setUsers] = useState([]);
    const [categories, setCategories] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [moments, setMoments] = useState([]);

    // UI States
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [audioUnlocked, setAudioUnlocked] = useState(false);
    const [menuSearchQuery, setMenuSearchQuery] = useState(""); 
    
    // Modals
    const [itemModal, setItemModal] = useState({ open: false, mode: 'add', data: null });
    const [catModal, setCatModal] = useState(false);
    const [momentModal, setMomentModal] = useState(false);

    const [selectedTableFilter, setSelectedTableFilter] = useState('All');
    const audioRef = useRef(null);

   // --- ONE SIGNAL PUSH NOTIFICATION SETUP ---
useEffect(() => {
    const setupNotifications = async () => {
        // COMMENT THIS SECTION OUT FOR NOW TO FIX THE CRASH
        /*
        if (isOneSignalInitialized) return;
        try {
            isOneSignalInitialized = true;
            await OneSignal.init({
                appId: "3a830d21-fca2-4484-a905-84bb421754e1", 
                allowLocalhostAsSecureOrigin: true, 
            });
            OneSignal.Slidedown.promptPush();
        } catch (error) {
            console.error("OneSignal Error", error);
        }
        */
        console.log("OneSignal disabled for APK debugging");
    };
    setupNotifications();
}, []);

    // --- AUDIO UNLOCKER ---
    useEffect(() => {
        const unlockAudio = () => {
            if (audioRef.current && !audioUnlocked) {
                audioRef.current.play().then(() => {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                    setAudioUnlocked(true);
                }).catch(() => {});
            }
        };
        document.addEventListener('click', unlockAudio);
        return () => document.removeEventListener('click', unlockAudio);
    }, [audioUnlocked]);

    // --- AUDIO CONTROLS ---
    const playAlert = () => {
        if (audioRef.current && audioRef.current.paused) {
            audioRef.current.currentTime = 0;
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) playPromise.catch(() => {});
        }
    };

    const stopAlert = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
    };

    // --- 1. FETCH ALL DATA ---
    const fetchData = async () => {
        const { data: ord } = await supabase.from('orders').select('*').order('id', { ascending: false });
        if(ord) {
            const formatted = ord.map(o => ({ ...o.order_details, id: o.id, status: o.status, tableNo: o.table_no, total: o.total }));
            setOrders(formatted);
            const hasPending = formatted.some(o => o.status === 'Received');
            if(hasPending) playAlert(); else stopAlert();
        }
        const { data: usr } = await supabase.from('users').select('*').order('joined_at', { ascending: false });
        if(usr) setUsers(usr);
        
        const { data: cats } = await supabase.from('categories').select('*').order('id', { ascending: true });
        if(cats) setCategories(cats);
        
        const { data: items } = await supabase.from('menu_items').select('*').order('id', { ascending: true });
        if(items) setMenuItems(items);
        
        const { data: moms } = await supabase.from('moments').select('*').order('id', { ascending: false });
        if(moms) setMoments(moms);
    };

    useEffect(() => {
        fetchData();
        const channel = supabase.channel('admin-dashboard')
            .on('postgres_changes', { event: '*', schema: 'public' }, () => fetchData())
            .subscribe();
        return () => { supabase.removeChannel(channel); stopAlert(); };
    }, []);

    // --- 2. ORDER ACTIONS ---
    const updateOrder = async (id, updates) => {
        const newOrders = orders.map(o => o.id === id ? { ...o, ...updates } : o);
        setOrders(newOrders);
        if (!newOrders.some(o => o.status === 'Received')) stopAlert();

        const { data: current } = await supabase.from('orders').select('order_details').eq('id', id).single();
        if(current) {
            const newDetails = { ...current.order_details, ...updates };
            await supabase.from('orders').update({ 
                status: updates.status || newOrders.find(o=>o.id===id).status, 
                order_details: newDetails 
            }).eq('id', id);
        }
    };

    const markCashPaid = async (id) => {
        await updateOrder(id, { paymentStatus: 'Paid', paymentMethod: 'Cash' });
    };

    // --- 3. MENU MANAGMENT ---
    const handleSaveItem = async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const file = form.get('image');
        let imgUrl = itemModal.data?.img || "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=200";

        if (file && file.size > 0) {
            try {
                const fileExt = file.name.split('.').pop();
                const fileName = `${Date.now()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('menu_photos').upload(fileName, file);
                if (uploadError) throw uploadError;
                const { data } = supabase.storage.from('menu_photos').getPublicUrl(fileName);
                imgUrl = data.publicUrl;
            } catch (error) {
                alert("Upload failed. Error: " + error.message);
                return;
            }
        }

        const newItem = {
            name: form.get('name'),
            price: `₹${form.get('price')}`,
            description: form.get('desc'),
            category_id: form.get('category'),
            img: imgUrl,
            in_stock: true,
            is_special: false
        };

        if (itemModal.mode === 'add') await supabase.from('menu_items').insert([newItem]);
        else await supabase.from('menu_items').update(newItem).eq('id', itemModal.data.id);
        
        setItemModal({ open: false, mode: 'add', data: null });
    };

    const toggleStock = async (item) => await supabase.from('menu_items').update({ in_stock: !item.in_stock }).eq('id', item.id);
    const toggleSpecial = async (item) => await supabase.from('menu_items').update({ is_special: !item.is_special }).eq('id', item.id);
    const deleteItem = async (id) => { if(confirm('Delete item?')) await supabase.from('menu_items').delete().eq('id', id); };

    // --- 4. CATEGORY & MOMENTS ---
    const handleSaveCategory = async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const file = form.get('image');
        let imgUrl = "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=400";
        if (file && file.size > 0) {
             try {
                const fileExt = file.name.split('.').pop();
                const fileName = `cat_${Date.now()}.${fileExt}`;
                const { error } = await supabase.storage.from('menu_photos').upload(fileName, file);
                if(error) throw error;
                const { data } = supabase.storage.from('menu_photos').getPublicUrl(fileName);
                imgUrl = data.publicUrl;
             } catch(e) { alert("Upload failed: " + e.message); return; }
        }
        await supabase.from('categories').insert([{ name: form.get('name'), img: imgUrl }]);
        setCatModal(false);
    };
    const deleteCategory = async (id) => { if(confirm('Delete Category?')) await supabase.from('categories').delete().eq('id', id); };

    const handleSaveMoment = async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const file = form.get('image');
        let imgUrl = "https://images.unsplash.com/photo-1519671482502-9759101d3361?w=400";
        if (file && file.size > 0) {
             try {
                const fileExt = file.name.split('.').pop();
                const fileName = `mom_${Date.now()}.${fileExt}`;
                const { error } = await supabase.storage.from('menu_photos').upload(fileName, file);
                if(error) throw error;
                const { data } = supabase.storage.from('menu_photos').getPublicUrl(fileName);
                imgUrl = data.publicUrl;
             } catch(e) { alert("Upload failed: " + e.message); return; }
        }
        await supabase.from('moments').insert([{ caption: form.get('caption'), src: imgUrl, type: 'image' }]);
        setMomentModal(false);
    };
    const deleteMoment = async (id) => await supabase.from('moments').delete().eq('id', id);

    // --- HELPERS ---
    const getAnalyticsData = () => {
        const revenueMap = {};
        orders.forEach(o => {
            if (o.status !== 'Cancelled') {
                const day = new Date(o.timestamp).toLocaleDateString('en-US', { weekday: 'short' });
                revenueMap[day] = (revenueMap[day] || 0) + (Number(o.total) || 0);
            }
        });
        return Object.keys(revenueMap).map(day => ({ name: day, sales: revenueMap[day] }));
    };
const requestAllPermissions = async () => {
        try {
            if ('Notification' in window) await Notification.requestPermission();
            navigator.geolocation.getCurrentPosition(() => {});
            alert("Permissions Requested! On your Android: Go to App Info > Permissions > Location > Allow all the time.");
        } catch (err) { alert("Permission Error: " + err.message); }
    };

    const getGroupedHistory = () => {
        const historyOrders = orders.filter(o => o.status === 'Picked Up' || o.status === 'Cancelled');
        const grouped = {};
        historyOrders.forEach(order => {
            const dateKey = order.date || new Date().toLocaleDateString();
            if (!grouped[dateKey]) grouped[dateKey] = [];
            grouped[dateKey].push(order);
        });
        return Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a)).map(date => ({
            date,
            orders: grouped[date].sort((a, b) => (a.tableNo || 0) - (b.tableNo || 0))
        }));
    };

    const getFilteredLiveOrders = () => {
        let live = orders.filter(o => o.status !== 'Picked Up' && o.status !== 'Cancelled');
        if (selectedTableFilter !== 'All') live = live.filter(o => String(o.tableNo) === String(selectedTableFilter));
        return live.sort((a,b) => b.timestamp - a.timestamp);
    };
    const pendingOrders = orders.filter(o => o.status === 'Received').length;

    const filteredCategoriesForMenu = categories.filter(cat => {
        if (!menuSearchQuery) return true;
        const lowerQ = menuSearchQuery.toLowerCase();
        const matchesCat = cat.name.toLowerCase().includes(lowerQ);
        const hasMatchingItem = menuItems.some(i => 
            i.category_id === cat.id && 
            (i.name.toLowerCase().includes(lowerQ) || (i.description && i.description.toLowerCase().includes(lowerQ)))
        );
        return matchesCat || hasMatchingItem;
    });


    return (
        <div className="min-h-screen bg-slate-900 text-white font-sans flex overflow-hidden">
            {/* Dynamic Audio Source */}
            <audio ref={audioRef} loop src={alertTone} />

            {/* --- MODALS --- */}
            {itemModal.open && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10">
                        <h3 className="text-xl font-bold mb-4">{itemModal.mode === 'edit' ? 'Edit Item' : 'Add Item'}</h3>
                        <form onSubmit={handleSaveItem} className="space-y-4">
                            <select name="category" defaultValue={itemModal.data?.category_id} className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white">{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                            <input name="name" defaultValue={itemModal.data?.name} placeholder="Item Name" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required />
                            <input name="price" type="number" defaultValue={itemModal.data?.price?.replace(/\D/g,'')} placeholder="Price" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required />
                            <textarea name="desc" defaultValue={itemModal.data?.description} placeholder="Description" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white"></textarea>
                            <div><label className="text-xs text-gray-400">Image (File)</label><input type="file" name="image" className="w-full mt-1 text-sm text-gray-400" /></div>
                            <div className="flex gap-2"><button type="button" onClick={() => setItemModal({open:false, mode:'add', data:null})} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl">Cancel</button><button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl">Save</button></div>
                        </form>
                    </div>
                </div>
            )}
            {catModal && ( <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"><div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10"><h3 className="text-xl font-bold mb-4">New Category</h3><form onSubmit={handleSaveCategory} className="space-y-4"><input name="name" placeholder="Category Name" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required /><input type="file" name="image" className="w-full text-sm text-gray-400" required /><div className="flex gap-2"><button type="button" onClick={() => setCatModal(false)} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl">Cancel</button><button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl">Create</button></div></form></div></div> )}
            {momentModal && ( <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"><div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10"><h3 className="text-xl font-bold mb-4">Upload Moment</h3><form onSubmit={handleSaveMoment} className="space-y-4"><input name="caption" placeholder="Caption" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required /><input type="file" name="image" className="w-full text-sm text-gray-400" required /><div className="flex gap-2"><button type="button" onClick={() => setMomentModal(false)} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl">Cancel</button><button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl">Upload</button></div></form></div></div> )}

            {/* SIDEBAR */}
            {isSidebarOpen && (<div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm animate-fade-in"></div>)}
            <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-white/10 p-6 flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
                <div className="flex justify-between items-center mb-10"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-cyan-500 rounded-lg flex items-center justify-center font-bold text-black text-xl">{appName.charAt(0).toUpperCase()}</div><div><h1 className="text-md font-bold  font-serif tracking-wide">{appName.toUpperCase()}</h1><p className="text-[10px] text-gray-400 uppercase tracking-widest"></p></div></div><button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-gray-400"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button></div>
                <nav className="space-y-2 flex-1">
                    <SidebarBtn icon="⚡" label="Live Orders" active={activeTab === 'orders'} onClick={() => { setActiveTab('orders'); setIsSidebarOpen(false); }} badge={pendingOrders} />
                    <SidebarBtn icon="💸" label="Transactions" active={activeTab === 'transactions'} onClick={() => { setActiveTab('transactions'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📈" label="Analytics" active={activeTab === 'analytics'} onClick={() => { setActiveTab('analytics'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="👥" label="Users Info" active={activeTab === 'users'} onClick={() => { setActiveTab('users'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="🍔" label="Menu Manager" active={activeTab === 'menu'} onClick={() => { setActiveTab('menu'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📸" label="Moments" active={activeTab === 'moments'} onClick={() => { setActiveTab('moments'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📊" label="History" active={activeTab === 'history'} onClick={() => { setActiveTab('history'); setIsSidebarOpen(false); }} />
                    
                    {/* NEW SETTINGS TAB */}
                    <SidebarBtn icon="⚙️" label="Settings" active={activeTab === 'settings'} onClick={() => { setActiveTab('settings'); setIsSidebarOpen(false); }} />
                </nav>
                <button onClick={onLogout} className="mt-4 flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-xl transition-all"><span className="text-sm font-bold">Logout</span></button>
            </aside>

            <div className="flex-1 flex flex-col h-screen overflow-hidden">
                <header className="md:hidden bg-slate-900 border-b border-white/10 p-4 flex items-center justify-between z-30 sticky top-0"><button onClick={() => setIsSidebarOpen(true)} className="p-2 bg-white/10 rounded-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg></button><span className="font-bold text-[22px] text-cyan-400  tracking-wide">{appName}</span><div className="w-10"></div></header>
                <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-900">
                    
                    {/* TAB: LIVE ORDERS */}
                    {activeTab === 'orders' && ( 
                        <div className="max-w-4xl mx-auto space-y-4">
                            <h2 className="text-2xl font-bold mb-4">Live Orders</h2>
                            {getFilteredLiveOrders().length === 0 && <div className="text-center py-20 text-gray-500">No active orders</div>}
                            {getFilteredLiveOrders().map(order => ( 
                                <div key={order.id} className={`bg-slate-800 p-5 rounded-xl border-l-4 shadow-lg ${order.status === 'Received' ? 'border-yellow-500' : 'border-green-500'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-2xl font-bold">Order #{order.id}</span>
                                                {order.paymentStatus === 'Paid' ? <span className="bg-green-500 text-black text-[10px] font-bold px-2 py-1 rounded">{order.paymentMethod === 'Cash' ? 'CASH PAID' : 'ONLINE PAID'}</span> : <span className="bg-yellow-500 text-black text-[10px] font-bold px-2 py-1 rounded">CASH PENDING</span>}
                                            </div>
                                            <p className="text-sm text-gray-400">Location: {order.tableNo} • {order.customer?.name} • {order.customer?.phone}</p>
                                            {order.paymentId && <p className="text-[10px] text-cyan-400 mt-1 font-mono">Txn ID: {order.paymentId}</p>}
                                        </div>
                                        <div className="text-right"><span className="text-xl font-bold">₹{order.total}</span></div>
                                    </div>
                                    <div className="bg-black/30 p-3 rounded-lg mb-4 text-sm space-y-1">
                                        {Object.entries(order.items || {}).map(([id, qty]) => { 
                                            const item = menuItems.find(i => i.id === parseInt(id)); 
                                            return <div key={id} className="flex justify-between"><span>{item?.name || 'Item'}</span><span className="font-bold">x{qty}</span></div> 
                                        })}
                                    </div>
                                    
                                    <div className="flex gap-3">
                                        {order.status === 'Received' && <button onClick={() => updateOrder(order.id, {status: 'Preparing'})} className="bg-slate-700 hover:bg-cyan-500 hover:text-black px-6 py-3 rounded-lg font-bold flex-1">Accept</button>}
                                        
                                        {order.status === 'Preparing' && <button onClick={() => updateOrder(order.id, {status: 'Ready'})} className="bg-green-600 px-6 py-3 rounded-lg font-bold flex-1">Ready</button>}
                                        
                                        {order.status === 'Ready' && (
                                            <button onClick={() => updateOrder(order.id, {status: 'Picked Up'})} disabled={order.paymentStatus !== 'Paid'} className={`px-6 py-3 rounded-lg font-bold flex-1 transition-all ${order.paymentStatus === 'Paid' ? 'bg-slate-600 hover:bg-slate-500 text-white shadow-lg' : 'bg-slate-800 text-gray-500 cursor-not-allowed border border-white/5'}`}>
                                                {order.paymentStatus === 'Paid' ? 'Complete' : 'Needs Payment'}
                                            </button>
                                        )}

                                        {(order.paymentStatus === 'Pending' || !order.paymentStatus) && ( <button onClick={() => markCashPaid(order.id)} className="bg-green-900/50 text-green-400 px-4 py-2 rounded-lg text-sm border border-green-500/30 hover:bg-green-500 hover:text-black transition">Mark Paid (Cash)</button> )}
                                    </div>
                                </div> 
                            ))}
                        </div> 
                    )}

                    {activeTab === 'transactions' && ( <div className="max-w-6xl mx-auto"><h2 className="text-2xl font-bold mb-6">Financial Transactions</h2><div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 overflow-x-auto"><table className="w-full text-left text-sm text-gray-400 min-w-[800px]"><thead className="bg-black/30 text-white uppercase text-xs"><tr><th className="p-4">Order ID</th><th className="p-4">Date</th><th className="p-4">Customer</th><th className="p-4">Amount</th><th className="p-4">Method</th><th className="p-4">Txn ID</th></tr></thead><tbody>{orders.filter(o => o.paymentStatus === 'Paid').map(order => ( <tr key={order.id} className="border-b border-white/5 hover:bg-white/5"><td className="p-4 font-mono text-white">{order.id}</td><td className="p-4">{order.date}</td><td className="p-4">{order.customer?.name}</td><td className="p-4 font-bold text-green-400">₹{order.total}</td><td className="p-4"><span className={`px-2 py-1 rounded text-xs font-bold ${order.paymentMethod?.includes('Online') ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>{order.paymentMethod || 'Cash'}</span></td><td className="p-4 font-mono text-xs text-gray-500">{order.paymentId || '-'}</td></tr> ))}</tbody></table></div></div> )}
                    {activeTab === 'analytics' && ( <div className="max-w-6xl mx-auto"><h2 className="text-2xl font-bold mb-6">Sales Overview</h2><div className="bg-slate-800 p-6 rounded-xl border border-white/10 h-[400px] w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={getAnalyticsData()}><CartesianGrid strokeDasharray="3 3" stroke="#444" /><XAxis dataKey="name" stroke="#888" /><YAxis stroke="#888" /><Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} /><Bar dataKey="sales" fill="#06b6d4" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div> )}
                    {activeTab === 'users' && ( <div className="max-w-6xl mx-auto"><h2 className="text-2xl font-bold mb-6">Registered Users</h2><div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 overflow-x-auto"><table className="w-full text-sm text-left text-gray-400 min-w-[600px]"><thead className="text-xs text-gray-200 uppercase bg-black/30"><tr><th className="p-4">Name</th><th className="p-4">Phone</th><th className="p-4">Joined</th><th className="p-4">Orders</th></tr></thead><tbody>{users.map((u, idx) => <tr key={idx} className="border-b border-white/5 hover:bg-white/5"><td className="p-4 font-bold text-white capitalize">{u.name}</td><td className="p-4 font-mono text-cyan-400">{u.phone}</td><td className="p-4">{u.joined_at || 'N/A'}</td><td className="p-4"><span className="bg-white/10 px-2 py-1 rounded text-xs font-bold text-white">{u.total_orders || 0}</span></td></tr>)}</tbody></table></div></div> )}
                    {activeTab === 'menu' && ( 
                        <div className="max-w-4xl mx-auto">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                                <h2 className="text-2xl font-bold">Stock Manager</h2>
                                <div className="flex gap-2 w-full md:w-auto">
                                    <button onClick={() => setCatModal(true)} className="flex-1 md:flex-none bg-slate-700 hover:bg-white hover:text-black px-4 py-2 rounded-lg text-sm font-bold transition">+ Category</button>
                                    <button onClick={() => setItemModal({open:true, mode:'add', data:null})} className="flex-1 md:flex-none bg-cyan-500 text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-cyan-400 transition">+ Item</button>
                                </div>
                            </div>
                            <div className="mb-6">
                                <div className="relative">
                                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-gray-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></span>
                                    <input type="text" placeholder="Search categories or items..." value={menuSearchQuery} onChange={(e) => setMenuSearchQuery(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-white focus:border-cyan-500 outline-none placeholder-gray-500 transition" />
                                    {menuSearchQuery && ( <button onClick={() => setMenuSearchQuery("")} className="absolute inset-y-0 right-0 flex items-center pr-4 text-gray-400 hover:text-white">✕</button> )}
                                </div>
                            </div>
                            <div className="space-y-6">
                                {filteredCategoriesForMenu.length === 0 ? ( <div className="text-center py-12 bg-slate-800/30 rounded-xl border border-white/5"><p className="text-gray-400 font-bold">No categories or items found for "{menuSearchQuery}"</p></div> ) : (
                                    filteredCategoriesForMenu.map(cat => ( 
                                        <div key={cat.id} className="bg-slate-800/50 rounded-xl p-6 border border-white/5">
                                            <div className="flex justify-between items-center border-b border-white/10 pb-2 mb-4">
                                                <h3 className="text-xl font-bold text-cyan-400">{cat.name}</h3>
                                                <button onClick={() => deleteCategory(cat.id)} className="text-red-400 text-xs hover:text-red-300">Delete Category</button>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {menuItems.filter(item => {
                                                    if (!menuSearchQuery) return item.category_id === cat.id;
                                                    const lowerQ = menuSearchQuery.toLowerCase();
                                                    return item.category_id === cat.id && (cat.name.toLowerCase().includes(lowerQ) || item.name.toLowerCase().includes(lowerQ) || (item.description && item.description.toLowerCase().includes(lowerQ)));
                                                }).map((item, idx) => ( 
                                                    <div key={idx} className={`flex items-center gap-3 bg-black/20 p-3 rounded-xl border ${item.in_stock === false ? 'border-red-500/30 opacity-75' : 'border-white/5 hover:border-white/10 transition'}`}>
                                                        <img src={item.img} className={`w-12 h-12 rounded-lg object-cover ${item.in_stock === false ? 'grayscale' : ''}`} />
                                                        <div className="flex-1 min-w-0"><h4 className="font-bold text-sm truncate">{item.name} {item.is_special && '⭐'}</h4><p className="text-xs text-gray-500">{item.price}</p></div>
                                                        <div className="flex gap-2"><button onClick={() => toggleSpecial(item)} className={`p-2 rounded text-xs ${item.is_special ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400'}`}>★</button><button onClick={() => setItemModal({open:true, mode:'edit', data:item})} className="text-xs bg-blue-500/10 text-blue-400 p-2 rounded hover:bg-blue-500 hover:text-white">✏️</button><button onClick={() => toggleStock(item)} className={`text-[10px] font-bold px-2 py-1 rounded transition ${item.in_stock !== false ? 'bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-black' : 'bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white'}`}>{item.in_stock !== false ? 'In' : 'Out'}</button><button onClick={() => deleteItem(item.id)} className="text-xs bg-red-500/10 text-red-400 p-2 rounded hover:bg-red-500 hover:text-white">🗑</button></div>
                                                    </div> 
                                                ))}
                                            </div>
                                        </div> 
                                    ))
                                )}
                            </div>
                        </div> 
                    )}
                    {activeTab === 'moments' && ( <div className="max-w-5xl mx-auto"><div className="flex justify-between items-center mb-6"><h2 className="text-2xl font-bold">Moments Gallery</h2><button onClick={() => setMomentModal(true)} className="bg-cyan-500 text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-cyan-400 transition">+ Upload Moment</button></div><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{moments.map(m => ( <div key={m.id} className="relative group rounded-xl overflow-hidden aspect-[3/4]"><img src={m.src} className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div><p className="absolute bottom-2 left-2 text-xs font-bold text-white z-10">{m.caption}</p><button onClick={() => deleteMoment(m.id)} className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition">Delete</button></div> ))}</div></div> )}
                    {activeTab === 'history' && ( <div className="max-w-6xl mx-auto"><h2 className="text-2xl font-bold mb-6">Order History</h2><div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 overflow-x-auto"><table className="w-full text-sm text-left text-gray-400 min-w-[800px]"><thead className="text-xs text-gray-200 uppercase bg-black/30"><tr><th className="p-4">ID</th><th className="p-4">Time</th><th className="p-4">Location</th><th className="p-4">Amount</th><th className="p-4">Method</th><th className="p-4">Txn ID</th><th className="p-4">Status</th></tr></thead><tbody>{getGroupedHistory().map(group => ( group.orders.map(order => ( <tr key={order.id} className="border-b border-white/5 hover:bg-white/5 transition"><td className="p-4 font-bold text-white">{order.id}</td><td className="p-4">{order.time}</td><td className="p-4">{order.tableNo} • {order.customer?.name}</td><td className="p-4 text-green-400 font-bold">₹{order.total}</td><td className="p-4"><span className={`px-2 py-1 rounded text-xs font-bold ${order.paymentMethod?.includes('Online') ? 'bg-blue-500/20 text-blue-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{order.paymentMethod || 'Cash'}</span></td><td className="p-4 font-mono text-xs text-gray-500">{order.paymentId || '-'}</td><td className="p-4"><span className={`px-2 py-1 rounded text-xs font-bold ${order.status === 'Picked Up' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{order.status}</span></td></tr> )) ))}</tbody></table></div></div> )}
                    
                    {/* --- NEW SETTINGS TAB --- */}
                    {activeTab === 'settings' && (
                        <div className="max-w-4xl mx-auto space-y-8 pb-10">
                            <h2 className="text-2xl font-bold mb-6">App Settings</h2>

                            {/* App Name Editor */}
                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg">
                                <h3 className="text-xl font-bold mb-2">App Name</h3>
                                <p className="text-sm text-gray-400 mb-4">Change the name displayed in the sidebar and header.</p>
                                <div className="flex gap-4 max-w-sm">
                                    <input type="text" id="appNameInput" defaultValue={appName} className="flex-1 bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none transition" />
                                    <button onClick={() => {
                                        const newName = document.getElementById('appNameInput').value;
                                        setAppName(newName);
                                        localStorage.setItem('valo_app_name', newName);
                                        alert("App name successfully updated!");
                                    }} className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6 py-3 rounded-lg transition">Save</button>
                                </div>
                            </div>

                            {/* Alert Tone Editor */}
                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg">
                                <h3 className="text-xl font-bold mb-2">Custom Alert Tone</h3>
                                <p className="text-sm text-gray-400 mb-4">Upload a short audio file (MP3, WAV) to loop when a new order arrives. (Stored locally on your device).</p>
                                <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                                    <input type="file" accept="audio/*" onChange={(e) => {
                                        const file = e.target.files[0];
                                        if(file) {
                                            const reader = new FileReader();
                                            reader.onloadend = () => {
                                                setAlertTone(reader.result);
                                                localStorage.setItem('valo_alert_tone', reader.result);
                                                alert("Alert tone updated!");
                                            };
                                            reader.readAsDataURL(file);
                                        }
                                    }} className="block w-full max-w-sm text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-cyan-500 file:text-black hover:file:bg-cyan-400 cursor-pointer" />
                                    
                                    <div className="flex gap-2 w-full md:w-auto">
                                        <button onClick={() => {
                                            if (audioRef.current) {
                                                audioRef.current.currentTime = 0;
                                                audioRef.current.play().catch(() => alert("Click anywhere on the screen first to unlock audio testing."));
                                                setTimeout(() => { if(audioRef.current) audioRef.current.pause(); }, 3000);
                                            }
                                        }} className="flex-1 md:flex-none bg-slate-700 hover:bg-slate-600 px-6 py-2 rounded-lg text-sm font-bold transition">Test Tone</button>
                                        
                                        <button onClick={() => {
                                            const defaultTone = 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg';
                                            setAlertTone(defaultTone);
                                            localStorage.removeItem('valo_alert_tone');
                                        }} className="flex-1 md:flex-none bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white px-6 py-2 rounded-lg text-sm font-bold transition">Reset Default</button>
                                    </div>
                                </div>
                            </div>

                            {/* PIN Change Editor */}
                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg">
                                <h3 className="text-xl font-bold mb-2">Change Admin PIN</h3>
                                <p className="text-sm text-gray-400 mb-4">Update the 4-digit code required to unlock this dashboard.</p>
                                <form onSubmit={(e) => {
                                    e.preventDefault();
                                    const currentPin = localStorage.getItem('valo_admin_pin') || '1234';
                                    const oldPin = e.target.oldPin.value;
                                    const newPin = e.target.newPin.value;
                                    
                                    if(oldPin !== currentPin) {
                                        alert("Old PIN is incorrect!");
                                        return;
                                    }
                                    if(newPin.length < 4) {
                                        alert("New PIN must be exactly 4 digits.");
                                        return;
                                    }
                                    
                                    localStorage.setItem('valo_admin_pin', newPin);
                                    alert("Admin PIN successfully changed!");
                                    e.target.reset();
                                }} className="space-y-4 max-w-sm">
                                    <input name="oldPin" type="password" placeholder="Current PIN" maxLength="4" autoComplete="new-password" required className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white tracking-widest text-center focus:border-cyan-500 outline-none transition" />
                                    <input name="newPin" type="password" placeholder="New PIN" maxLength="4" autoComplete="new-password" required className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white tracking-widest text-center focus:border-cyan-500 outline-none transition" />
                                    <button type="submit" className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6 py-3 rounded-lg shadow-lg shadow-cyan-500/20 transition">Update PIN</button>
                                </form>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

function SidebarBtn({ icon, label, active, onClick, badge }) { return (<button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-cyan-500 text-black font-bold shadow-lg shadow-cyan-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}><span className="text-lg">{icon}</span><span className="flex-1 text-left text-sm">{label}</span>{badge > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-bounce">{badge}</span>}</button>); }