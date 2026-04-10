// notifications.js - نظام الإشعارات المركزي
const notifications = {
    // تخزين الإشعارات
    items: [],
    listeners: [],
    audioEnabled: true,
    audio: null,

    // تهيئة النظام
    init: function() {
        // تحميل الإشعارات من localStorage
        const saved = localStorage.getItem('gravel_notifications');
        if (saved) {
            try {
                this.items = JSON.parse(saved);
            } catch(e) {}
        }
        
        // إنشاء عنصر الصوت
        this.audio = new Audio();
        // نستخدم Web Audio API لإنشاء صوت تنبيه إذا لم نتمكن من تحميل ملف صوتي
        this.createBeepSound();
        
        // بدء الاستماع للإشعارات من الخادم (SSE أو polling)
        this.startPolling();
        
        // تحديث عداد الإشعارات
        this.updateBadge();
    },
    
    // إنشاء صوت تنبيه باستخدام Web Audio API
    createBeepSound: function() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioContext = new AudioContext();
            }
        } catch(e) {}
    },
    
    // تشغيل صوت التنبيه
    playBeep: function() {
        if (!this.audioEnabled) return;
        
        // محاولة تشغيل صوت بسيط عبر Web Audio
        if (this.audioContext && this.audioContext.state !== 'closed') {
            try {
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
                const oscillator = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                oscillator.connect(gain);
                gain.connect(this.audioContext.destination);
                oscillator.frequency.value = 880;
                gain.gain.value = 0.3;
                oscillator.start();
                gain.gain.exponentialRampToValueAtTime(0.00001, this.audioContext.currentTime + 0.8);
                oscillator.stop(this.audioContext.currentTime + 0.8);
            } catch(e) {}
        }
        
        // محاولة تشغيل صوت باستخدام Audio element كبديل
        try {
            const beep = new Audio('data:audio/wav;base64,U3RlYWx0aCBzb3VuZA==');
            beep.play().catch(() => {});
        } catch(e) {}
    },
    
    // إضافة إشعار جديد
    add: function(order) {
        const notification = {
            id: Date.now(),
            orderId: order.id,
            factory: order.factory,
            material: order.material,
            count: 1,
            time: order.time || 'غير محدد',
            timestamp: new Date().toLocaleTimeString('ar-SA'),
            read: false,
            createdAt: new Date().toISOString()
        };
        
        // التحقق إذا كان هناك إشعار مشابه غير مقروء
        const existing = this.items.find(n => 
            !n.read && n.factory === order.factory && n.material === order.material
        );
        
        if (existing) {
            existing.count++;
            existing.timestamp = new Date().toLocaleTimeString('ar-SA');
        } else {
            this.items.unshift(notification);
        }
        
        // الاحتفاظ بآخر 50 إشعار فقط
        if (this.items.length > 50) this.items.pop();
        
        // حفظ في localStorage
        localStorage.setItem('gravel_notifications', JSON.stringify(this.items));
        
        // تشغيل الصوت
        this.playBeep();
        
        // عرض إشعار منبثق
        this.showToast(order);
        
        // تحديث العداد
        this.updateBadge();
        
        // إخطار المستمعين
        this.notifyListeners();
        
        return notification;
    },
    
    // عرض إشعار منبثق (Toast)
    showToast: function(order) {
        // إنشاء عنصر الإشعار
        const toastContainer = document.getElementById('notificationToastContainer');
        if (!toastContainer) {
            const container = document.createElement('div');
            container.id = 'notificationToastContainer';
            container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px;';
            document.body.appendChild(container);
        }
        
        const toast = document.createElement('div');
        toast.style.cssText = `
            background: linear-gradient(135deg, #667eea, #764ba2);
            border-radius: 12px;
            padding: 15px 20px;
            min-width: 280px;
            max-width: 350px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            animation: slideInRight 0.3s ease;
            direction: rtl;
            font-family: inherit;
            border-right: 4px solid #38ef7d;
        `;
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="font-size: 28px;">📋</div>
                <div style="flex: 1;">
                    <div style="font-weight: bold; margin-bottom: 5px;">طلب جديد!</div>
                    <div style="font-size: 0.85em;">🏭 ${order.factory}</div>
                    <div style="font-size: 0.85em;">📦 ${order.material}</div>
                    <div style="font-size: 0.85em;">🔢 1 طلب</div>
                    <div style="font-size: 0.75em; color: #a8b2d1; margin-top: 5px;">${new Date().toLocaleTimeString('ar-SA')}</div>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: #fff; cursor: pointer; font-size: 18px;">✕</button>
            </div>
        `;
        
        const container = document.getElementById('notificationToastContainer');
        container.appendChild(toast);
        
        // إزالة الإشعار بعد 5 ثوانٍ
        setTimeout(() => {
            if (toast.parentElement) toast.remove();
        }, 5000);
        
        // إضافة حركة CSS إذا لم تكن موجودة
        if (!document.querySelector('#notificationToastStyle')) {
            const style = document.createElement('style');
            style.id = 'notificationToastStyle';
            style.textContent = `
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }
    },
    
    // تحديث عداد الإشعارات في شريط العنوان
    updateBadge: function() {
        const unreadCount = this.items.filter(n => !n.read).length;
        
        // تحديث عنوان الصفحة
        const originalTitle = document.title.replace(/^\(\d+\)\s*/, '');
        if (unreadCount > 0) {
            document.title = `(${unreadCount}) ${originalTitle}`;
        } else {
            document.title = originalTitle;
        }
        
        // محاولة تحديث Favicon badge (إذا كانت المدعومة)
        if (navigator.setAppBadge) {
            navigator.setAppBadge(unreadCount).catch(() => {});
        } else if (window.ExperimentalBadge) {
            window.ExperimentalBadge.set(unreadCount);
        }
    },
    
    // استعلام عن الإشعارات من الخادم (polling كل 10 ثوانٍ)
    startPolling: function() {
        let lastCheck = localStorage.getItem('gravel_last_notification_check') || Date.now();
        
        setInterval(async () => {
            try {
                const today = new Date().toISOString().split('T')[0];
                const response = await fetch(`/api/day/${today}`, { credentials: 'include' });
                const data = await response.json();
                const orders = data.orders || [];
                
                // الحصول على آخر طلب تم إشعاره
                const lastNotifiedId = localStorage.getItem('gravel_last_notified_order_id');
                
                // البحث عن الطلبات الجديدة
                for (const order of orders) {
                    if (order.id !== lastNotifiedId) {
                        // إضافة إشعار جديد
                        this.add(order);
                        localStorage.setItem('gravel_last_notified_order_id', order.id);
                        break;
                    }
                }
                localStorage.setItem('gravel_last_notification_check', Date.now());
            } catch(e) {}
        }, 10000); // كل 10 ثوانٍ
    },
    
    // الحصول على جميع الإشعارات
    getAll: function() {
        return this.items;
    },
    
    // الحصول على الإشعارات غير المقروءة
    getUnread: function() {
        return this.items.filter(n => !n.read);
    },
    
    // تحديد إشعار كمقروء
    markAsRead: function(id) {
        const notification = this.items.find(n => n.id == id);
        if (notification) {
            notification.read = true;
            localStorage.setItem('gravel_notifications', JSON.stringify(this.items));
            this.updateBadge();
            this.notifyListeners();
        }
    },
    
    // تحديد جميع الإشعارات كمقروءة
    markAllAsRead: function() {
        this.items.forEach(n => n.read = true);
        localStorage.setItem('gravel_notifications', JSON.stringify(this.items));
        this.updateBadge();
        this.notifyListeners();
    },
    
    // حذف إشعار
    delete: function(id) {
        this.items = this.items.filter(n => n.id != id);
        localStorage.setItem('gravel_notifications', JSON.stringify(this.items));
        this.updateBadge();
        this.notifyListeners();
    },
    
    // إضافة مستمع للتغييرات
    addListener: function(callback) {
        this.listeners.push(callback);
    },
    
    // إخطار المستمعين
    notifyListeners: function() {
        this.listeners.forEach(callback => callback(this.items));
    },
    
    // تمكين/تعطيل الصوت
    toggleSound: function() {
        this.audioEnabled = !this.audioEnabled;
        localStorage.setItem('gravel_notifications_sound', this.audioEnabled);
        return this.audioEnabled;
    }
};

// بدء التهيئة عند تحميل الصفحة
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => notifications.init());
} else {
    notifications.init();
}
