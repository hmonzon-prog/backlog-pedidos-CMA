let currentUser = '';
let previousAssignedIds = null; // null = primera carga, no alertar

document.addEventListener("DOMContentLoaded", () => {
    currentUser = localStorage.getItem('current_machinist');
    if(!currentUser) {
        window.location.href = 'machinist-login.html';
        return;
    }

    document.getElementById('user-name').innerText = currentUser;
    lucide.createIcons();

    // Pedir permiso de notificaciones del sistema (opcional, mejora la exp)
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
});

function logout() {
    localStorage.removeItem('current_machinist');
    window.location.href = 'index.html';
}

function copyOrder(id) {
    navigator.clipboard.writeText(id).then(() => {
        showBanner('✅ Orden copiada: ' + id, '#3fb950');
    }).catch(err => console.error('Error copiando', err));
}

function classifyComplexity(altura, piso) {
    if (altura === 0 && piso > 0) return '100% PISO';
    if (piso === 0 && altura > 0) return '100% ALTURA';
    if (altura > 0 && piso > 0) return 'MIXTO';
    return 'N/A';
}

/* ===== SISTEMA DE ALERTAS ===== */

function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Dos tonos tipo "ding ding"
        [0, 0.3].forEach(startOffset => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime + startOffset);
            osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + startOffset + 0.2);
            
            gain.gain.setValueAtTime(0.6, ctx.currentTime + startOffset);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + 0.4);
            
            osc.start(ctx.currentTime + startOffset);
            osc.stop(ctx.currentTime + startOffset + 0.4);
        });
    } catch(e) {
        console.log('Audio no disponible:', e);
    }
}

function triggerVibration() {
    if ('vibrate' in navigator) {
        // Patrón: vibrar 300ms, pausa 100ms, vibrar 300ms
        navigator.vibrate([300, 100, 300]);
    }
}

function showBanner(message, color = '#f1e05a') {
    // Eliminar banner anterior si existe
    const existing = document.getElementById('alert-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'alert-banner';
    banner.style.cssText = `
        position: fixed;
        top: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: ${color};
        color: ${color === '#f1e05a' ? '#000' : '#fff'};
        padding: 1rem 1.5rem;
        border-radius: 12px;
        font-size: 1.1rem;
        font-weight: 700;
        z-index: 9999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        animation: bannerIn 0.3s ease;
        max-width: 90vw;
        text-align: center;
    `;
    banner.innerHTML = message;
    document.body.appendChild(banner);

    // Auto-cerrar después de 5 segundos
    setTimeout(() => {
        banner.style.animation = 'bannerOut 0.3s ease forwards';
        setTimeout(() => banner.remove(), 300);
    }, 5000);
}

function triggerNewOrderAlert(newOrders) {
    playAlertSound();
    triggerVibration();
    
    const orderList = newOrders.map(o => `#${o.id}`).join(', ');
    showBanner(`🚨 NUEVO PEDIDO ASIGNADO<br><small>${orderList}</small>`, '#f1e05a');
    
    // Notificación del sistema si tiene permiso
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("📦 Nuevo pedido asignado", {
            body: `Orden ${orderList} fue asignada a vos`,
            icon: "/favicon.ico"
        });
    }
}

/* ===== FIN ALERTAS ===== */

function renderTasks() {
    const orders = window.db.getOrders();
    const myTasks = orders.filter(o => o.asignadoA === currentUser && o.estado !== "Preparado");

    // === DETECCIÓN DE NUEVAS ASIGNACIONES ===
    if (previousAssignedIds !== null) {
        const currentIds = new Set(myTasks.map(o => o.id));
        const newOrders = myTasks.filter(o => !previousAssignedIds.has(o.id));
        if (newOrders.length > 0) {
            triggerNewOrderAlert(newOrders);
        }
    }
    // Actualizamos el registro de IDs para la próxima comparación
    previousAssignedIds = new Set(myTasks.map(o => o.id));
    /* ======================================= */

    const container = document.getElementById('tasks-container');

    if (myTasks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="check-circle" style="font-size: 4rem; color: #3fb950; margin-bottom:1rem;"></i>
                <h2>¡Todo listo!</h2>
                <p>No tienes tareas pendientes asignadas.</p>
                <button class="btn" style="margin-top:2rem;" onclick="renderTasks()">
                    <i data-lucide="refresh-cw"></i> Actualizar
                </button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    container.innerHTML = `
        <div style="margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0;">Tareas Pendientes (${myTasks.length})</h3>
            <button class="btn primary" onclick="renderTasks()"><i data-lucide="refresh-cw"></i></button>
        </div>
    ` + myTasks.map(o => {
        const cx = classifyComplexity(o.altura, o.piso);
        
        let buttonHTML = '';
        if (o.estado === 'En preparación') {
            buttonHTML = `<button class="btn primary action-btn" onclick="finishTask('${o.id}')">
                <i data-lucide="check-square"></i> Marcar como Finalizado
            </button>`;
        } else {
            buttonHTML = `<button class="btn action-btn" style="background:#f1e05a; color:black;" onclick="startTask('${o.id}')">
                <i data-lucide="play-circle"></i> Poner en preparación
            </button>`;
        }

        return `
            <div class="order-card">
                <div class="header">
                    <div class="order-number">
                        ${o.id}
                        <button class="btn" style="padding:0.25rem 0.5rem; background:transparent; border:1px solid #30363d;" onclick="copyOrder('${o.id}')">
                            <i data-lucide="copy" style="width:16px;"></i>
                        </button>
                    </div>
                </div>
                <div class="details">
                    <div class="detail-item">
                        <span class="label">Marca/Familia</span>
                        <span class="value">${o.familia}</span>
                    </div>
                    <div class="detail-item">
                        <span class="label">Cantidad</span>
                        <span class="value" style="font-size:1.5rem; color:#58a6ff;">${o.cantidad}</span>
                    </div>
                    <div class="detail-item">
                        <span class="label">Tipo de Carga</span>
                        <span class="value">${cx}</span>
                    </div>
                    <div class="detail-item">
                        <span class="label">Estado Actual</span>
                        <span class="value" style="color:#f1e05a;">${o.estado}</span>
                    </div>
                </div>
                ${buttonHTML}
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

function startTask(orderId) {
    if(confirm('¿Comenzar a preparar la orden ' + orderId + '?')) {
        window.db.startOrder(orderId);
        renderTasks();
    }
}

function finishTask(orderId) {
    if(confirm('¿Seguro que deseas marcar la orden ' + orderId + ' como finalizada?')) {
        window.db.markOrderCompleted(orderId);
        renderTasks();
    }
}
