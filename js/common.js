// ==================== المتغيرات العامة ====================
const API_BASE = '/api';
let currentUser = null;
let factories = [];
let materials = [];
let trucks = [];
let orders = [];
let distribution = [];
let restrictions = [];
let currentDate = '';

// الصلاحيات المتاحة
const allPermissions = {
    viewOrders: '📋 عرض الطلبات',
    addOrders: '➕ إضافة طلبات',
    editOrders: '✏️ تعديل الطلبات',
    deleteOrders: '🗑️ حذف الطلبات',
    viewDistribution: '🚚 عرض التوزيع',
    manageDistribution: '⚡ إدارة التوزيع',
    viewTrucks: '🚛 عرض السيارات',
    manageTrucks: '🔧 إدارة السيارات',
    viewReports: '📊 عرض التقارير',
    exportReports: '📥 تصدير التقارير',
    viewSettings: '⚙️ عرض الإعدادات',
    manageSettings: '🔧 إدارة الإعدادات',
    viewBackup: '💾 عرض النسخ الاحتياطي',
    manageBackup: '📤 إدارة النسخ الاحتياطي',
    manageUsers: '👥 إدارة المستخدمين',
    manageRestrictions: '⛔ إدارة القيود'
};

// ==================== وظائف المساعدة ====================
function showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.classList.toggle('active', show);
    }
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

function populateSelect(id, items, placeholder = '-- اختر --') {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = `<option value="">${placeholder}</option>` + 
        items.map(item => `<option value="${item}">${item}</option>`).join('');
}

function populateMaterialSelect(id, items) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">-- اختر --</option>' + 
        items.map(item => `<option value="${item}">بحص ${item}</option>`).join('');
}

// ==================== التنقل ====================
function buildNavigation() {
    const nav = document.getElementById('mainNav');
    if (!nav || !currentUser) return;
    
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    let html = `<a href="orders.html" class="nav-link ${currentPage === 'orders.html' ? 'active' : ''}">📝 الطلبات</a>`;
    
    if (currentUser.permissions.viewDistribution) {
        html += `<a href="distribution.html" class="nav-link ${currentPage === 'distribution.html' ? 'active' : ''}">🚚 التوزيع</a>`;
    }
    if (currentUser.permissions.viewTrucks) {
        html += `<a href="trucks.html" class="nav-link ${currentPage === 'trucks.html' ? 'active' : ''}">🚛 السيارات</a>`;
    }
    if (currentUser.permissions.viewReports) {
        html += `<a href="reports.html" class="nav-link ${currentPage === 'reports.html' ? 'active' : ''}">📊 التقارير</a>`;
    }
    if (currentUser.permissions.viewSettings) {
        html += `<a href="settings.html" class="nav-link ${currentPage === 'settings.html' ? 'active' : ''}">⚙️ الإعدادات</a>`;
    }
    if (currentUser.permissions.viewBackup) {
        html += `<a href="backup.html" class="nav-link ${currentPage === 'backup.html' ? 'active' : ''}">💾 النسخ الاحتياطي</a>`;
    }
    if (currentUser.permissions.manageUsers) {
        html += `<a href="users.html" class="nav-link ${currentPage === 'users.html' ? 'active' : ''}">👥 المستخدمين</a>`;
    }
    if (currentUser.permissions.manageRestrictions) {
        html += `<a href="restrictions.html" class="nav-link ${currentPage === 'restrictions.html' ? 'active' : ''}">⛔ القيود</a>`;
    }
    if (currentUser.role === 'admin') {
        html += `<a href="logs.html" class="nav-link ${currentPage === 'logs.html' ? 'active' : ''}">📜 السجلات</a>`;
    }
    
    nav.innerHTML = html;
}

function updateUserInfo() {
    const usernameEl = document.getElementById('currentUsername');
    const roleEl = document.getElementById('userRole');
    
    if (usernameEl && currentUser) {
        usernameEl.textContent = currentUser.username;
    }
    if (roleEl && currentUser) {
        roleEl.textContent = currentUser.role === 'admin' ? '👑 مدير' : '👤 مستخدم';
        roleEl.className = 'chip' + (currentUser.role === 'admin' ? ' admin' : '');
    }
}

// ==================== القيود ====================
function getDriverRestrictions(truckNumber) {
    return restrictions.filter(r => r.active && r.truckNumber === truckNumber);
}

function isRestricted(truckNumber, factory) {
    return restrictions.some(r => 
        r.active && 
        r.truckNumber === truckNumber && 
        r.restrictedFactories.includes(factory)
    );
}

// ==================== تهيئة التاريخ ====================
function initDate() {
    const dateInput = document.getElementById('orderDate');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
        currentDate = today;
    }
}

// ==================== إغلاق Modal بالضغط خارجها ====================
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// ==================== اختصارات الكيبورد ====================
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
        });
    }
});