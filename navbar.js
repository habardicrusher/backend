(function() {
    setInterval(async () => {
        try {
            await fetch('/api/me', { credentials: 'include' });
        } catch(e) {}
    }, 3 * 60 * 1000);

    async function renderNavbar() {
        try {
            const res = await fetch('/api/me', { credentials: 'include' });
            const data = await res.json();
            if (!data.user) {
                window.location.href = '/login.html';
                return;
            }
            
            const role = data.user.role;
            const permissions = data.user.permissions || [];
            const isAdmin = (role === 'admin' || permissions.includes('all'));

            let navContainer = document.querySelector('.nav-links');
            if (!navContainer) {
                const header = document.querySelector('.header');
                if (header) {
                    navContainer = document.createElement('div');
                    navContainer.className = 'nav-links';
                    header.insertAdjacentElement('afterend', navContainer);
                } else return;
            }

            // ★★★ تعريف جميع الصفحات مع مفاتيح الصلاحيات ★★★
            const allPages = [
                { href: 'index.html', text: '📊 الرئيسية', permission: 'index' },
                { href: 'orders.html', text: '📝 الطلبات', permission: 'orders' },
                { href: 'distribution.html', text: '🚚 التوزيع', permission: 'distribution' },
                { href: 'trucks.html', text: '🚛 السيارات', permission: 'trucks' },
                { href: 'products.html', text: '📦 أنواع البحص', permission: 'products' },
                { href: 'factories.html', text: '🏭 المصانع', permission: 'factories' },
                { href: 'reports.html', text: '📊 تقارير الكسارة', permission: 'reports' },
                { href: 'scale_report.html', text: '⚖️ تقارير الميزان الشهرية', permission: 'scale_report' },
                { href: 'trucks-failed.html', text: '⚠️ السيارات غير المستوفية', permission: 'trucks-failed' },
                { href: 'trucks-failed-report.html', text: '📊 تقرير الغير مستوفية', permission: 'trucks-failed-report' },
                { href: 'distribution-quality.html', text: '📈 جودة التوزيع', permission: 'distribution-quality' },
                { href: 'settings.html', text: '⚙️ الإعدادات', permission: 'settings' },
                { href: 'restrictions.html', text: '⛔ الحظر', permission: 'restrictions' }
            ];

            const adminOnlyPages = [
                { href: 'users.html', text: '👥 المستخدمين', permission: 'admin_only' },
                { href: 'logs.html', text: '📜 السجلات', permission: 'admin_only' }
            ];

            let linksToShow = [];

            // ★★★ فلترة الصفحات حسب الصلاحيات ★★★
            if (isAdmin) {
                // المدير يرى كل شيء
                linksToShow = [...allPages, ...adminOnlyPages];
            } else {
                // المستخدم العادي: فقط الصفحات المسموح بها
                linksToShow = allPages.filter(page => permissions.includes(page.permission));
            }

            const currentPage = window.location.pathname.split('/').pop();
            navContainer.innerHTML = linksToShow.map(link => 
                `<a href="${link.href}" class="nav-link ${currentPage === link.href ? 'active' : ''}">${link.text}</a>`
            ).join('');

            // ★★★ منع الوصول المباشر للصفحات غير المصرح بها ★★★
            const currentPermission = allPages.find(p => p.href === currentPage)?.permission;
            const isAdminPage = adminOnlyPages.find(p => p.href === currentPage);
            
            if (currentPermission && !isAdmin && !permissions.includes(currentPermission)) {
                alert('⛔ ليس لديك صلاحية للوصول إلى هذه الصفحة');
                window.location.href = 'index.html';
                return;
            }
            
            if (isAdminPage && !isAdmin) {
                alert('⛔ هذه الصفحة متاحة فقط للمديرين');
                window.location.href = 'index.html';
                return;
            }

            if (!document.getElementById('logout-btn-container')) {
                const logoutDiv = document.createElement('div');
                logoutDiv.id = 'logout-btn-container';
                logoutDiv.style.cssText = 'position: absolute; top: 20px; left: 20px; z-index: 100;';
                const logoutBtn = document.createElement('button');
                logoutBtn.innerHTML = '🚪 تسجيل الخروج';
                logoutBtn.style.cssText = `background: linear-gradient(135deg, #f5576c, #eb3349); border: none; padding: 8px 20px; border-radius: 25px; color: white; font-weight: bold; cursor: pointer; font-size: 14px;`;
                logoutBtn.onclick = () => {
                    if (confirm('⚠️ هل أنت متأكد من تسجيل الخروج؟')) {
                        fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(() => window.location.href = '/login.html');
                    }
                };
                logoutDiv.appendChild(logoutBtn);
                const header = document.querySelector('.header');
                if (header) {
                    header.style.position = 'relative';
                    header.appendChild(logoutDiv);
                }
            }
        } catch(e) {
            console.error('Navbar error:', e);
            window.location.href = '/login.html';
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNavbar);
    else renderNavbar();
})();
