// common-auth.js - التحقق من الصلاحيات وإخفاء العناصر في جميع الصفحات

let currentUser = null;
let currentPermissions = [];
let currentRole = null;

// جلب بيانات المستخدم الحالي
async function loadAuth() {
    try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (!res.ok) {
            window.location.href = '/login.html';
            return null;
        }
        const data = await res.json();
        currentUser = data.user;
        currentRole = currentUser.role;
        currentPermissions = currentUser.permissions || [];
        return { user: currentUser, permissions: currentPermissions, role: currentRole };
    } catch (err) {
        console.error('خطأ في التحقق من الجلسة:', err);
        window.location.href = '/login.html';
        return null;
    }
}

// إخفاء عنصر بواسطة ID إذا لم تكن الصلاحية موجودة
function hideIfNoPermission(permission, elementId) {
    if (!permission) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    if (currentRole === 'admin') return;
    if (!currentPermissions.includes(permission)) {
        el.style.display = 'none';
    }
}

// إخفاء أزرار أو عناصر متعددة حسب كلاس
function hideButtonsIfNoPermission(permission, className) {
    if (currentRole === 'admin') return;
    if (!currentPermissions.includes(permission)) {
        document.querySelectorAll(`.${className}`).forEach(el => el.style.display = 'none');
    }
}

// إخفاء الروابط في شريط التنقل بناءً على الصلاحيات
function applyNavPermissions() {
    const navLinks = document.getElementById('navLinks');
    if (!navLinks) return;
    const links = navLinks.querySelectorAll('a');
    const linkPermissionMap = {
        'index.html': null, // الصفحة الرئيسية مسموحة للجميع
        'orders.html': 'view_orders',
        'distribution.html': 'view_distribution',
        'trucks.html': 'view_trucks',
        'products.html': 'view_products',
        'factories.html': 'view_factories',
        'reports.html': 'view_reports',
        'scale_report.html': 'view_scale_report',
        'trucks-failed.html': 'view_failed_trucks',
        'trucks-failed-report.html': 'view_failed_trucks',
        'distribution-quality.html': 'view_reports',
        'settings.html': 'view_settings',
        'restrictions.html': 'manage_restrictions',
        'users.html': 'manage_users',
        'logs.html': 'view_logs'
    };
    links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        const required = linkPermissionMap[href];
        if (!required) return;
        if (currentRole === 'admin') return;
        if (!currentPermissions.includes(required)) {
            link.style.display = 'none';
        }
    });
}

// دالة عامة لتهيئة الصفحة (تستدعى بعد تحميل DOM)
async function initPage() {
    const auth = await loadAuth();
    if (!auth) return;
    applyNavPermissions();
    return auth;
}
