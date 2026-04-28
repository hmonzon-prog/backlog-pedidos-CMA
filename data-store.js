class DataStore {
    constructor() {
        this.maquinistas = [
            "Alan Del Pino",
            "Gaston Lobo",
            "Ian Effron",
            "Facu Luquez",
            "Yonathan Algañaraz",
            "Alcides",
            "Ruben Goitia"
        ];

        const firebaseConfig = {
            apiKey: "AIzaSyAMiBIeH5NUwItFsSH5kchjZlETyFolh-A",
            authDomain: "backlog-manager-67dc5.firebaseapp.com",
            projectId: "backlog-manager-67dc5",
            storageBucket: "backlog-manager-67dc5.firebasestorage.app",
            messagingSenderId: "710531746517",
            appId: "1:710531746517:web:858b44155c2238188b705c",
            databaseURL: "https://backlog-manager-67dc5-default-rtdb.firebaseio.com"
        };

        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        this.db = firebase.database();
        this.ordersRef = this.db.ref('orders');
        this.localOrders = [];

        // ─── Estado de conexión ───
        this.isConnected = false;
        this.pollInterval = null;
        this.lastWebSocketUpdate = 0;
        this.POLL_MS = 10000; // Polling cada 10 segundos

        // URL REST de Firebase (no requiere WebSocket)
        this.REST_URL = 'https://backlog-manager-67dc5-default-rtdb.firebaseio.com/orders.json';
        this.REST_PRESENCE_URL = 'https://backlog-manager-67dc5-default-rtdb.firebaseio.com/presence.json';

        // ─── Inyectar badge de conexión en el DOM ───
        this._injectConnectionBadge();

        // ─── Monitor de estado de conexión WebSocket ───
        this.db.ref('.info/connected').on('value', (snap) => {
            this.isConnected = snap.val() === true;

            if (this.isConnected) {
                console.log("🟢 Firebase WebSocket conectado — tiempo real activo");
                this._updateBadge(true);
                this._stopPolling(); // WebSocket OK → no necesitamos polling
            } else {
                console.warn("🟡 WebSocket caído — activando polling HTTP de respaldo");
                this._updateBadge(false);
                this._startPolling(); // WebSocket caído → activar polling
            }
        });

        // ─── Listener WebSocket (tiempo real) ───
        this.ordersRef.on('value', (snapshot) => {
            this.lastWebSocketUpdate = Date.now();
            const data = snapshot.val();
            this.localOrders = data ? Object.values(data) : [];
            this._triggerRender();
        });

        // ─── Activar polling inmediatamente como red de seguridad ───
        // Se cancela solo si el WebSocket conecta en los primeros segundos
        this._startPolling();
    }

    // ══════════════════════════════════════════
    //   POLLING HTTP (respaldo para redes corp.)
    // ══════════════════════════════════════════

    _startPolling() {
        if (this.pollInterval) return; // Ya estaba corriendo
        console.log(`🔄 Polling HTTP activado (cada ${this.POLL_MS / 1000}s)`);
        // Primer poll inmediato
        this._pollREST();
        this.pollInterval = setInterval(() => this._pollREST(), this.POLL_MS);
    }

    _stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
            console.log("⏹️ Polling HTTP detenido — WebSocket activo");
        }
    }

    async _pollREST() {
        // Si el WebSocket actualizó hace menos de 5 segundos, saltear
        if (Date.now() - this.lastWebSocketUpdate < 5000) return;

        try {
            const res = await fetch(this.REST_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            const incoming = data ? Object.values(data) : [];

            // Solo re-renderizar si los datos cambiaron
            const changed = JSON.stringify(incoming) !== JSON.stringify(this.localOrders);
            if (changed) {
                console.log('🔄 Polling: cambios detectados → actualizando');
                this.localOrders = incoming;
                this._triggerRender();
            }
        } catch (err) {
            console.warn('⚠️ Polling HTTP falló:', err.message);
        }
    }

    _triggerRender() {
        if (typeof renderDashboard === 'function') renderDashboard();
        if (typeof renderTasks === 'function') renderTasks();
    }

    // ══════════════════════════════════════════
    //   BADGE VISUAL DE CONEXIÓN
    // ══════════════════════════════════════════

    _injectConnectionBadge() {
        // Esperar a que el DOM esté listo
        const inject = () => {
            if (document.getElementById('conn-badge')) return;
            const badge = document.createElement('div');
            badge.id = 'conn-badge';
            badge.style.cssText = `
                position: fixed;
                bottom: 12px;
                right: 12px;
                background: rgba(0,0,0,0.75);
                color: #f1e05a;
                font-size: 11px;
                font-weight: 700;
                padding: 5px 10px;
                border-radius: 20px;
                z-index: 9998;
                letter-spacing: 0.5px;
                backdrop-filter: blur(4px);
                border: 1px solid rgba(255,255,255,0.1);
                transition: all 0.3s ease;
                pointer-events: none;
            `;
            badge.textContent = '🟡 Conectando...';
            document.body.appendChild(badge);
        };

        if (document.body) {
            inject();
        } else {
            document.addEventListener('DOMContentLoaded', inject);
        }
    }

    _updateBadge(isConnected) {
        const badge = document.getElementById('conn-badge');
        if (!badge) return;
        if (isConnected) {
            badge.textContent = '🟢 En vivo';
            badge.style.color = '#3fb950';
            badge.style.borderColor = 'rgba(63,185,80,0.3)';
        } else {
            badge.textContent = '🟡 Reconectando... (modo offline)';
            badge.style.color = '#f1e05a';
            badge.style.borderColor = 'rgba(241,224,90,0.3)';
        }
    }

    // ══════════════════════════════════════════
    //   MÉTODOS INTERNOS
    // ══════════════════════════════════════════

    _sanitize(obj) {
        return JSON.parse(JSON.stringify(obj, (key, value) => value === undefined ? null : value));
    }

    _syncOrders(updatedArray) {
        const obj = {};
        updatedArray.forEach(o => {
            const cleanId = String(o.id).replace(/[.#$\[\]]/g, '');
            const { raw, ...cleanOrder } = o;
            obj[cleanId] = this._sanitize(cleanOrder);
        });
        this.ordersRef.set(obj)
            .then(() => console.log('✅ Firebase sync OK'))
            .catch(err => console.error('❌ Firebase sync FAILED:', err));
    }

    // ══════════════════════════════════════════
    //   API PÚBLICA
    // ══════════════════════════════════════════

    getOrders() {
        return this.localOrders || [];
    }

    normalizeRow(row, headers) {
        const getKeyRegex = (pattern) => Object.keys(row).find(k => new RegExp(pattern, 'i').test(k));

        const idKey     = getKeyRegex('orden infor|orden');
        const statusKey = getKeyRegex('estado');
        const familyKey = getKeyRegex('familia|marca');
        const dateKey   = getKeyRegex('fecha|dias');

        if (!idKey) return null;
        const id = row[idKey];
        if (!id) return null;

        let sumCantidad = 0;
        let sumFallback = 0;
        Object.keys(row).forEach(k => {
            const kUp = k.toUpperCase();
            if (kUp.includes('CANTIDAD UN')) {
                const val = parseInt(row[k]);
                if (!isNaN(val)) sumCantidad += val;
            } else if (kUp.includes('CANTIDAD') || kUp.includes('PIEZAS') || kUp.includes('QTY')) {
                const val = parseInt(row[k]);
                if (!isNaN(val)) sumFallback += val;
            }
        });

        const qtyFinal = sumCantidad > 0 ? sumCantidad : sumFallback;

        return {
            id:           String(id).trim(),
            estadoExcel:  row[statusKey] ? String(row[statusKey]).trim() : 'No asignado',
            estado:       row[statusKey] ? String(row[statusKey]).trim() : 'No asignado',
            familia:      row[familyKey] ? String(row[familyKey]).trim() : 'N/A',
            cantidad:     qtyFinal,
            altura:       parseInt(row['ALTURA']) || 0,
            piso:         parseInt(row['PISO'])   || 0,
            fecha:        row[dateKey] ? new Date(row[dateKey]).toISOString() : new Date().toISOString(),
            asignadoA:    null,
            isDestrabado: false
        };
    }

    upsertData(parsedRows) {
        let currentOrders = this.getOrders();
        let newOrdersAdded = 0;
        let ordersUpdated  = 0;
        let newlyUnlocked  = 0;

        const incomingMap = new Map();
        parsedRows.forEach(row => {
            const normalized = this.normalizeRow(row);
            if (normalized) incomingMap.set(normalized.id, normalized);
        });

        const updatedDb = [];
        currentOrders.forEach(existing => {
            const incoming = incomingMap.get(existing.id);
            if (incoming) {
                let isDestrabado = false;
                const oldStatus  = existing.estado.toLowerCase();
                const newStatus  = incoming.estado.toLowerCase();

                if (
                    (oldStatus.includes('pieza lanzada') || oldStatus.includes('no asignado') || oldStatus.includes('no se asigno')) &&
                    newStatus === 'lanzado'
                ) {
                    isDestrabado = true;
                    newlyUnlocked++;
                }

                updatedDb.push({
                    ...incoming,
                    asignadoA:    existing.asignadoA,
                    estado:       (existing.estado === 'En preparación' || existing.estado === 'Preparado') ? existing.estado : incoming.estado,
                    isDestrabado: isDestrabado || existing.isDestrabado
                });
                incomingMap.delete(existing.id);
                ordersUpdated++;
            }
        });

        incomingMap.forEach(newIncoming => {
            updatedDb.push(newIncoming);
            newOrdersAdded++;
        });

        this._syncOrders(updatedDb);

        return {
            total:   updatedDb.length,
            added:   newOrdersAdded,
            updated: ordersUpdated,
            unlocked: newlyUnlocked
        };
    }

    assignMachinist(orderId, machinistName) {
        const updated = this.getOrders().map(o =>
            o.id === orderId ? { ...o, asignadoA: machinistName } : o
        );
        this._syncOrders(updated);
    }

    startOrder(orderId) {
        const updated = this.getOrders().map(o =>
            o.id === orderId ? { ...o, estado: "En preparación" } : o
        );
        this._syncOrders(updated);
    }

    markOrderCompleted(orderId) {
        const updated = this.getOrders().map(o =>
            o.id === orderId ? { ...o, estado: "Preparado" } : o
        );
        this._syncOrders(updated);
    }

    resetOrder(orderId) {
        const updated = this.getOrders().map(o =>
            o.id === orderId ? { ...o, estado: o.estadoExcel, asignadoA: null } : o
        );
        this._syncOrders(updated);
    }

    getMachinists() {
        return this.maquinistas;
    }

    // ══════════════════════════════════════════
    //   PRESENCIA Y PINGS
    // ══════════════════════════════════════════

    updatePresence(machinistName) {
        if (!machinistName) return;
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        const ref = this.db.ref('presence/' + cleanName);
        ref.update({ lastActive: firebase.database.ServerValue.TIMESTAMP });
        ref.onDisconnect().update({ lastActive: 0 });
    }

    goOffline(machinistName) {
        if (!machinistName) return;
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName).update({ lastActive: 0 });
    }

    onPresenceChange(callback) {
        this.db.ref('presence').on('value', (snapshot) => {
            callback(snapshot.val() || {});
        });
    }

    sendPing(machinistName) {
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName).update({
            pingRequest: firebase.database.ServerValue.TIMESTAMP,
            response: null
        });
    }

    onPingReceived(machinistName, callback) {
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName + '/pingRequest').on('value', (snapshot) => {
            if (snapshot.val()) callback(snapshot.val());
        });
    }

    sendResponse(machinistName, text) {
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName).update({
            pingRequest:  null,
            response:     text,
            responseTime: firebase.database.ServerValue.TIMESTAMP
        });
    }

    clearResponse(machinistName) {
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName).update({
            response:     null,
            responseTime: null
        });
    }
}

window.db = new DataStore();
