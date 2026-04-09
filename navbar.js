// navbar.js - إنشاء شريط التنقل الموحد في جميع الصفحات
(function() {
    // التحقق من وجود المستخدم (للتأكد من أنه مسجل دخول)
    fetch('/api/me', { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            if (data.user) {
                renderNavbar();
            } else {
                // إذا لم يكن مسجل دخول، لا نعرض الشريط (أو نعرضه بدون روابط)
                // لكن الأفضل توجيهه لتسجيل الدخول
                // window.location.href = '/login.html';
            }
        })
        .catch(() => {});

    function renderNavbar() {
        // البحث عن حاوية شريط التنقل
        let navContainer = document.querySelector('.nav-links');
        if (!navContainer) {
            // إذا لم توجد، ننشئها داخل .container بعد الهيدر
            const container = document.querySelector('.container');
            if (!container) return;
            const header = document.querySelector('.header');
            if (header && header.nextSibling) {
                navContainer = document.createElement('div');
                navContainer.className = 'nav-links';
                header.insertAdjacentElement('afterend', navContainer);
            } else {
                return;
            }
        }

        // الروابط الكاملة (جميع الصفحات)
        const links = [
            { href: 'index.html', text: '📊 الرئيسية' },
            { href: 'orders.html', text: '📝 الطلبات' },
            { href: 'distribution.html', text: '🚚 التوزيع' },
            { href: 'trucks.html', text: '🚛 السيارات' },
            { href: 'products.html', text: '📦 أنواع البحص' },
            { href: 'factories.html', text: '🏭 المصانع' },
            { href: 'reports.html', text: '📊 التقارير' },
            { href: 'settings.html', text: '⚙️ الإعدادات' },
            { href: 'restrictions.html', text: '⛔ الحظر' },
            { href: 'users.html', text: '👥 المستخدمين' },
            { href: 'logs.html', text: '📜 السجلات' }
        ];

        // تحديد الصفحة الحالية لإضافة class="active"
        const currentPage = window.location.pathname.split('/').pop();

        navContainer.innerHTML = links.map(link => `
            <a href="${link.href}" class="nav-link ${currentPage === link.href ? 'active' : ''}">${link.text}</a>
        `).join('');

        // إضافة زر تسجيل الخروج إذا لم يكن موجوداً
        if (!document.getElementById('logout-btn-container')) {
            const logoutDiv = document.createElement('div');
            logoutDiv.id = 'logout-btn-container';
            logoutDiv.style.cssText = 'position: absolute; top: 20px; left: 20px; z-index: 100;';
            const logoutBtn = document.createElement('button');
            logoutBtn.innerHTML = '🚪 تسجيل الخروج';
            logoutBtn.style.cssText = `
                background: linear-gradient(135deg, #f5576c, #eb3349);
                border: none;
                padding: 8px 20px;
                border-radius: 25px;
                color: white;
                font-weight: bold;
                cursor: pointer;
                transition: 0.3s;
                font-size: 14px;
            `;
            logoutBtn.onmouseover = () => logoutBtn.style.transform = 'scale(1.05)';
            logoutBtn.onmouseout = () => logoutBtn.style.transform = 'scale(1)';
            logoutBtn.onclick = () => {
                if (confirm('⚠️ هل أنت متأكد من تسجيل الخروج؟')) {
                    fetch('/api/logout', { method: 'POST', credentials: 'include' })
                        .then(() => { window.location.href = '/login.html'; })
                        .catch(() => { window.location.href = '/login.html'; });
                }
            };
            logoutDiv.appendChild(logoutBtn);
            const header = document.querySelector('.header');
            if (header) {
                header.style.position = 'relative';
                header.appendChild(logoutDiv);
            }
        }
    }
})();