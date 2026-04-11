// nav.js - شريط التنقل الموحد لكامل الموقع
function loadNavigation(currentPage) {
    const navLinks = [
        { name: "📊 الرئيسية", href: "index.html" },
        { name: "📝 الطلبات", href: "orders.html" },
        { name: "🚚 التوزيع", href: "distribution.html" },
        { name: "🚛 السيارات", href: "vehicles.html" },
        { name: "📦 أنواع البحص", href: "aggregate_types.html" },
        { name: "🏭 المصانع", href: "factories.html" },
        { name: "📊 تقارير الطلبات اليومية", href: "daily_orders_report.html" },
        { name: "📅 تقارير الميزان الشهرية", href: "reports_monthly.html" },
        { name: "⚖️ تقرير الميزان", href: "scale_report.html" },      // الرابط الجديد
        { name: "⚙️ الإعدادات", href: "settings.html" },
        { name: "⛔ الحظر", href: "blocking.html" },
        { name: "👥 المستخدمين", href: "users.html" },
        { name: "📜 السجلات", href: "logs.html" }
    ];

    const navbar = document.querySelector('.navbar .nav-links');
    if (!navbar) return;
    
    navbar.innerHTML = '';
    navLinks.forEach(link => {
        const a = document.createElement('a');
        a.href = link.href;
        a.textContent = link.name;
        if (currentPage && link.href.includes(currentPage)) {
            a.classList.add('active');
        }
        navbar.appendChild(a);
    });
}

// تنفيذ التحميل عند اكتمال الصفحة
document.addEventListener('DOMContentLoaded', () => {
    // استخراج اسم الملف الحالي من المسار
    const currentFile = window.location.pathname.split('/').pop();
    loadNavigation(currentFile);
});