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

        // Evitar doble inicialización si se carga en múltiples pestañas
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        this.db = firebase.database();
        this.ordersRef = this.db.ref('orders');
        this.localOrders = [];

        // Tiempo real: Escuchar cambios en Firebase
        this.ordersRef.on('value', (snapshot) => {
            const data = snapshot.val();
            this.localOrders = data ? Object.values(data) : [];
            
            // Re-render interfaces si las funciones existen en el scope global
            if (typeof renderDashboard === 'function') renderDashboard();
            if (typeof renderTasks === 'function') renderTasks();
        });
    }

    _sanitize(obj) {
        // Firebase no admite 'undefined', reemplazamos por null
        return JSON.parse(JSON.stringify(obj, (key, value) => value === undefined ? null : value));
    }

    _syncOrders(updatedArray) {
        const obj = {};
        updatedArray.forEach(o => {
            const cleanId = String(o.id).replace(/[.#$\[\]]/g, '');
            // Strip 'raw' (Excel row data) siempre - causa serialization errors en Firebase
            const { raw, ...cleanOrder } = o;
            obj[cleanId] = this._sanitize(cleanOrder);
        });
        this.ordersRef.set(obj)
            .then(() => console.log('✅ Firebase sync OK'))
            .catch(err => console.error('❌ Firebase sync FAILED:', err));
    }

    /**
     * Get all active orders (Local cache, maintained by Firebase socket)
     */
    getOrders() {
        return this.localOrders || [];
    }

    /**
     * Parse new row to standard order object
     */
    normalizeRow(row, headers) {
        // Find matching keys ignoring case and spaces
        const getKeyRegex = (pattern) => Object.keys(row).find(k => new RegExp(pattern, 'i').test(k));
        
        const idKey = getKeyRegex('orden infor|orden');
        const statusKey = getKeyRegex('estado');
        const familyKey = getKeyRegex('familia|marca');
        const dateKey = getKeyRegex('fecha|dias');

        if (!idKey) return null;

        const id = row[idKey];
        if (!id) return null;

        // Sumar múltiples columnas de "CANTIDAD UN"
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
            id: String(id).trim(),
            estadoExcel: row[statusKey] ? String(row[statusKey]).trim() : 'No asignado',
            estado: row[statusKey] ? String(row[statusKey]).trim() : 'No asignado',
            familia: row[familyKey] ? String(row[familyKey]).trim() : 'N/A',
            cantidad: qtyFinal,
            altura: parseInt(row['ALTURA']) || 0,
            piso: parseInt(row['PISO']) || 0,
            fecha: row[dateKey] ? new Date(row[dateKey]).toISOString() : new Date().toISOString(),
            asignadoA: null,
            isDestrabado: false
        };
    }

    /**
     * Upsert strategy: Merge new Excel data with existing local database
     */
    upsertData(parsedRows) {
        let currentOrders = this.getOrders();
        
        let newOrdersAdded = 0;
        let ordersUpdated = 0;
        let newlyUnlocked = 0;

        const incomingMap = new Map();

        // 1. Normalize all incoming rows
        parsedRows.forEach(row => {
            const normalized = this.normalizeRow(row);
            if (normalized) {
                incomingMap.set(normalized.id, normalized);
            }
        });

        // 2. Iterate existing DB, update or remove
        const updatedDb = [];

        currentOrders.forEach(existing => {
            const incoming = incomingMap.get(existing.id);

            if (incoming) {
                // Order exists in both old DB and new File (Update it)
                let isDestrabado = false;
                
                // DETECCIÓN DE DESTRABADOS:
                // Si antes estaba en "Pieza lanzada" o "No asignado" y ahora es "Lanzado"
                const oldStatus = existing.estado.toLowerCase();
                const newStatus = incoming.estado.toLowerCase();
                
                if (
                    (oldStatus.includes('pieza lanzada') || oldStatus.includes('no asignado') || oldStatus.includes('no se asigno')) &&
                    newStatus === 'lanzado'
                ) {
                    isDestrabado = true;
                    newlyUnlocked++;
                }

                updatedDb.push({
                    ...incoming,
                    asignadoA: existing.asignadoA, // Preserve Machinist Assignment
                    estado: (existing.estado === 'En preparación' || existing.estado === 'Preparado') ? existing.estado : incoming.estado,
                    isDestrabado: isDestrabado || existing.isDestrabado // keep true if newly updated or already was
                });
                incomingMap.delete(existing.id); // Remove from map as it's processed
                ordersUpdated++;
            } else {
                // Order exists in DB but not in new file.
                // Assuming it was completed or deleted, we can remove it.
                // (By not pushing it to updatedDb, we drop it).
            }
        });

        // 3. Add remaining new orders from incomingMap
        incomingMap.forEach(newIncoming => {
            updatedDb.push(newIncoming);
            newOrdersAdded++;
        });

        this._syncOrders(updatedDb);
        
        return {
            total: updatedDb.length,
            added: newOrdersAdded,
            updated: ordersUpdated,
            unlocked: newlyUnlocked
        };
    }

    /**
     * Assign a machinist to an order
     */
    assignMachinist(orderId, machinistName) {
        const orders = this.getOrders();
        const updated = orders.map(o => {
            if (o.id === orderId) {
                return { ...o, asignadoA: machinistName };
            }
            return o;
        });
        this._syncOrders(updated);
    }

    /**
     * Start order (Machinist)
     */
    startOrder(orderId) {
        const orders = this.getOrders();
        const updated = orders.map(o => {
            if (o.id === orderId) {
                return { ...o, estado: "En preparación" };
            }
            return o;
        });
        this._syncOrders(updated);
    }

    /**
     * Mark order as completed
     */
    markOrderCompleted(orderId) {
        const orders = this.getOrders();
        const updated = orders.map(o => {
            if (o.id === orderId) {
                return { ...o, estado: "Preparado" };
            }
            return o;
        });
        this._syncOrders(updated);
    }

    getMachinists() {
        return this.maquinistas;
    }

    /**
     * PRESENCE & PINGS
     */
    updatePresence(machinistName) {
        if (!machinistName) return;
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        const ref = this.db.ref('presence/' + cleanName);
        
        ref.update({
            lastActive: firebase.database.ServerValue.TIMESTAMP
        });

        // Al cerrar el navegador/pestaña, poner presencia en 0
        ref.onDisconnect().update({
            lastActive: 0
        });
    }

    goOffline(machinistName) {
        if (!machinistName) return;
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName).update({
            lastActive: 0
        });
    }

    // Escuchar presencia de todos
    onPresenceChange(callback) {
        this.db.ref('presence').on('value', (snapshot) => {
            callback(snapshot.val() || {});
        });
    }

    sendPing(machinistName) {
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName).update({
            pingRequest: firebase.database.ServerValue.TIMESTAMP,
            response: null // Limpiar respuesta anterior al mandar nuevo ping
        });
    }

    onPingReceived(machinistName, callback) {
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName + '/pingRequest').on('value', (snapshot) => {
            if (snapshot.val()) {
                callback(snapshot.val());
            }
        });
    }

    sendResponse(machinistName, text) {
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName).update({
            pingRequest: null, // Ya atendió el llamado
            response: text,
            responseTime: firebase.database.ServerValue.TIMESTAMP
        });
    }

    clearResponse(machinistName) {
        const cleanName = machinistName.replace(/[.#$\[\]]/g, '_');
        this.db.ref('presence/' + cleanName).update({
            response: null,
            responseTime: null
        });
    }

    resetOrder(orderId) {
        const orders = this.getOrders();
        const updated = orders.map(o => {
            if (o.id === orderId) {
                return { ...o, estado: o.estadoExcel, asignadoA: null };
            }
            return o;
        });
        this._syncOrders(updated);
    }
}

window.db = new DataStore();
