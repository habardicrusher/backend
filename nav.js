// nav.js - نسخة محسنة تعمل في كل الظروف
function loadNavigation() {
    const navContainer = document.querySelector('.navbar .nav-links');
    if (!navContainer) {
        console.error('لم يتم العثور على العنصر .navbar .nav-links');
        return;
    }
    
    const navLinks = [
        { name: "📊 الرئيسية", href: "index.html" },
        { name: "📝 الطلبات", href: "orders.html" },
        { name: "🚚 التوزيع", href: "distribution.html" },
        { name: "🚛 السيارات", href: "vehicles.html" },
        { name: "📦 أنواع البحص", href: "aggregate_types.html" },
        { name: "🏭 المصانع", href: "factories.html" },
        { name: "📊 تقارير الطلبات اليومية", href: "daily_orders_report.html" },
        { name: "📅 تقارير الميزان الشهرية", href: "reports_monthly.html" },
        { name: "⚖️ تقرير الميزان", href: "scale_report.html" },
        { name: "⚙️ الإعدادات", href: "settings.html" },
        { name: "⛔ الحظر", href: "blocking.html" },
        { name: "👥 المستخدمين", href: "users.html" },
        { name: "📜 السجلات", href: "logs.html" }
    ];

    // تفريغ المحتوى القديم
    navContainer.innerHTML = '';
    
    // إضافة الروابط
    navLinks.forEach(link => {
        const a = document.createElement('a');
        a.href = link.href;
        a.textContent = link.name;
        
        // تمييز الصفحة الحالية
        const currentPage = window.location.pathname.split('/').pop();
        if (currentPage === link.href || (currentPage === '' && link.href === 'index.html')) {
            a.classList.add('active');
        }
        
        navContainer.appendChild(a);
    });
    
    console.log('تم تحميل شريط التنقل بنجاح');
}

// تأخير بسيط لضمان تحميل DOM بالكامل
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadNavigation);
} else {
    loadNavigation();
}
