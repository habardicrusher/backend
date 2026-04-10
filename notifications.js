// notifications.js - نظام الإشعارات
const notifications = {
    items: [],
    audioEnabled: true,
    currentUserRole: null,
    userChecked: false,

    init: function() {
        const saved = localStorage.getItem('gravel_notifications');
        if (saved) {
            try { this.items = JSON.parse(saved); } catch(e) {}
        }
        this.updateBadge();
        this.getCurrentUserRole();
        this.startPolling();
    },

    async getCurrentUserRole() {
        try {
            const res = await fetch('/api/me', { credentials: 'include' });
            const data = await res.json();
            if (data.user) {
                this.currentUserRole = data.user.role;
                this.userChecked = true;
                console.log('✅ User role loaded:', this.currentUserRole);
            } else {
                console.log('⚠️ No user found');
            }
        } catch(e) {
            console.error('Error getting user role:', e);
        }
    },

    shouldNotify() {
        // إذا لم نتحقق من المستخدم بعد، نرجع true مؤقتاً (حتى لا نفوت الإشعارات)
        if (!this.userChecked) return true;
        // الإشعارات فقط للمدير والمستخدمين العاديين (وليس العملاء)
        const result = this.currentUserRole === 'admin' || this.currentUserRole === 'user';
        console.log('shouldNotify:', result, 'role:', this.currentUserRole);
        return result;
    },

    playBeep: function() {
        if (!this.audioEnabled) return;
        if (!this.shouldNotify()) return;
        
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                const ctx = new AudioContext();
                if (ctx.state === 'suspended') ctx.resume();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = 880;
                gain.gain.value = 0.2;
                osc.start();
                gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
                osc.stop(ctx.currentTime + 0.5);
                setTimeout(() => ctx.close(), 600);
            }
        } catch(e) {}
    },

    addOrderNotification: function(order) {
        console.log('Adding order notification:', order);
        if (!this.shouldNotify()) return null;
        
        const notification = {
            id: Date.now(),
            type: 'order',
            factory: order.factory,
            material: order.material,
            count: order.count || 1,
            timestamp: new Date().toLocaleTimeString('ar-SA'),
            read: false
        };
        this.items.unshift(notification);
        
        if (this.items.length > 50) this.items.pop();
        localStorage.setItem('gravel_notifications', JSON.stringify(this.items));
        this.playBeep();
        this.showOrderPopup(order);
        this.updateBadge();
        if (window.renderNotifications) window.renderNotifications();
        return notification;
    },
    
    addDistributionNotification: function(result) {
        console.log('Adding distribution notification:', result);
        if (!this.shouldNotify()) return null;
        
        const notification = {
            id: Date.now(),
            type: 'distribution',
            title: '🔄 توزيع تلقائي',
            message: `تم توزيع ${result.totalOrders} طلب على ${result.trucksUsed} سيارة (الرود ${result.lastRoad})`,
            totalOrders: result.totalOrders,
            trucksUsed: result.trucksUsed,
            lastRoad: result.lastRoad,
            timestamp: new Date().toLocaleTimeString('ar-SA'),
            read: false
        };
        this.items.unshift(notification);
        localStorage.setItem('gravel_notifications', JSON.stringify(this.items));
        this.playBeep();
        this.showDistributionPopup(result);
        this.updateBadge();
        if (window.renderNotifications) window.renderNotifications();
    },

    showOrderPopup: function(order) {
        if (!this.shouldNotify()) return;
        
        let container = document.getElementById('notifyPopup');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notifyPopup';
            container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10000;background:#1a1a2e;border-right:4px solid #38ef7d;border-radius:12px;padding:15px;box-shadow:0 4px 15px rgba(0,0,0,0.3);min-width:300px;direction:rtl';
            document.body.appendChild(container);
        }
        
        container.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px">
                <div style="font-size:28px">📋</div>
                <div style="flex:1">
                    <div style="font-weight:bold">طلب جديد!</div>
                    <div>🏭 ${order.factory}</div>
                    <div>📦 ${order.material}</div>
                    <div>🔢 ${order.count || 1} طلب</div>
                    <div style="font-size:0.7em;color:#a8b2d1;margin-top:5px">${new Date().toLocaleTimeString('ar-SA')}</div>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:#fff;cursor:pointer">✕</button>
            </div>
        `;
        setTimeout(() => { if(container && container.parentElement) container.remove(); }, 8000);
    },
    
    showDistributionPopup: function(result) {
        if (!this.shouldNotify()) return;
        
        let container = document.getElementById('notifyPopup');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notifyPopup';
            container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10000;background:#1a1a2e;border-right:4px solid #4facfe;border-radius:12px;padding:15px;box-shadow:0 4px 15px rgba(0,0,0,0.3);min-width:300px;direction:rtl';
            document.body.appendChild(container);
        }
        container.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px">
                <div style="font-size:28px">🔄</div>
                <div style="flex:1">
                    <div style="font-weight:bold">توزيع تلقائي!</div>
                    <div>📊 تم توزيع ${result.totalOrders} طلب</div>
                    <div>🚛 على ${result.trucksUsed} سيارة</div>
                    <div>🔄 الرود ${result.lastRoad}</div>
                    <div style="font-size:0.7em;color:#a8b2d1;margin-top:5px">${new Date().toLocaleTimeString('ar-SA')}</div>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:#fff;cursor:pointer">✕</button>
            </div>
        `;
        setTimeout(() => { if(container && container.parentElement) container.remove(); }, 8000);
    },

    updateBadge: function() {
        const unread = this.items.filter(n => !n.read).length;
        const title = document.title.replace(/^\(\d+\)\s*/, '');
        document.title = unread > 0 ? `(${unread}) ${title}` : title;
    },

    startPolling: function() {
        let lastOrderCount = 0;
        setInterval(async () => {
            try {
                // تأكد من أن المستخدم مدير أو مستخدم عادي
                if (!this.shouldNotify()) return;
                
                const today = new Date().toISOString().split('T')[0];
                const res = await fetch(`/api/day/${today}`, { credentials: 'include' });
                const data = await res.json();
                const orders = data.orders || [];
                
                // إذا زاد عدد الطلبات، أضف إشعاراً
                if (orders.length > lastOrderCount && lastOrderCount > 0) {
                    const newOrders = orders.slice(0, orders.length - lastOrderCount);
                    for (let i = 0; i < newOrders.length; i++) {
                        this.addOrderNotification(newOrders[i]);
                    }
                }
                lastOrderCount = orders.length;
            } catch(e) {}
        }, 10000);
    },

    getUnread: function() { return this.items.filter(n => !n.read); },
    
    markAsRead: function(id) {
        const n = this.items.find(i => i.id == id);
        if (n) n.read = true;
        localStorage.setItem('gravel_notifications', JSON.stringify(this.items));
        this.updateBadge();
        if (window.renderNotifications) window.renderNotifications();
    },
    
    markAllAsRead: function() {
        this.items.forEach(n => n.read = true);
        localStorage.setItem('gravel_notifications', JSON.stringify(this.items));
        this.updateBadge();
        if (window.renderNotifications) window.renderNotifications();
    },
    
    delete: function(id) {
        this.items = this.items.filter(i => i.id != id);
        localStorage.setItem('gravel_notifications', JSON.stringify(this.items));
        this.updateBadge();
        if (window.renderNotifications) window.renderNotifications();
    },
    
    toggleSound: function() {
        this.audioEnabled = !this.audioEnabled;
        localStorage.setItem('soundEnabled', this.audioEnabled);
        return this.audioEnabled;
    }
};

// بدء التهيئة
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => notifications.init());
} else {
    notifications.init();
}
