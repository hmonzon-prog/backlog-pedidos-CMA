class DataStore {
    constructor() {
        this.maquinistas = ["Juan Perez", "Carlos Gomez", "Miguel Sanchez", "Roberto Luis", "Andres Silva"];
        
        const firebaseConfig = {
          apiKey: "AIzaSyAMiBIeH5NUwItFsSH5kchjZlETyFolh-A",
          authDomain: "backlog-manager-67dc5.firebaseapp.com",
          projectId: "backlog-manager-67dc5",
          storageBucket: "backlog-manager-67dc5.firebasestorage.app",
          messagingSenderId: "710531746517",
          appId: "1:710531746517:web:858b44155c2238188b705c",
          databaseURL: "https://backlog-manager-67dc5-default-rtdb.firebaseio.com"
        };
        firebase.initializeApp(firebaseConfig);
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
            obj[cleanId] = this._sanitize(o);
        });
        this.ordersRef.set(obj);
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
            asignadoA: null, // by default not assigned
            raw: row // save raw data just in case
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
}

window.db = new DataStore();
