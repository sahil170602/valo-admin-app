import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function AdminPanel() {
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('valo_admin_auth') === 'true');

    useEffect(() => {
        const initOneSignal = async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (window.plugins && window.plugins.OneSignal) {
                window.plugins.OneSignal.initialize("3a830d21-fca2-4484-a905-84bb421754e1");
                window.plugins.OneSignal.Notifications.requestPermission(true);
                window.plugins.OneSignal.Notifications.addEventListener("foregroundWillDisplay", (event) => {
                    event.getNotification().display(); 
                });
            }
        };
        initOneSignal();
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => { setIsLoading(false); }, 3000);
        return () => clearTimeout(timer);
    }, []);

    if (isLoading) return <SplashScreen />;
    if (!isAuthenticated) return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;

    return <AdminDashboard onLogout={() => setIsAuthenticated(false)} />;
}

// --- SPLASH SCREEN ---
function SplashScreen() {
    const logoUrl = '/splash.png'; 
    return (
        <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center overflow-hidden relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] animate-pulse"></div>
            <div className="relative z-10 flex flex-col items-center">
                <div className="w-28 h-28 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] flex items-center justify-center shadow-2xl relative mb-8">
                    <div className="absolute inset-0 bg-cyan-500/20 blur-2xl opacity-50 rounded-[2.5rem]"></div>
                    <img src={logoUrl} alt="Logo" className="w-28 h-28 object-contain drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]" onError={(e) => { e.target.src = "splash.png" }} />
                </div>
                <h1 className="text-4xl font-black tracking-[0.2em] text-white text-center mb-2">VALO<span className="text-cyan-400"></span></h1>
                <p className="text-gray-400 tracking-[0em] text-[18px] font-bold animate-pulse">Experience</p>
                <div className="mt-12 w-48 h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 w-1/2 animate-loading-slide"></div></div>
            </div>
        </div>
    );
}

// --- LOGIN SCREEN ---
function AdminLogin({ onLogin }) {
    const [pin, setPin] = useState("");
    const [error, setError] = useState(false);
    const logoUrl = 'splash.png';

    const handleSubmit = (e) => {
        e.preventDefault();
        const currentPin = localStorage.getItem('valo_admin_pin') || '1234';
        if (pin === currentPin) {
            localStorage.setItem('valo_admin_auth', 'true');
            onLogin();
        } else {
            setError(true); setPin("");
            setTimeout(() => setError(false), 500);
        }
    };
    
    return (
        <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-4">
            <div className={`w-full max-w-sm bg-slate-800 border border-white/10 p-10 rounded-[3rem] shadow-2xl text-center transition-all ${error ? 'animate-shake border-red-500' : ''}`}>
                <div className="w-28 h-28 bg-white/5 rounded-3xl mx-auto flex items-center justify-center mb-8 shadow-xl border border-white/5 relative">
                     <img src={logoUrl} alt="Logo" className="w-28 h-28 object-contain" onError={(e) => { e.target.src = "./icon.png" }} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-1 uppercase tracking-tight">Access Locked</h2>
                <p className="text-gray-500 text-xs mb-8 uppercase font-bold tracking-widest text-[10px]">Security Protocols Active</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" placeholder="••••" maxLength="4" autoFocus className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-5 text-center text-white text-3xl tracking-[0.5em] focus:outline-none focus:border-cyan-500 transition-all" />
                    <button type="submit" className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-black py-4 rounded-2xl hover:opacity-90 transition-all shadow-lg active:scale-95 text-md tracking-wide">Verify PIN</button>
                </form>
            </div>
        </div>
    );
}

// --- MAIN DASHBOARD ---
function AdminDashboard({ onLogout }) {
    const [activeTab, setActiveTab] = useState('create_bill'); 
    
    const [appName, setAppName] = useState(() => localStorage.getItem('valo_app_name') || 'VALO');
    const [alertTone, setAlertTone] = useState(() => localStorage.getItem('valo_alert_tone') || 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg');

    const [orders, setOrders] = useState([]);
    const [users, setUsers] = useState([]);
    const [categories, setCategories] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [moments, setMoments] = useState([]);

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [audioUnlocked, setAudioUnlocked] = useState(false);
    const [menuSearchQuery, setMenuSearchQuery] = useState(""); 
    
    // Create Bill (POS) States
    const [billCustomerName, setBillCustomerName] = useState('');
    const [billCustomerPhone, setBillCustomerPhone] = useState('');
    const [billTableNo, setBillTableNo] = useState('Counter');
    const [billItemsList, setBillItemsList] = useState([]);
    const [billItemSearch, setBillItemSearch] = useState('');
    const [billItemPrice, setBillItemPrice] = useState('');
    const [billItemQty, setBillItemQty] = useState(1);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [selectedMenuId, setSelectedMenuId] = useState(null);
    
    // Live Order Custom Item Form
    const [addingItemTo, setAddingItemTo] = useState(null);
    const [customItemForm, setCustomItemForm] = useState({ name: '', qty: 1, price: '', menuId: null });

    // Modals
    const [itemModal, setItemModal] = useState({ open: false, mode: 'add', data: null });
    const [catModal, setCatModal] = useState(false);
    const [momentModal, setMomentModal] = useState({ open: false, mode: 'add', data: null });
    
    // Payment Modal State
    const [adminPaymentModal, setAdminPaymentModal] = useState({ open: false, orderId: null });

    // Analytics & Transactions State
    const [analyticsFilter, setAnalyticsFilter] = useState('Today'); // Today, Weekly, Monthly, Yearly, All
    const [transactionPage, setTransactionPage] = useState(1);

    const [selectedTableFilter, setSelectedTableFilter] = useState('All');
    const audioRef = useRef(null);

    useEffect(() => {
        const setupNativeNotifications = async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (window.plugins && window.plugins.OneSignal) {
                window.plugins.OneSignal.initialize("3a830d21-fca2-4484-a905-84bb421754e1");
                window.plugins.OneSignal.Notifications.requestPermission(true);
                window.plugins.OneSignal.Notifications.addEventListener("foregroundWillDisplay", (event) => {
                    event.getNotification().display(); 
                });
            }
        };
        setupNativeNotifications();
    }, []);

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

    const updateOrder = async (id, updates) => {
        const newOrders = orders.map(o => o.id === id ? { ...o, ...updates } : o);
        setOrders(newOrders);
        if (!newOrders.some(o => o.status === 'Received')) stopAlert();

        const { data: current } = await supabase.from('orders').select('order_details, total, status').eq('id', id).single();
        if(current) {
            const newDetails = { ...current.order_details, ...updates };
            
            const dbPayload = { 
                status: updates.status || current.status, 
                order_details: newDetails 
            };

            if (updates.total !== undefined) {
                dbPayload.total = updates.total;
            }

            await supabase.from('orders').update(dbPayload).eq('id', id);
        }
    };

    const deleteOrder = async (id) => { 
        if(confirm('Are you sure you want to permanently delete this order?')) {
            const { error } = await supabase.from('orders').delete().eq('id', id); 
            if (error) alert("Error deleting order: " + error.message);
            else setOrders(prev => prev.filter(o => o.id !== id));
        }
    };

    const handleAdminMarkPaid = async (method) => {
        if (adminPaymentModal.orderId) {
            await updateOrder(adminPaymentModal.orderId, { paymentStatus: 'Paid', paymentMethod: method });
        }
        setAdminPaymentModal({ open: false, orderId: null });
    };

    const toggleItemReady = async (order, itemKey) => {
        const currentStatuses = order.itemStatuses || {};
        const isCurrentlyReady = !!currentStatuses[itemKey];
        const updatedStatuses = { ...currentStatuses, [itemKey]: !isCurrentlyReady };
        await updateOrder(order.id, { itemStatuses: updatedStatuses });
    };

    // --- LIVE ORDER ITEM QTY EDITOR ---
    const updateLiveOrderItemQty = async (orderId, itemKey, isCustom, newQty) => {
        if (newQty < 1) return;
        
        const order = orders.find(o => o.id === orderId);
        if (!order) return;

        let updatedRegularItems = { ...(order.items || {}) };
        let updatedCustomItems = [...(order.customItems || [])];
        let priceDiff = 0;

        if (isCustom) {
            updatedCustomItems = updatedCustomItems.map(cItem => {
                if (cItem.id === itemKey) {
                    priceDiff = (newQty - cItem.qty) * Number(cItem.price);
                    return { ...cItem, qty: newQty };
                }
                return cItem;
            });
        } else {
            const menuId = itemKey.replace('menu_', '');
            const oldQty = updatedRegularItems[menuId] || 1;
            updatedRegularItems[menuId] = newQty;
            
            const mItem = menuItems.find(i => i.id === parseInt(menuId));
            const price = mItem ? parseInt(mItem.price.replace(/[^0-9]/g, '')) : 0;
            priceDiff = (newQty - oldQty) * price;
        }

        const newTotal = Number(order.total || 0) + priceDiff;

        await updateOrder(orderId, { 
            customItems: updatedCustomItems, 
            items: updatedRegularItems,
            total: newTotal 
        });
    };

    // --- REMOVE LIVE ORDER ITEM LOGIC ---
    const removeLiveOrderItem = async (orderId, itemKey, isCustom) => {
        if (!confirm('Are you sure you want to remove this item from the order?')) return;
        
        const order = orders.find(o => o.id === orderId);
        if (!order) return;

        let updatedRegularItems = { ...(order.items || {}) };
        let updatedCustomItems = [...(order.customItems || [])];
        let priceDiff = 0;

        if (isCustom) {
            const cItem = updatedCustomItems.find(c => c.id === itemKey);
            if (cItem) {
                priceDiff = -(Number(cItem.qty) * Number(cItem.price));
                updatedCustomItems = updatedCustomItems.filter(c => c.id !== itemKey);
            }
        } else {
            const menuId = itemKey.replace('menu_', '');
            const oldQty = updatedRegularItems[menuId] || 0;
            const mItem = menuItems.find(i => i.id === parseInt(menuId));
            const price = mItem ? parseInt(mItem.price.replace(/[^0-9]/g, '')) : 0;
            priceDiff = -(oldQty * price);
            delete updatedRegularItems[menuId];
        }

        const newTotal = Math.max(0, Number(order.total || 0) + priceDiff);

        const updatedStatuses = { ...(order.itemStatuses || {}) };
        delete updatedStatuses[itemKey];

        await updateOrder(orderId, { 
            customItems: updatedCustomItems, 
            items: updatedRegularItems,
            itemStatuses: updatedStatuses,
            total: newTotal 
        });
    };

    // --- ADD ITEM TO EXISTING LIVE ORDER LOGIC ---
    const handleAddCustomItem = async (orderId) => {
        const order = orders.find(o => o.id === orderId);
        if (!order || !customItemForm.name || !customItemForm.price) return;

        const qty = Number(customItemForm.qty) || 1;
        const price = Number(customItemForm.price) || 0;

        let updatedCustomItems = order.customItems || [];
        let updatedRegularItems = { ...(order.items || {}) };

        if (customItemForm.menuId) {
            updatedRegularItems[customItemForm.menuId] = (updatedRegularItems[customItemForm.menuId] || 0) + qty;
        } else {
            const newItem = {
                id: `custom_${Date.now()}`,
                name: customItemForm.name,
                qty: qty,
                price: price
            };
            updatedCustomItems = [...updatedCustomItems, newItem];
        }

        const newTotal = Number(order.total || 0) + (qty * price);

        await updateOrder(order.id, { 
            customItems: updatedCustomItems, 
            items: updatedRegularItems,
            total: newTotal 
        });
        
        setAddingItemTo(null);
        setCustomItemForm({ name: '', qty: 1, price: '', menuId: null });
    };

    const handleSelectSuggestion = (item) => {
        setBillItemSearch(item.name);
        setBillItemPrice(parseInt(item.price.replace(/[^0-9]/g, '')) || 0);
        setSelectedMenuId(item.id);
        setShowSuggestions(false);
    };

    const handleAddBillItem = () => {
        if (!billItemSearch || !billItemPrice || billItemQty < 1) return;
        const newItem = {
            uniqueId: Date.now(),
            menuId: selectedMenuId, 
            name: billItemSearch,
            price: Number(billItemPrice),
            qty: Number(billItemQty)
        };
        setBillItemsList([...billItemsList, newItem]);
        
        setBillItemSearch('');
        setBillItemPrice('');
        setBillItemQty(1);
        setSelectedMenuId(null);
        setShowSuggestions(false);
    };

    const updateBillItemQty = (uniqueId, newQty) => {
        if (newQty < 1) return;
        setBillItemsList(billItemsList.map(item => 
            item.uniqueId === uniqueId ? { ...item, qty: newQty } : item
        ));
    };

    // --- SMART AUTO-MERGE POS LOGIC ---
    const handleCreateAndPrintBill = async () => {
        const regularItems = {};
        const customItems = [];
        let addedTotal = 0;

        billItemsList.forEach(item => {
            addedTotal += item.price * item.qty;
            if (item.menuId) {
                regularItems[item.menuId] = (regularItems[item.menuId] || 0) + item.qty;
            } else {
                customItems.push({
                    id: `custom_${Date.now()}_${Math.random()}`,
                    name: item.name,
                    qty: item.qty,
                    price: item.price
                });
            }
        });

        // Search for an existing live order to merge into
        let existingOrder = orders.find(o => {
            const isActive = ['Received', 'Preparing', 'Ready'].includes(o.status);
            if (!isActive) return false;

            const isSameTable = billTableNo && String(billTableNo).toLowerCase() !== 'counter' && String(o.tableNo).toLowerCase() === String(billTableNo).toLowerCase();
            const inputPhone = billCustomerPhone ? String(billCustomerPhone).trim() : null;
            const orderPhone = o.customer?.phone ? String(o.customer.phone).trim() : null;
            const isSamePhone = inputPhone && orderPhone && inputPhone === orderPhone;

            return isSameTable || isSamePhone;
        });

        if (existingOrder) {
            const { data: dbOrder } = await supabase.from('orders').select('*').eq('id', existingOrder.id).single();
            
            if (dbOrder) {
                const orderDetails = dbOrder.order_details || {};
                const mergedRegularItems = { ...(orderDetails.items || {}) };
                
                Object.entries(regularItems).forEach(([id, qty]) => {
                    mergedRegularItems[id] = (mergedRegularItems[id] || 0) + qty;
                });

                const mergedCustomItems = [...(orderDetails.customItems || []), ...customItems];
                const mergedTotal = Number(dbOrder.total || 0) + addedTotal;

                const updatedDetails = {
                    ...orderDetails,
                    items: mergedRegularItems,
                    customItems: mergedCustomItems
                };

                const { error } = await supabase.from('orders').update({
                    total: mergedTotal,
                    order_details: updatedDetails
                }).eq('id', dbOrder.id);

                if (error) {
                    alert("Error merging bill.");
                } else {
                    alert(`Successfully merged into active Order #${dbOrder.id}`);
                    printBill({ ...updatedDetails, id: dbOrder.id, status: dbOrder.status, tableNo: dbOrder.table_no, total: mergedTotal });
                    resetPOS();
                }
            }
        } else {
            const orderPayload = {
                status: 'Ready', 
                table_no: billTableNo || 'Counter',
                total: addedTotal,
                customer_phone: billCustomerPhone || 'Walk-in',
                order_details: {
                    date: new Date().toLocaleDateString(),
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    timestamp: Date.now(),
                    items: regularItems,
                    customItems: customItems,
                    paymentMethod: 'Cash', 
                    paymentStatus: 'Pending', 
                    customer: { name: billCustomerName || 'Walk-in', phone: billCustomerPhone || '' },
                    prepTime: null
                }
            };

            const { data, error } = await supabase.from('orders').insert([orderPayload]).select();
            
            if (error) {
                alert("Error creating bill.");
            } else {
                if (data && data.length > 0) {
                     const newOrder = { ...data[0].order_details, id: data[0].id, status: data[0].status, tableNo: data[0].table_no, total: data[0].total };
                     printBill(newOrder); 
                }
                resetPOS();
            }
        }
    };

    const resetPOS = () => {
        setBillCustomerName('');
        setBillCustomerPhone('');
        setBillTableNo('Counter');
        setBillItemsList([]);
        setActiveTab('orders');
    };

    // --- PRINT BILL LOGIC ---
    const printBill = (order) => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const itemsArr = Object.entries(order.items || {});
        const customItems = order.customItems || [];
        
        let totalQty = itemsArr.reduce((sum, [id, qty]) => sum + Number(qty), 0);
        totalQty += customItems.reduce((sum, item) => sum + Number(item.qty), 0);

        let itemsHtml = itemsArr.map(([id, qty]) => {
            const item = menuItems.find(i => i.id === parseInt(id));
            const name = item ? item.name : 'Deleted Item';
            const priceStr = item ? item.price : '₹0';
            const numericPrice = parseInt(priceStr.replace(/[^0-9]/g, '')) || 0;
            const lineTotal = numericPrice * Number(qty);
            return `<tr><td class="qty">${qty}x</td><td class="item"><span>${name}</span><div style="font-size: 9px; opacity: 0.85;">@ ${priceStr}</div></td><td class="amount" style="text-align: right;">₹${lineTotal}</td></tr>`;
        }).join('');

        if (customItems.length > 0) {
            itemsHtml += customItems.map(cItem => {
                const lineTotal = cItem.price * cItem.qty;
                return `<tr><td class="qty">${cItem.qty}x</td><td class="item"><span>${cItem.name} *</span><div style="font-size: 9px; opacity: 0.85;">@ ₹${cItem.price}</div></td><td class="amount" style="text-align: right;">₹${lineTotal}</td></tr>`;
            }).join('');
        }

        const content = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Bill - Order #${order.displayId || order.id}</title>
                <style media="print">@page { size: 58mm auto; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; } .receipt-container { width: 58mm; padding: 3mm; color: #000; font-family: Courier New, monospace; font-size: 11px; box-sizing: border-box; font-weight: 900 !important; } .receipt-container * { font-weight: 900 !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }</style>
                <style>.receipt-container { width: 58mm; padding: 3mm; background: #fff; color: #000; font-family: Courier New, monospace; font-size: 11px; line-height: 1.35; box-sizing: border-box; font-weight: 900 !important; } .receipt-container * { font-weight: 900 !important; } .center { text-align: center; } .bold { font-weight: 900 !important; } .divider { border-top: 1px dashed #000; margin: 6px 0; } .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; } table { width: 100%; border-collapse: collapse; } td, th { vertical-align: top; padding: 2px 0; } .qty { width: 15%; } .item { width: 55%; word-break: break-word; } .amount { width: 30%; text-align: right; }</style>
            </head>
            <body>
                <div class="receipt-container">
                    <div class="center bold" style="font-size: 16px;">VALO HOTEL</div>
                    <div class="center">Order Receipt</div>
                    <div class="divider"></div>
                    <div class="row"><span>Order</span><span>#${order.displayId || order.id}</span></div>
                    <div class="row"><span>Table</span><span>${order.tableNo}</span></div>
                    <div class="row"><span>Date</span><span>${order.date || new Date().toLocaleDateString()}</span></div>
                    <div class="row"><span>Time</span><span>${order.time || new Date().toLocaleTimeString()}</span></div>
                    ${order.customer?.name && order.customer.name !== 'Walk-in' ? `<div class="row"><span>Name</span><span>${order.customer.name}</span></div>` : ''}
                    ${order.customer?.phone && order.customer.phone !== 'Walk-in' ? `<div class="row"><span>Phone</span><span>${order.customer.phone}</span></div>` : ''}
                    <div class="divider"></div>
                    <table><thead><tr style="border-bottom: 1px dashed #000;"><th style="text-align: left; font-size: 10px;">QTY</th><th style="text-align: left; font-size: 10px;">ITEM (RATE)</th><th style="text-align: right; font-size: 10px;">AMT</th></tr></thead><tbody>${itemsHtml}</tbody></table>
                    <div class="divider"></div>
                    <div class="row"><span>Total Items</span><span>${totalQty}</span></div>
                    <div class="row"><span>Grand Total</span><span>₹${order.total}</span></div>
                    <div class="row" style="font-size: 10px; margin-top: 4px;"><span>Payment Status</span><span>${order.paymentStatus === 'Paid' ? `Paid (${order.paymentMethod || 'Cash'})` : 'Pending'}</span></div>
                    <div class="divider"></div>
                    <div class="center">Thank You! Visit Again.</div>
                    <div class="center" style="font-size: 9px; margin-top: 4px;">Printed via Valo Ecosystem</div>
                </div>
            </body>
            </html>
        `;

        iframe.contentWindow.document.open(); iframe.contentWindow.document.write(content); iframe.contentWindow.document.close();
        setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => { document.body.removeChild(iframe); }, 2000); }, 500);
    };

    // --- WHATSAPP PDF GENERATION & SHARE LOGIC ---
    const sendWhatsAppPDF = async (order, e) => {
        const btn = e.currentTarget;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="animate-pulse font-bold text-[10px]">PDF...</span>';
        btn.disabled = true;

        try {
            // 1. Load html2pdf dynamically if not present
            if (!window.html2pdf) {
                const script = document.createElement('script');
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
                document.body.appendChild(script);
                await new Promise((resolve) => { script.onload = resolve; });
            }

            // 2. Build the HTML template
            const itemsArr = Object.entries(order.items || {});
            const customItems = order.customItems || [];
            let totalQty = itemsArr.reduce((sum, [id, qty]) => sum + Number(qty), 0);
            totalQty += customItems.reduce((sum, item) => sum + Number(item.qty), 0);

            let itemsHtml = itemsArr.map(([id, qty]) => {
                const item = menuItems.find(i => i.id === parseInt(id));
                const name = item ? item.name : 'Item';
                const priceStr = item ? item.price : '₹0';
                const numericPrice = parseInt(priceStr.replace(/[^0-9]/g, '')) || 0;
                const lineTotal = numericPrice * Number(qty);
                return `<tr><td style="padding: 6px 0; border-bottom: 1px solid #ddd;">${qty}x</td><td style="padding: 6px 0; border-bottom: 1px solid #ddd;">${name}<br><span style="font-size:10px;color:#666;">@ ${priceStr}</span></td><td style="padding: 6px 0; text-align:right; border-bottom: 1px solid #ddd;">₹${lineTotal}</td></tr>`;
            }).join('');

            if (customItems.length > 0) {
                itemsHtml += customItems.map(cItem => {
                    const lineTotal = cItem.price * cItem.qty;
                    return `<tr><td style="padding: 6px 0; border-bottom: 1px solid #ddd;">${cItem.qty}x</td><td style="padding: 6px 0; border-bottom: 1px solid #ddd;">${cItem.name} *<br><span style="font-size:10px;color:#666;">@ ₹${cItem.price}</span></td><td style="padding: 6px 0; text-align:right; border-bottom: 1px solid #ddd;">₹${lineTotal}</td></tr>`;
                }).join('');
            }

            // Create temporary hidden container for the PDF
            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            container.innerHTML = `
                <div style="width: 320px; padding: 20px; font-family: sans-serif; color: #000; background: #fff;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="margin: 0; font-size: 24px; font-weight: 900;">VALO HOTEL</h2>
                        <p style="margin: 5px 0 0; font-size: 14px; color: #555;">Order Receipt</p>
                    </div>
                    <div style="margin-bottom: 20px; font-size: 13px; line-height: 1.6;">
                        <div style="display:flex; justify-content:space-between;"><strong>Order ID:</strong> <span>#${order.displayId || order.id}</span></div>
                        <div style="display:flex; justify-content:space-between;"><strong>Date:</strong> <span>${order.date || new Date().toLocaleDateString()} ${order.time || ''}</span></div>
                        <div style="display:flex; justify-content:space-between;"><strong>Customer:</strong> <span>${order.customer?.name || 'Walk-in'}</span></div>
                        <div style="display:flex; justify-content:space-between;"><strong>Phone:</strong> <span>${order.customer?.phone || 'N/A'}</span></div>
                    </div>
                    <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr>
                                <th style="text-align:left; border-bottom: 2px solid #000; padding-bottom: 5px;">Qty</th>
                                <th style="text-align:left; border-bottom: 2px solid #000; padding-bottom: 5px;">Item</th>
                                <th style="text-align:right; border-bottom: 2px solid #000; padding-bottom: 5px;">Amt</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                    <div style="font-size: 14px; margin-bottom: 20px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom: 5px;"><span>Total Items:</span> <span>${totalQty}</span></div>
                        <div style="display:flex; justify-content:space-between; font-weight: 900; font-size: 18px;"><span>Grand Total:</span> <span>₹${order.total}</span></div>
                        <div style="display:flex; justify-content:space-between; margin-top: 5px; font-size:12px; color:#555;"><span>Payment:</span> <span>${order.paymentStatus === 'Paid' ? `Paid (${order.paymentMethod || 'Cash'})` : 'Pending'}</span></div>
                    </div>
                    <div style="text-align: center; font-size: 12px; color: #777; border-top: 1px dashed #ccc; padding-top: 15px;">
                        Thank you for visiting Valo Hotel!
                    </div>
                </div>
            `;
            document.body.appendChild(container);

            // 3. Generate PDF Blob
            const opt = {
                margin: 5,
                filename: `Valo_Order_${order.id}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
            };

            const pdfBlob = await window.html2pdf().from(container.children[0]).set(opt).output('blob');
            const file = new File([pdfBlob], `Valo_Order_${order.id}.pdf`, { type: 'application/pdf' });

            document.body.removeChild(container);

            // 4. Try Native Web Share API (Works great on Android/iOS Capacitor)
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: `Valo Hotel Bill #${order.id}`,
                    text: `Here is the receipt for Order #${order.id}.`
                });
            } else {
                // Fallback for PC/Unsupported browsers: Download directly
                const url = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.name;
                a.click();
                alert("PDF Downloaded! You can now send it to the customer on WhatsApp.");
            }

        } catch (error) {
            alert("Failed to generate or share PDF.");
            console.error(error);
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    };

    // --- CRUD MENU & MOMENTS ---
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
            name: form.get('name'), price: `₹${form.get('price')}`, description: form.get('desc'), category_id: form.get('category'), img: imgUrl, in_stock: true, is_special: false
        };

        if (itemModal.mode === 'add') await supabase.from('menu_items').insert([newItem]);
        else await supabase.from('menu_items').update(newItem).eq('id', itemModal.data.id);
        setItemModal({ open: false, mode: 'add', data: null });
    };

    const toggleStock = async (item) => await supabase.from('menu_items').update({ in_stock: !item.in_stock }).eq('id', item.id);
    const toggleSpecial = async (item) => await supabase.from('menu_items').update({ is_special: !item.is_special }).eq('id', item.id);
    const deleteItem = async (id) => { if(confirm('Delete item?')) await supabase.from('menu_items').delete().eq('id', id); };

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
        let imgUrl = momentModal.data?.src || "https://images.unsplash.com/photo-1519671482502-9759101d3361?w=400";
        if (file && file.size > 0) {
             try {
                const fileExt = file.name.split('.').pop();
                const fileName = `mom_${Date.now()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('menu_photos').upload(fileName, file);
                if(uploadError) throw uploadError;
                const { data } = supabase.storage.from('menu_photos').getPublicUrl(fileName);
                imgUrl = data.publicUrl;
             } catch(e) { alert("Upload failed. Make sure Storage Policies are set! Error: " + e.message); return; }
        }
        const newMoment = { caption: form.get('caption'), src: imgUrl, type: 'image' };
        if (momentModal.mode === 'add') { await supabase.from('moments').insert([newMoment]); } 
        else { await supabase.from('moments').update(newMoment).eq('id', momentModal.data.id); }
        setMomentModal({ open: false, mode: 'add', data: null });
    };

    const deleteMoment = async (id) => { if(confirm('Are you sure you want to delete this moment?')) { await supabase.from('moments').delete().eq('id', id); } };

    // --- COMBINED ANALYTICS & TRANSACTIONS LOGIC ---
    const getFilteredTransactions = () => {
        const now = new Date();
        let filtered = orders.filter(o => o.paymentStatus === 'Paid');
        
        if (analyticsFilter !== 'All') {
            filtered = filtered.filter(o => {
                const orderDate = new Date(o.timestamp);
                if (analyticsFilter === 'Today') {
                    return orderDate.toDateString() === now.toDateString();
                } else if (analyticsFilter === 'Weekly') {
                    const diffDays = Math.ceil(Math.abs(now - orderDate) / (1000 * 60 * 60 * 24));
                    return diffDays <= 7;
                } else if (analyticsFilter === 'Monthly') {
                    return orderDate.getMonth() === now.getMonth() && orderDate.getFullYear() === now.getFullYear();
                } else if (analyticsFilter === 'Yearly') {
                    return orderDate.getFullYear() === now.getFullYear();
                }
                return true;
            });
        }
        // Force sort Newest First
        return filtered.sort((a, b) => b.id - a.id);
    };

    const getAnalyticsData = () => {
        const map = {};
        const filteredTxns = getFilteredTransactions();

        filteredTxns.forEach(o => {
            const orderDate = new Date(o.timestamp);
            let key = '';
            
            if (analyticsFilter === 'Today') {
                key = orderDate.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
            } else if (analyticsFilter === 'Weekly') {
                key = orderDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
            } else if (analyticsFilter === 'Monthly') {
                key = orderDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
            } else if (analyticsFilter === 'Yearly' || analyticsFilter === 'All') {
                key = orderDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            }

            if (!map[key]) map[key] = { name: key, sales: 0, ts: orderDate.getTime() };
            map[key].sales += Number(o.total) || 0;
        });
        
        return Object.values(map).sort((a, b) => a.ts - b.ts);
    };

    const handleFilterChange = (filter) => {
        setAnalyticsFilter(filter);
        setTransactionPage(1); // Reset pagination on filter change
    };

    const filteredTxns = getFilteredTransactions();
    const txnsPerPage = 15;
    const totalTxnPages = Math.max(1, Math.ceil(filteredTxns.length / txnsPerPage));
    const currentTxns = filteredTxns.slice((transactionPage - 1) * txnsPerPage, transactionPage * txnsPerPage);

    // --- OTHER HELPERS ---
    const getSortedHistory = () => {
        // Flatten and sort strictly by ID descending (newest first)
        return orders
            .filter(o => o.status === 'Picked Up' || o.status === 'Cancelled')
            .sort((a, b) => b.id - a.id);
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
            <audio ref={audioRef} loop src={alertTone} />

            {/* --- MODALS --- */}
            {adminPaymentModal.open && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-sm border border-white/10 text-center shadow-2xl animate-scale-in">
                        <h3 className="text-xl font-bold mb-6 text-white">Select Payment Method</h3>
                        <div className="flex gap-4 mb-4">
                            <button onClick={() => handleAdminMarkPaid('Cash')} className="flex-1 bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95">Cash</button>
                            <button onClick={() => handleAdminMarkPaid('Online')} className="flex-1 bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95">Online</button>
                        </div>
                        <button onClick={() => handleAdminMarkPaid('Split')} className="w-full bg-purple-500 hover:bg-purple-400 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95">Split Payment</button>
                        
                        <button onClick={() => setAdminPaymentModal({ open: false, orderId: null })} className="mt-6 text-gray-400 hover:text-white text-sm font-bold w-full p-2">Cancel</button>
                    </div>
                </div>
            )}

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
            
            {catModal && ( 
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10">
                        <h3 className="text-xl font-bold mb-4">New Category</h3>
                        <form onSubmit={handleSaveCategory} className="space-y-4">
                            <input name="name" placeholder="Category Name" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required />
                            <input type="file" name="image" className="w-full text-sm text-gray-400" required />
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setCatModal(false)} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl">Cancel</button>
                                <button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl">Create</button>
                            </div>
                        </form>
                    </div>
                </div> 
            )}

            {momentModal.open && ( 
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10">
                        <h3 className="text-xl font-bold mb-4">{momentModal.mode === 'edit' ? 'Edit Moment' : 'Upload Moment'}</h3>
                        <form onSubmit={handleSaveMoment} className="space-y-4">
                            <input name="caption" defaultValue={momentModal.data?.caption} placeholder="Caption" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required />
                            <div>
                                <label className="text-xs text-gray-400">Image {momentModal.mode === 'edit' && "(Leave empty to keep current)"}</label>
                                <input type="file" name="image" className="w-full mt-1 text-sm text-gray-400" {...(momentModal.mode === 'add' ? {required: true} : {})} />
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setMomentModal({open: false, mode: 'add', data: null})} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl">Cancel</button>
                                <button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl">{momentModal.mode === 'edit' ? 'Save' : 'Upload'}</button>
                            </div>
                        </form>
                    </div>
                </div> 
            )}

            {/* SIDEBAR */}
            {isSidebarOpen && (<div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm animate-fade-in"></div>)}
            <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-white/10 p-6 flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
                <div className="flex justify-between items-center mb-10"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-cyan-500 rounded-lg flex items-center justify-center font-bold text-black text-xl">{appName.charAt(0).toUpperCase()}</div><div><h1 className="text-md font-bold font-serif tracking-wide">{appName.toUpperCase()}</h1></div></div><button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-gray-400"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button></div>
                <nav className="space-y-2 flex-1">
                    <SidebarBtn icon="🧾" label="Create Bill" active={activeTab === 'create_bill'} onClick={() => { setActiveTab('create_bill'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="⚡" label="Live Orders" active={activeTab === 'orders'} onClick={() => { setActiveTab('orders'); setIsSidebarOpen(false); }} badge={pendingOrders} />
                    <SidebarBtn icon="📈" label="Analytics & Txns" active={activeTab === 'analytics'} onClick={() => { setActiveTab('analytics'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="👥" label="Users Info" active={activeTab === 'users'} onClick={() => { setActiveTab('users'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="🍔" label="Menu Manager" active={activeTab === 'menu'} onClick={() => { setActiveTab('menu'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📸" label="Moments" active={activeTab === 'moments'} onClick={() => { setActiveTab('moments'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📊" label="History" active={activeTab === 'history'} onClick={() => { setActiveTab('history'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="⚙️" label="Settings" active={activeTab === 'settings'} onClick={() => { setActiveTab('settings'); setIsSidebarOpen(false); }} />
                </nav>
                <button onClick={onLogout} className="mt-4 flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-xl transition-all"><span className="text-sm font-bold">Logout</span></button>
            </aside>

            <div className="flex-1 flex flex-col h-screen overflow-hidden">
                <header className="md:hidden bg-slate-900 border-b border-white/10 p-4 flex items-center justify-between z-30 sticky top-0"><button onClick={() => setIsSidebarOpen(true)} className="p-2 bg-white/10 rounded-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg></button><span className="font-bold text-[22px] text-cyan-400 tracking-wide">{appName}</span><div className="w-10"></div></header>
                <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-900">
                    
                    {/* TAB: CREATE NEW BILL (POS) */}
                    {activeTab === 'create_bill' && (
                        <div className="max-w-6xl mx-auto space-y-6 pb-10">
                            <h2 className="text-2xl font-bold">Create New Bill</h2>
                            
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 lg:col-span-1 space-y-4 h-fit">
                                    <h3 className="text-lg font-bold text-cyan-400 border-b border-white/10 pb-2">Customer Info</h3>
                                    <div><label className="text-xs text-gray-400 mb-1 block">Name</label><input type="text" placeholder="Walk-in Customer" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={billCustomerName} onChange={e=>setBillCustomerName(e.target.value)} /></div>
                                    <div><label className="text-xs text-gray-400 mb-1 block">Phone Number</label><input type="text" placeholder="Optional" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={billCustomerPhone} onChange={e=>setBillCustomerPhone(e.target.value)} /></div>
                                    <div><label className="text-xs text-gray-400 mb-1 block">Table / Location</label><input type="text" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={billTableNo} onChange={e=>setBillTableNo(e.target.value)} /></div>
                                </div>

                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 lg:col-span-2 space-y-6">
                                    <h3 className="text-lg font-bold text-cyan-400 border-b border-white/10 pb-2">Add Items</h3>
                                    
                                    <div className="flex flex-col md:flex-row gap-3 relative">
                                        <div className="flex-1 relative">
                                            <input 
                                                type="text" 
                                                placeholder="Item Name (Search menu or type custom)" 
                                                className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" 
                                                value={billItemSearch} 
                                                onChange={(e) => { 
                                                    setBillItemSearch(e.target.value); 
                                                    setSelectedMenuId(null); 
                                                    setShowSuggestions(true); 
                                                }} 
                                                onFocus={() => setShowSuggestions(true)}
                                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                            />
                                            {showSuggestions && billItemSearch && (
                                                <div className="absolute top-full left-0 w-full mt-1 bg-slate-700 border border-white/10 rounded-lg shadow-xl max-h-48 overflow-y-auto z-50">
                                                    {menuItems.filter(i => i.name.toLowerCase().includes(billItemSearch.toLowerCase())).map(item => (
                                                        <div key={item.id} onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            handleSelectSuggestion(item);
                                                        }} className="p-3 hover:bg-cyan-500 hover:text-black cursor-pointer border-b border-white/5 last:border-0 flex justify-between">
                                                            <span>{item.name}</span>
                                                            <span className="font-bold font-mono text-xs mt-1">{item.price}</span>
                                                        </div>
                                                    ))}
                                                    {menuItems.filter(i => i.name.toLowerCase().includes(billItemSearch.toLowerCase())).length === 0 && (
                                                        <div className="p-3 text-gray-400 text-xs italic">Press 'Add' to create as custom item</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <input type="number" placeholder="Price (₹)" className={`w-full md:w-28 bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none ${selectedMenuId ? 'opacity-50 cursor-not-allowed' : ''}`} value={billItemPrice} onChange={e=>setBillItemPrice(e.target.value)} disabled={!!selectedMenuId} title={selectedMenuId ? "Auto-filled from menu" : "Enter custom price"} />
                                        <input type="number" placeholder="Qty" className="w-full md:w-20 bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={billItemQty} onChange={e=>setBillItemQty(e.target.value)} min="1" />
                                        <button onClick={handleAddBillItem} className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6 py-3 rounded-lg transition shadow-lg shadow-cyan-500/20">Add</button>
                                    </div>

                                    <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden overflow-x-auto">
                                        <table className="w-full text-left text-sm text-gray-300 min-w-[450px]">
                                            <thead className="bg-black/40 text-xs uppercase">
                                                <tr>
                                                    <th className="p-3">Item</th>
                                                    <th className="p-3 text-right">Rate</th>
                                                    <th className="p-3 text-center w-24">Qty</th>
                                                    <th className="p-3 text-right">Total</th>
                                                    <th className="p-3 text-center"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {billItemsList.map((item) => (
                                                    <tr key={item.uniqueId} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                                                        <td className="p-3 text-white font-medium">{item.name} {!item.menuId && <span className="text-[9px] bg-cyan-500/20 text-cyan-400 px-1 rounded ml-1">CUSTOM</span>}</td>
                                                        <td className="p-3 text-right text-gray-400">₹{item.price}</td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button onClick={() => updateBillItemQty(item.uniqueId, item.qty - 1)} disabled={item.qty <= 1} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition disabled:opacity-50">-</button>
                                                                <span className="font-bold w-4">{item.qty}</span>
                                                                <button onClick={() => updateBillItemQty(item.uniqueId, item.qty + 1)} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition">+</button>
                                                            </div>
                                                        </td>

                                                        <td className="p-3 text-right text-cyan-400 font-bold">₹{item.price * item.qty}</td>
                                                        <td className="p-3 text-center"><button onClick={() => setBillItemsList(billItemsList.filter(i => i.uniqueId !== item.uniqueId))} className="text-red-400 hover:text-red-300 bg-red-500/10 p-1.5 rounded">✕</button></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {billItemsList.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No items added to bill yet.</div>}
                                    </div>

                                    <div className="flex flex-col md:flex-row justify-between items-center pt-4 border-t border-white/10 gap-4">
                                        <div className="text-lg text-gray-400">Grand Total: <span className="text-white font-bold text-3xl ml-2">₹{billItemsList.reduce((sum, i) => sum + (i.price * i.qty), 0)}</span></div>
                                        <button onClick={handleCreateAndPrintBill} disabled={billItemsList.length === 0} className={`w-full md:w-auto px-8 py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${billItemsList.length > 0 ? 'bg-green-500 text-black hover:bg-green-400 shadow-lg shadow-green-500/20' : 'bg-slate-700 text-gray-500 cursor-not-allowed'}`}>
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                            Create & Print
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: LIVE ORDERS */}
                    {activeTab === 'orders' && ( 
                        <div className="max-w-4xl mx-auto space-y-4">
                            <h2 className="text-2xl font-bold mb-4">Live Orders</h2>
                            {getFilteredLiveOrders().length === 0 && <div className="text-center py-20 text-gray-500">No active orders</div>}
                            
                            {getFilteredLiveOrders().map(order => {
                                const regularItems = Object.entries(order.items || {}).map(([id, qty]) => {
                                    const mItem = menuItems.find(i => i.id === parseInt(id));
                                    return { key: `menu_${id}`, name: mItem?.name || 'Item', qty: qty, price: mItem?.price, menuId: id, isCustom: false };
                                });
                                const customItems = (order.customItems || []).map(cItem => ({
                                    key: cItem.id, name: cItem.name, qty: cItem.qty, price: cItem.price, isCustom: true
                                }));
                                const allItemsToRender = [...regularItems, ...customItems];

                                return (
                                    <div key={order.id} className={`bg-slate-800 p-5 rounded-xl border-l-4 shadow-lg ${order.status === 'Received' ? 'border-yellow-500' : 'border-green-500'}`}>
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-2xl font-bold">Order #{order.displayId || order.id}</span>
                                                    {order.paymentStatus === 'Paid' ? <span className="bg-green-500 text-black text-[10px] font-bold px-2 py-1 rounded">{order.paymentMethod || 'PAID'}</span> : <span className="bg-yellow-500 text-black text-[10px] font-bold px-2 py-1 rounded">PENDING</span>}
                                                </div>
                                                <p className="text-sm text-gray-400">Location: {order.tableNo} • {order.customer?.name} • {order.customer?.phone}</p>
                                                {order.paymentId && <p className="text-[10px] text-cyan-400 mt-1 font-mono">Txn ID: {order.paymentId}</p>}
                                            </div>
                                            <div className="text-right"><span className="text-xl font-bold">₹{order.total}</span></div>
                                        </div>

                                        {/* ITEMS RENDERED WITH CHECKBOXES AND QUANTITY EDITORS */}
                                        <div className="bg-black/30 p-3 rounded-lg mb-4 text-sm space-y-1">
                                            {allItemsToRender.map(item => {
                                                const isReady = order.itemStatuses?.[item.key];
                                                return (
                                                    <div key={item.key} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0 last:pb-0">
                                                        <div className="flex items-center gap-3">
                                                            <button 
                                                                onClick={() => toggleItemReady(order, item.key)} 
                                                                className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${isReady ? 'bg-green-500 border-green-500 text-black' : 'border-gray-500 text-transparent hover:border-green-500'}`}
                                                            >✓</button>
                                                            <span className={`${isReady ? 'line-through text-gray-500' : 'text-white'}`}>
                                                                {item.name} 
                                                                {item.isCustom && <span className="text-[8px] bg-cyan-500/20 text-cyan-400 px-1 rounded ml-2">CUSTOM</span>}
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-1">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button 
                                                                    onClick={() => updateLiveOrderItemQty(order.id, item.key, item.isCustom, item.qty - 1)} 
                                                                    disabled={item.qty <= 1 || isReady} 
                                                                    className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >-</button>
                                                                <span className={`font-bold w-4 text-center ${isReady ? 'text-gray-500' : 'text-white'}`}>{item.qty}</span>
                                                                <button 
                                                                    onClick={() => updateLiveOrderItemQty(order.id, item.key, item.isCustom, item.qty + 1)} 
                                                                    disabled={isReady}
                                                                    className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >+</button>
                                                                
                                                                <button 
                                                                    onClick={() => removeLiveOrderItem(order.id, item.key, item.isCustom)}
                                                                    disabled={isReady}
                                                                    className="w-6 h-6 rounded bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white flex items-center justify-center transition disabled:opacity-50 disabled:cursor-not-allowed ml-1"
                                                                    title="Remove Item"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                            <div className="text-[9px] text-gray-500 text-right">{item.isCustom ? `₹${item.price}/ea` : item.price}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* ADD CUSTOM ITEM FORM */}
                                            <div className="mt-3 border-t border-white/10 pt-3">
                                                {addingItemTo === order.id ? (
                                                    <div className="flex flex-col gap-2 bg-black/40 p-2 rounded-lg border border-cyan-500/30 overflow-visible">
                                                        <div className="relative">
                                                            <input 
                                                                type="text" 
                                                                placeholder="Item Name (Search menu or type custom)" 
                                                                className="bg-slate-800 text-xs p-2 rounded text-white outline-none w-full" 
                                                                value={customItemForm.name} 
                                                                onChange={e => {
                                                                    setCustomItemForm({...customItemForm, name: e.target.value, menuId: null});
                                                                    setShowSuggestions(true);
                                                                }} 
                                                                onFocus={() => setShowSuggestions(true)}
                                                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                                            />
                                                            {showSuggestions && customItemForm.name && (
                                                                <div className="absolute top-full left-0 w-full mt-1 bg-slate-700 border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto z-[100]">
                                                                    {menuItems.filter(i => i.name.toLowerCase().includes(customItemForm.name.toLowerCase())).map(item => (
                                                                        <div key={item.id} onMouseDown={(e) => {
                                                                            e.preventDefault();
                                                                            setCustomItemForm({
                                                                                ...customItemForm,
                                                                                name: item.name,
                                                                                price: parseInt(item.price.replace(/[^0-9]/g, '')) || 0,
                                                                                menuId: item.id
                                                                            });
                                                                            setShowSuggestions(false);
                                                                        }} className="p-2 hover:bg-cyan-500 hover:text-black cursor-pointer border-b border-white/5 last:border-0 flex justify-between text-xs">
                                                                            <span>{item.name}</span>
                                                                            <span className="font-bold font-mono">{item.price}</span>
                                                                        </div>
                                                                    ))}
                                                                    {menuItems.filter(i => i.name.toLowerCase().includes(customItemForm.name.toLowerCase())).length === 0 && (
                                                                        <div className="p-2 text-gray-400 text-[10px] italic">Custom item will be created</div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <input type="number" placeholder="Qty" className="bg-slate-800 text-xs p-2 rounded text-white outline-none w-16" value={customItemForm.qty} onChange={e => setCustomItemForm({...customItemForm, qty: e.target.value})} min="1" />
                                                            <input type="number" placeholder="Total Rate/ea (₹)" className={`bg-slate-800 text-xs p-2 rounded text-white outline-none flex-1 ${customItemForm.menuId ? 'opacity-50 cursor-not-allowed' : ''}`} value={customItemForm.price} onChange={e => setCustomItemForm({...customItemForm, price: e.target.value})} disabled={!!customItemForm.menuId} />
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => setAddingItemTo(null)} className="flex-1 text-xs py-2 bg-red-500/20 text-red-400 rounded hover:bg-red-500 hover:text-white transition">Cancel</button>
                                                            <button onClick={() => handleAddCustomItem(order.id)} className="flex-1 text-xs py-2 bg-cyan-500 text-black font-bold rounded hover:bg-cyan-400 transition">Add Item</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => { setAddingItemTo(order.id); setCustomItemForm({name: '', qty: 1, price: '', menuId: null}); }} className="w-full text-xs text-cyan-400 hover:bg-cyan-500/10 py-2 border border-dashed border-cyan-500/30 rounded transition">+ Add Item to Order</button>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div className="flex gap-3">
                                            {order.status === 'Received' && <button onClick={() => updateOrder(order.id, {status: 'Preparing'})} className="bg-slate-700 hover:bg-cyan-500 hover:text-black px-6 py-3 rounded-lg font-bold flex-1">Accept</button>}
                                            
                                            {order.status === 'Preparing' && <button onClick={() => updateOrder(order.id, {status: 'Ready'})} className="bg-green-600 px-6 py-3 rounded-lg font-bold flex-1">Ready</button>}
                                            
                                            {order.status === 'Ready' && (
                                                <button onClick={() => updateOrder(order.id, {status: 'Picked Up'})} disabled={order.paymentStatus !== 'Paid'} className={`px-6 py-3 rounded-lg font-bold flex-1 transition-all ${order.paymentStatus === 'Paid' ? 'bg-slate-600 hover:bg-slate-500 text-white shadow-lg' : 'bg-slate-800 text-gray-500 cursor-not-allowed border border-white/5'}`}>
                                                    {order.paymentStatus === 'Paid' ? 'Complete' : 'Needs Payment'}
                                                </button>
                                            )}

                                            {(order.paymentStatus === 'Pending' || !order.paymentStatus) && ( 
                                                <button onClick={() => setAdminPaymentModal({ open: true, orderId: order.id })} className="bg-green-900/50 text-green-400 px-4 py-2 rounded-lg text-sm border border-green-500/30 hover:bg-green-500 hover:text-black transition">
                                                    Mark Paid
                                                </button> 
                                            )}

                                            {/* WHATSAPP PDF BUTTON */}
                                            {order.paymentStatus === 'Paid' && (
                                                <button onClick={(e) => sendWhatsAppPDF(order, e)} className="bg-[#25D366] hover:bg-green-600 text-white px-4 py-3 rounded-lg font-bold transition flex items-center justify-center gap-2" title="Share Bill as PDF">
                                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                                </button>
                                            )}
                                            
                                            <button onClick={() => printBill(order)} className="bg-slate-700 hover:bg-white hover:text-black px-4 py-3 rounded-lg font-bold transition flex items-center justify-center gap-2" title="Print Bill">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                            </button>

                                            <button onClick={() => deleteOrder(order.id)} className="bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white px-4 py-3 rounded-lg font-bold transition flex items-center justify-center gap-2" title="Delete Order">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            </button>
                                        </div>
                                    </div> 
                                );
                            })}
                        </div> 
                    )}

                    {/* --- ADVANCED ANALYTICS & TRANSACTIONS TAB --- */}
                    {activeTab === 'analytics' && ( 
                        <div className="max-w-6xl mx-auto pb-10">
                            <h2 className="text-2xl font-bold mb-6">Sales & Transactions</h2>
                            
                            <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
                                {['Today', 'Weekly', 'Monthly', 'Yearly', 'All'].map(filter => (
                                    <button 
                                        key={filter} 
                                        onClick={() => handleFilterChange(filter)} 
                                        className={`px-6 py-2 rounded-lg text-sm font-bold transition ${analyticsFilter === filter ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'bg-slate-800 text-gray-400 hover:bg-slate-700 hover:text-white border border-white/10'}`}
                                    >
                                        {filter}
                                    </button>
                                ))}
                            </div>

                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg mb-6 flex items-center justify-between">
                                <div>
                                    <p className="text-gray-400 text-sm font-bold uppercase tracking-wider">Total Revenue ({analyticsFilter})</p>
                                    <p className="text-4xl font-black text-white mt-1">₹{filteredTxns.reduce((acc, curr) => acc + (Number(curr.total) || 0), 0)}</p>
                                </div>
                                <div className="w-12 h-12 bg-cyan-500/20 rounded-full flex items-center justify-center text-cyan-400">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                </div>
                            </div>

                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 h-[400px] w-full shadow-lg mb-6">
                                {getAnalyticsData().length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={getAnalyticsData()}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} />
                                            <XAxis dataKey="name" stroke="#888" tickLine={false} axisLine={false} />
                                            <YAxis stroke="#888" tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value}`} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }} itemStyle={{ color: '#06b6d4', fontWeight: 'bold' }} cursor={{fill: '#334155'}} />
                                            <Bar dataKey="sales" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={60} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 font-bold space-y-3">
                                        <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                        <p>No sales data found for {analyticsFilter.toLowerCase()}.</p>
                                    </div>
                                )}
                            </div>

                            <h3 className="text-xl font-bold mb-4">Transaction Ledger ({analyticsFilter})</h3>
                            <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 overflow-x-auto shadow-lg">
                                <table className="w-full text-left text-sm text-gray-400 min-w-[800px]">
                                    <thead className="bg-black/30 text-white uppercase text-xs">
                                        <tr>
                                            <th className="p-4">Order ID</th>
                                            <th className="p-4">Date</th>
                                            <th className="p-4">Customer</th>
                                            <th className="p-4">Amount</th>
                                            <th className="p-4">Method</th>
                                            <th className="p-4">Txn ID</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {currentTxns.map(order => ( 
                                            <tr key={order.id} className="border-b border-white/5 hover:bg-white/5">
                                                <td className="p-4 font-mono text-white">#{order.displayId || order.id}</td>
                                                <td className="p-4">{order.date} {order.time}</td>
                                                <td className="p-4">{order.customer?.name || 'Walk-in'}</td>
                                                <td className="p-4 font-bold text-green-400">₹{order.total}</td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${order.paymentMethod?.includes('Online') ? 'bg-blue-500/20 text-blue-400' : order.paymentMethod === 'Split' ? 'bg-purple-500/20 text-purple-400' : 'bg-green-500/20 text-green-400'}`}>
                                                        {order.paymentMethod || 'Cash'}
                                                    </span>
                                                </td>
                                                <td className="p-4 font-mono text-xs text-gray-500">{order.paymentId || '-'}</td>
                                            </tr> 
                                        ))}
                                    </tbody>
                                </table>
                                {currentTxns.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No transactions found for this period.</div>}
                            </div>
                            
                            {/* Pagination Controls */}
                            {totalTxnPages > 1 && (
                                <div className="flex justify-between items-center mt-4">
                                    <button onClick={() => setTransactionPage(prev => Math.max(1, prev - 1))} disabled={transactionPage === 1} className="px-4 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50 hover:bg-slate-700 transition">Previous</button>
                                    <span className="text-sm text-gray-400">Page {transactionPage} of {totalTxnPages}</span>
                                    <button onClick={() => setTransactionPage(prev => Math.min(totalTxnPages, prev + 1))} disabled={transactionPage === totalTxnPages} className="px-4 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50 hover:bg-slate-700 transition">Next</button>
                                </div>
                            )}
                        </div> 
                    )}
                    
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
                                                        <div className="flex gap-2"><button onClick={() => toggleSpecial(item)} className={`p-2 rounded text-xs ${item.is_special ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400'}`}>★</button><button onClick={() => setItemModal({open:true, mode:'edit', data:item})} className="text-xs bg-blue-500/10 text-blue-400 p-2 rounded hover:bg-blue-500 hover:text-white">✏️</button><button onClick={() => toggleStock(item)} className={`text-[10px] font-bold px-2 py-1 rounded transition ${item.in_stock !== false ? 'bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-black' : 'bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white'}`}>{item.in_stock !== false ? 'In' : 'Out'}</button><button onClick={() => deleteItem(item.id)} className="text-xs bg-red-500/10 text-red-400 p-2 rounded hover:bg-red-50 hover:text-white">🗑</button></div>
                                                    </div> 
                                                ))}
                                            </div>
                                        </div> 
                                    ))
                                )}
                            </div>
                        </div> 
                    )}
                    
                    {/* TAB: MOMENTS */}
                    {activeTab === 'moments' && ( 
                        <div className="max-w-5xl mx-auto">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-2xl font-bold">Moments Gallery</h2>
                                <button onClick={() => setMomentModal({ open: true, mode: 'add', data: null })} className="bg-cyan-500 text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-cyan-400 transition">+ Upload Moment</button>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {moments.map(m => ( 
                                    <div key={m.id} className="relative group rounded-xl overflow-hidden aspect-[3/4]">
                                        <img src={m.src} className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
                                        <p className="absolute bottom-2 left-2 text-xs font-bold text-white z-10">{m.caption}</p>
                                        
                                       <div className="absolute top-2 right-2 flex gap-2 opacity-100 group-hover:opacity-100 transition">
                                            <button onClick={() => setMomentModal({ open: true, mode: 'edit', data: m })} className="bg-blue-500 text-white p-2 rounded-md shadow-lg hover:bg-blue-400 transition flex items-center justify-center" title="Edit">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>
                                            </button>
                                            <button onClick={() => deleteMoment(m.id)} className="bg-red-500 text-white p-2 rounded-md shadow-lg hover:bg-red-400 transition flex items-center justify-center" title="Delete">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                            </button>
                                        </div>
                                    </div> 
                                ))}
                            </div>
                        </div> 
                    )}

                    {/* TAB: HISTORY */}
                    {activeTab === 'history' && ( 
                        <div className="max-w-6xl mx-auto">
                            <h2 className="text-2xl font-bold mb-6">Order History</h2>
                            <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 overflow-x-auto shadow-lg">
                                <table className="w-full text-sm text-left text-gray-400 min-w-[850px]">
                                    <thead className="text-xs text-gray-200 uppercase bg-black/30">
                                        <tr>
                                            <th className="p-4">ID</th>
                                            <th className="p-4">Time</th>
                                            <th className="p-4">Location</th>
                                            <th className="p-4">Amount</th>
                                            <th className="p-4">Method</th>
                                            <th className="p-4">Status</th>
                                            <th className="p-4 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {getSortedHistory().map(order => ( 
                                            <tr key={order.id} className="border-b border-white/5 hover:bg-white/5 transition">
                                                <td className="p-4 font-bold text-white">#{order.displayId || order.id}</td>
                                                <td className="p-4">{order.date} {order.time}</td>
                                                <td className="p-4">{order.tableNo} • {order.customer?.name}</td>
                                                <td className="p-4 text-green-400 font-bold">₹{order.total}</td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${order.paymentMethod?.includes('Online') ? 'bg-blue-500/20 text-blue-400' : order.paymentMethod === 'Split' ? 'bg-purple-500/20 text-purple-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                                        {order.paymentMethod || 'Cash'}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${order.status === 'Picked Up' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                                        {order.status}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-center flex justify-center gap-2">
                                                    {/* WHATSAPP PDF BUTTON */}
                                                    <button onClick={(e) => sendWhatsAppPDF(order, e)} className="bg-[#25D366]/20 hover:bg-[#25D366] text-[#25D366] hover:text-white p-2 rounded-lg transition" title="Share Bill as PDF">
                                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                                    </button>
                                                    <button onClick={() => printBill(order)} className="bg-slate-700 hover:bg-white hover:text-black p-2 rounded-lg transition" title="Print Bill">
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                                    </button>
                                                </td>
                                            </tr> 
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div> 
                    )}
                    
                    {/* --- SETTINGS TAB --- */}
                    {activeTab === 'settings' && (
                        <div className="max-w-4xl mx-auto space-y-8 pb-10">
                            <h2 className="text-2xl font-bold mb-6">App Settings</h2>

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
                                        }} className="flex-1 md:flex-none bg-red-500/20 text-red-400 hover:bg-red-50 hover:text-white px-6 py-2 rounded-lg text-sm font-bold transition">Reset Default</button>
                                    </div>
                                </div>
                            </div>

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
function StatusCard({ label, count, color }) { return (<div className="flex items-center gap-3 bg-slate-800 p-3 rounded-xl border border-white/5 shadow-lg"><div className={`w-3 h-3 rounded-full ${color} animate-pulse`}></div><div><p className="text-[10px] text-gray-400 uppercase font-bold">{label}</p><p className="text-xl font-bold text-white leading-none">{count}</p></div></div>); }
function getStatusColor(status) { switch(status) { case 'Received': return 'border-yellow-500 shadow-yellow-900/20'; case 'Preparing': return 'border-orange-500 shadow-orange-900/20'; case 'Ready': return 'border-green-500 shadow-green-900/20'; default: return 'border-gray-500'; } }
function getStatusBadge(status) { switch(status) { case 'Received': return 'bg-yellow-500 text-black'; case 'Preparing': return 'bg-orange-500 text-white animate-pulse'; case 'Ready': return 'bg-green-500 text-black'; default: return 'bg-gray-500 text-white'; } }