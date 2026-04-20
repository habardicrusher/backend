// navbar.js - شريط التنقل الديناميكي حسب الصلاحيات
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
            const user = data.user;
            const role = user.role;
            const permissions = user.permissions || [];

            const hasPermission = (perm) => permissions.includes(perm) || role === 'admin';

            let navContainer = document.querySelector('.nav-links');
            if (!navContainer) {
                const header = document.querySelector('.header');
                if (header) {
                    navContainer = document.createElement('div');
                    navContainer.className = 'nav-links';
                    header.insertAdjacentElement('afterend', navContainer);
                } else return;
            }

            // تعريف جميع الروابط مع الصلاحية المطلوبة (للمستخدم العادي)
            const allLinks = [
                { href: 'index.html', text: '📊 الرئيسية', permission: null },
                { href: 'orders.html', text: '📝 الطلبات', permission: null },
                { href: 'distribution.html', text: '🚚 التوزيع', permission: null },
                { href: 'trucks.html', text: '🚛 السيارات', permission: null },
                { href: 'products.html', text: '📦 أنواع البحص', permission: null },
                { href: 'factories.html', text: '🏭 المصانع', permission: null },
                { href: 'reports.html', text: '📊 تقارير الكسارة', permission: 'reports' },
                { href: 'scale_report.html', text: '⚖️ تقارير الميزان الشهرية', permission: 'scale_reports' },
                { href: 'trucks-failed.html', text: '⚠️ السيارات غير المستوفية', permission: 'failed_trucks' },
                { href: 'trucks-failed-report.html', text: '📊 تقرير الغير مستوفية', permission: 'failed_trucks' },
                { href: 'distribution-quality.html', text: '📈 جودة التوزيع', permission: 'quality' },
                { href: 'settings.html', text: '⚙️ الإعدادات', permission: 'settings' },
                { href: 'restrictions.html', text: '⛔ الحظر', permission: 'restrictions' }
            ];

            const adminOnlyLinks = [
                { href: 'users.html', text: '👥 المستخدمين', permission: null },
                { href: 'logs.html', text: '📜 السجلات', permission: null }
            ];

            let linksToShow = [];
            if (role === 'admin') {
                linksToShow = [...allLinks, ...adminOnlyLinks];
            } else if (role === 'client') {
                linksToShow = [{ href: 'orders.html', text: '📝 الطلبات', permission: null }];
            } else if (role === 'user') {
                linksToShow = allLinks.filter(link => {
                    if (!link.permission) return true;
                    return hasPermission(link.permission);
                });
            }

            const currentPage = window.location.pathname.split('/').pop();
            navContainer.innerHTML = linksToShow.map(link => `<a href="${link.href}" class="nav-link ${currentPage === link.href ? 'active' : ''}">${link.text}</a>`).join('');

            // زر تسجيل الخروج
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
            window.location.href = '/login.html';
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNavbar);
    else renderNavbar();
})();
