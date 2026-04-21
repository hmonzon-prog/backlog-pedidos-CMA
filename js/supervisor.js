// supervisor.js

document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();
    renderDashboard();

    const fileInput = document.getElementById('file-input');
    const refreshBtn = document.getElementById('btn-refresh');

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
            // Reset para poder volver a subir el mismo archivo
            e.target.value = '';
        }
    });

    refreshBtn.addEventListener('click', () => {
        renderDashboard();
    });
});

function handleFile(file) {
    const statusDiv = document.getElementById('upload-status');
    statusDiv.style.color = '#58a6ff';
    statusDiv.innerText = 'Procesando archivo...';

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Leemos el archivo como un array de arrays para encontrar dónde está la tabla real
            const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

            if(rawData.length === 0) {
                throw new Error("El archivo está vacío o no se pudo leer.");
            }

            // Buscamos cuál es la fila que contiene los encabezados (ej. "ORDEN INFOR")
            let headerRowIndex = 0;
            for (let i = 0; i < Math.min(rawData.length, 20); i++) {
                if (rawData[i].some(cell => String(cell).toUpperCase().includes('ORDEN INFOR'))) {
                    headerRowIndex = i;
                    break;
                }
            }

            // Mapeamos los encabezados reales agregando su índice para no perder columnas duplicadas
            const headers = rawData[headerRowIndex].map((h, idx) => {
                const head = String(h).trim();
                return head ? head + "_" + idx : "";
            });
            
            // Reconstruimos la data de la Hoja 1
            const json = [];
            for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                const rowArray = rawData[i];
                if (rowArray.length === 0 || rowArray.every(c => c === "")) continue;

                const rowObj = {};
                rowArray.forEach((val, colIndex) => {
                    const h = headers[colIndex];
                    if (h) rowObj[h] = val;
                });
                json.push(rowObj);
            }

            // HOJA 2: COMPLEJIDAD (PISO/ALTURA)
            if (workbook.SheetNames.length > 1) {
                const sheet2Name = workbook.SheetNames[1];
                const worksheet2 = workbook.Sheets[sheet2Name];
                const rawData2 = XLSX.utils.sheet_to_json(worksheet2, { header: 1, defval: "" });

                let headerRowIndex2 = -1;
                for (let i = 0; i < Math.min(rawData2.length, 20); i++) {
                    if (rawData2[i] && rawData2[i].some(cell => String(cell).toUpperCase().includes('ORDEN INFOR'))) {
                        headerRowIndex2 = i;
                        break;
                    }
                }

                if (headerRowIndex2 !== -1) {
                    const headers2 = rawData2[headerRowIndex2].map(h => String(h).trim());
                    
                    // Mapa de conteos: { '0000065991': { piso: 1, altura: 2 } }
                    const countsMap = {};
                    
                    for (let i = headerRowIndex2 + 1; i < rawData2.length; i++) {
                        const r2 = rawData2[i];
                        if (!r2 || r2.length === 0) continue;
                        
                        let id = null;
                        let tipo = null;

                        r2.forEach((val, colIndex) => {
                            const h = headers2[colIndex].toUpperCase();
                            if (h.includes('ORDEN INFOR')) id = String(val).trim();
                            if (h === 'TIPO') tipo = String(val).toUpperCase().trim();
                        });

                        if (id && tipo) {
                            // Infor a veces manda IDs con padding de ceros.
                            const numId = parseInt(id, 10);
                            if (!countsMap[numId]) countsMap[numId] = { piso: 0, altura: 0 };
                            
                            if (tipo.includes('ALTURA')) countsMap[numId].altura++;
                            if (tipo.includes('PISO')) countsMap[numId].piso++;
                        }
                    }

                    // Inyectar piso y altura en el JSON principal
                    json.forEach(rowInfo => {
                        let rowId = null;
                        Object.keys(rowInfo).forEach(k => {
                            if (k.toUpperCase().includes('ORDEN INFOR')) rowId = String(rowInfo[k]).trim();
                        });

                        if (rowId) {
                            const numId = parseInt(rowId, 10);
                            const merge = countsMap[numId];
                            if (merge) {
                                rowInfo['PISO'] = merge.piso;
                                rowInfo['ALTURA'] = merge.altura;
                            }
                        }
                    });
                }
            }

            const result = window.db.upsertData(json);
            
            let message = `¡Éxito! ${result.total} órdenes totales.<br>`;
            message += `-> ${result.added} nuevas<br>`;
            message += `-> ${result.updated} actualizadas`;
            
            if (result.unlocked > 0) {
                message += `<br><span style="color:#d2a8ff; font-weight:bold;">¡Hay ${result.unlocked} pedido(s) DESTRABADO(s)!</span>`;
            }

            statusDiv.style.color = '#3fb950';
            statusDiv.innerHTML = message;

            renderDashboard();

        } catch (error) {
            console.error(error);
            statusDiv.style.color = '#da3633';
            statusDiv.innerText = 'Error al procesar: ' + error.message;
        }
    };
    reader.readAsArrayBuffer(file);
}

function classifyComplexity(altura, piso) {
    if (altura === 0 && piso > 0) return { type: '100% PISO', ratio: '0% Alt.', color: '#3fb950' };
    if (piso === 0 && altura > 0) return { type: '100% ALTURA', ratio: '100% Alt.', color: '#da3633' };
    if (altura > 0 && piso > 0) {
        const total = altura + piso;
        const ratio = Math.round((altura / total) * 100);
        return { type: 'MIXTO', ratio: `${ratio}% Alt.`, color: '#f1e05a' };
    }
    return { type: 'N/A', ratio: '-', color: '#8b949e' };
}

function isOldOrder(fechaISO) {
    if(!fechaISO) return false;
    const orderDate = new Date(fechaISO);
    const today = new Date();
    const diffTime = Math.abs(today - orderDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays > 3;
}

function isPriorityBrand(brand) {
    const b = String(brand).toUpperCase();
    return b.includes('CHERY') || b.includes('FOTON') || b.includes('DFSK');
}

let activeStatusFilter = null;

function toggleFilter(status) {
    if (activeStatusFilter === status) {
        activeStatusFilter = null; // Toggle off
    } else {
        activeStatusFilter = status;
    }
    renderDashboard();
}

function renderDashboard() {
    const orders = window.db.getOrders();
    
    // Calculate KPIs dynamically based ONLY on Excel states
    const counters = {};
    let pedidosAsignados = 0;

    orders.forEach(o => {
        let st = o.estadoExcel;
        if (st) {
            st = st.trim();
            st = st.charAt(0).toUpperCase() + st.slice(1).toLowerCase();
        } else {
            st = "Sin estado";
        }

        if (!counters[st]) counters[st] = 0;
        counters[st]++;

        if (o.asignadoA) {
            pedidosAsignados++;
        }
    });

    const kpiHTML = Object.entries(counters).sort((a,b) => b[1] - a[1]).map(([key, val]) => {
        let classColor = 'status-default';
        const keyLower = key.toLowerCase();
        
        if(keyLower.includes('preparaci')) classColor = 'status-preparacion';
        else if(keyLower.includes('completo')) classColor = 'status-preparado';
        else if(keyLower.includes('expedido')) classColor = 'status-expedidos';
        else if(keyLower.includes('lanzado')) classColor = 'status-lanzado';
        else if(keyLower.includes('pieza lanzada')) classColor = 'status-pieza-lanzada';
        else if(keyLower.includes('espera') || keyLower.includes('no asignado')) classColor = 'status-espera';

        const outlineSty = activeStatusFilter === key ? 'outline: 2px solid #58a6ff; transform: scale(1.05); z-index: 10;' : '';
        const opacSty = activeStatusFilter && activeStatusFilter !== key ? 'opacity: 0.5;' : '';

        return `
        <div class="card kpi-card ${classColor}" style="cursor: pointer; transition: all 0.2s; ${outlineSty} ${opacSty}" onclick="toggleFilter('${key}')">
            <h3>${key}</h3>
            <div class="value">${val}</div>
        </div>
        `;
    });

    // Add "Pedidos asignados" card
    const outlineStyAsignados = activeStatusFilter === 'Pedidos asignados' ? 'outline: 2px solid #58a6ff; transform: scale(1.05); z-index: 10;' : '';
    const opacStyAsignados = activeStatusFilter && activeStatusFilter !== 'Pedidos asignados' ? 'opacity: 0.5;' : '';
    kpiHTML.unshift(`
        <div class="card kpi-card" style="cursor: pointer; transition: all 0.2s; border-top-color: #58a6ff; ${outlineStyAsignados} ${opacStyAsignados}" onclick="toggleFilter('Pedidos asignados')">
            <h3 style="color:#58a6ff;">Pedidos asignados</h3>
            <div class="value">${pedidosAsignados}</div>
        </div>
    `);

    document.getElementById('kpi-container').innerHTML = kpiHTML.join('');

    // Render Table
    let tableOrders = [];
    
    if (activeStatusFilter) {
        if (activeStatusFilter === 'Pedidos asignados') {
            tableOrders = orders.filter(o => o.asignadoA);
        } else {
            tableOrders = orders.filter(o => {
                let st = o.estadoExcel ? o.estadoExcel.trim() : "Sin estado";
                st = st.charAt(0).toUpperCase() + st.slice(1).toLowerCase();
                return st === activeStatusFilter;
            });
        }
    } else {
        // Por defecto mostramos todo
        tableOrders = [...orders];
    }

    // Sort by priority -> Destrabados -> Old -> others
    tableOrders.sort((a,b) => {
        let scoreA = 0;
        let scoreB = 0;
        if(a.isDestrabado) scoreA += 100;
        if(b.isDestrabado) scoreB += 100;
        if(isOldOrder(a.fecha)) scoreA += 50;
        if(isOldOrder(b.fecha)) scoreB += 50;
        if(isPriorityBrand(a.familia)) scoreA += 25;
        if(isPriorityBrand(b.familia)) scoreB += 25;

        return scoreB - scoreA;
    });

    const tbody = document.getElementById('orders-tbody');
    const machinists = window.db.getMachinists();

    tbody.innerHTML = tableOrders.map(o => {
        const cx = classifyComplexity(o.altura, o.piso);
        let badges = '';
        if(o.isDestrabado) badges += `<span class="badge destrabado" style="margin-right:0.5rem">DESTRABADO</span>`;
        if(isPriorityBrand(o.familia)) badges += `<span class="badge brand" style="margin-right:0.5rem">PRIORIDAD</span>`;
        if(isOldOrder(o.fecha)) badges += `<span class="badge old" style="margin-right:0.5rem">+3 DÍAS</span>`;

        // Select for machinst
        const machOptions = machinists.map(m => 
            `<option value="${m}" ${o.asignadoA === m ? 'selected' : ''}>${m}</option>`
        ).join('');

        // Display state logic
        let stateDisplay = o.estado || 'Sin estado';
        if (o.estado === 'Preparado') {
            stateDisplay = `Preparado por: ${o.asignadoA || 'Desconocido'}`;
            badges += `<span class="badge" style="background:#58a6ff; color:white; margin-right:0.5rem">Completado</span>`;
        } else if (o.estado === 'En preparación') {
            stateDisplay = `En proceso (${o.asignadoA || 'N/A'})`;
            badges += `<span class="badge" style="background:#f1e05a; color:black; margin-right:0.5rem">En proceso</span>`;
        }

        return `
            <tr>
                <td>
                    <div style="font-weight: 600;">${o.id}</div>
                    <div style="margin-top:0.5rem;">${badges}</div>
                </td>
                <td>
                    <span class="badge" style="border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.5)">${stateDisplay}</span>
                </td>
                <td>${o.familia || '-'}</td>
                <td><strong style="font-size:1.1rem">${o.cantidad || 0}</strong></td>
                <td>
                    <div style="font-size:0.8rem; font-weight:600; color: ${cx.color}">${cx.type}</div>
                    <div style="font-size:0.75rem; color:#8b949e">Ratio: ${cx.ratio}</div>
                </td>
                <td>
                    <select onchange="window.db.assignMachinist('${o.id}', this.value); renderDashboard();">
                        <option value="">-- Sin asignar --</option>
                        ${machOptions}
                    </select>
                </td>
            </tr>
        `;
    }).join('');

    // Render Team Workload
    const teamStats = {};
    machinists.forEach(m => teamStats[m] = { pendientes: 0, proceso: 0, completados: 0 });
    
    orders.forEach(o => {
        if (o.asignadoA && teamStats[o.asignadoA]) {
            if (o.estado === 'Preparado') {
                teamStats[o.asignadoA].completados++;
            } else if (o.estado === 'En preparación') {
                teamStats[o.asignadoA].proceso++;
            } else {
                teamStats[o.asignadoA].pendientes++;
            }
        }
    });

    const teamHTML = machinists.map(m => {
        const s = teamStats[m];
        const total = s.pendientes + s.proceso + s.completados;
        const hasWork = total > 0;
        
        return `
            <div class="card kpi-card" style="opacity: ${hasWork ? '1' : '0.6'}; transition: all 0.2s; padding: 1rem; border-top-color: ${hasWork ? '#58a6ff' : '#30363d'}">
                <h3 style="margin-bottom: 0.5rem; font-size: 1rem; color: ${hasWork ? '#58a6ff' : '#8b949e'}; text-transform:none;">${m}</h3>
                <div style="font-size: 0.85rem; color: #c9d1d9; display: flex; flex-direction: column; gap: 0.25rem;">
                    <div style="display: flex; justify-content: space-between;">
                        <span>En espera:</span> <span style="font-weight: 600;">${s.pendientes}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span>En proceso:</span> <span style="font-weight: 600; color: #f1e05a;">${s.proceso}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span>Terminados:</span> <span style="font-weight: 600; color: #3fb950;">${s.completados}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const teamContainer = document.getElementById('team-container');
    if (teamContainer) {
        teamContainer.innerHTML = teamHTML;
        teamContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(160px, 1fr))';
    }

    lucide.createIcons();
}
