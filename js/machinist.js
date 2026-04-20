// machinist.js

let currentUser = '';

document.addEventListener("DOMContentLoaded", () => {
    currentUser = localStorage.getItem('current_machinist');
    if(!currentUser) {
        window.location.href = 'machinist-login.html';
        return;
    }

    document.getElementById('user-name').innerText = currentUser;
    lucide.createIcons();
    renderTasks();
});

function logout() {
    localStorage.removeItem('current_machinist');
    window.location.href = 'index.html';
}

function copyOrder(id) {
    navigator.clipboard.writeText(id).then(() => {
        alert('Orden Copiada: ' + id);
    }).catch(err => {
        console.error('Error copiando', err);
    });
}

function classifyComplexity(altura, piso) {
    if (altura === 0 && piso > 0) return '100% PISO';
    if (piso === 0 && altura > 0) return '100% ALTURA';
    if (altura > 0 && piso > 0) return 'MIXTO';
    return 'N/A';
}

function renderTasks() {
    const orders = window.db.getOrders();
    const myTasks = orders.filter(o => o.asignadoA === currentUser && o.estado !== "Preparado");

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
