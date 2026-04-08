// ==================== التحقق من الجلسة ====================
async function checkSession() {
    try {
        // API_BASE لازم يكون معرف في js/api.js
        const response = await fetch(`${API_BASE}/me`, { credentials: 'include' });

        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            return true;
        } else {
            // على GitHub Pages لازم بدون /
            window.location.href = 'login.html';
            return false;
        }
    } catch (error) {
        console.error('Session check error:', error);
        window.location.href = 'login.html';
        return false;
    }
}

async function logout() {
    try {
        await fetch(`${API_BASE}/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        console.error('Logout error:', e);
    }

    window.location.href = 'login.html';
}

// ==================== التحقق من الصلاحيات ====================
function hasPermission(permission) {
    return currentUser && currentUser.permissions && currentUser.permissions[permission];
}

function requirePermission(permission) {
    if (!hasPermission(permission)) {
        showToast('ليس لديك صلاحية للقيام بهذا الإجراء', 'error');
        return false;
    }
    return true;
}

function isAdmin() {
    return currentUser && currentUser.role === 'admin';
}
