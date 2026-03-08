const express = require('express');
const mysql = require('mysql2');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('./'));

// Conexión a la base de datos
const db = mysql.createConnection({
    host: process.env.MYSQLHOST || 'localhost',
    user: process.env.MYSQLUSER || 'pablo',
    password: process.env.MYSQLPASSWORD || '1234',
    database: process.env.MYSQLDATABASE || 'control_electricidad',
    port: process.env.MYSQLPORT || 3306
});

db.connect((err) => {
    if (err) {
        console.log('Error conectando a MySQL:', err);
    } else {
        console.log('Conectado a MySQL ✅');
    }
});

// Ruta para GUARDAR la lectura del mes
app.post('/api/guardar', (req, res) => {
    const { tienda, lectura, mes } = req.body;

    // Busca la lectura del mes ANTERIOR para calcular los kWh consumidos
    const sqlAnterior = `
        SELECT lectura FROM registros 
        WHERE tienda = ? 
        ORDER BY mes DESC 
        LIMIT 1
    `;

    db.query(sqlAnterior, [tienda], (err, resultados) => {
        if (err) return res.json({ error: err });

        let lecturaAnterior = 0;
        let kwh = 0;

        if (resultados.length > 0) {
            // Si existe una lectura anterior, calcula la diferencia
            lecturaAnterior = parseFloat(resultados[0].lectura);
            kwh = lectura - lecturaAnterior;
            if (kwh < 0) kwh = 0; // Por si acaso se cambió el medidor
        } else {
            // Si es la primera vez que se registra esta tienda, kWh = 0
            kwh = 0;
        }

        const PRECIO_KWH = 2;
        const total = kwh * PRECIO_KWH;

        // Verifica si ya existe un registro para esta tienda en este mes
        const sqlExiste = 'SELECT id FROM registros WHERE tienda = ? AND mes = ?';
        db.query(sqlExiste, [tienda, mes], (err, existe) => {
            if (err) return res.json({ error: err });

            if (existe.length > 0) {
                // Si ya existe, actualiza el registro
                const sqlUpdate = 'UPDATE registros SET lectura = ?, kwh = ?, total = ? WHERE tienda = ? AND mes = ?';
                db.query(sqlUpdate, [lectura, kwh, total, tienda, mes], (err) => {
                    if (err) return res.json({ error: err });
                    res.json({ mensaje: 'Actualizado ✅', kwh, total });
                });
            } else {
                // Si no existe, inserta uno nuevo
                const sqlInsert = 'INSERT INTO registros (tienda, lectura, kwh, total, mes) VALUES (?, ?, ?, ?, ?)';
                db.query(sqlInsert, [tienda, lectura, kwh, total, mes], (err) => {
                    if (err) return res.json({ error: err });
                    res.json({ mensaje: 'Guardado ✅', kwh, total });
                });
            }
        });
    });
});

// Ruta para OBTENER las lecturas anteriores de todas las tiendas
app.get('/api/lecturas-anteriores/:mes', (req, res) => {
    const mes = req.params.mes;

    // Obtiene la última lectura de cada tienda ANTES del mes actual
    const sql = `
        SELECT tienda, lectura, mes FROM registros r1
        WHERE mes = (
            SELECT MAX(mes) FROM registros r2 
            WHERE r2.tienda = r1.tienda AND r2.mes < ?
        )
    `;

    db.query(sql, [mes], (err, resultados) => {
        if (err) return res.json({ error: err });
        res.json(resultados);
    });
});

// Ruta para OBTENER registros de un mes específico
app.get('/api/registros/:mes', (req, res) => {
    const mes = req.params.mes;
    const sql = 'SELECT * FROM registros WHERE mes = ?';
    db.query(sql, [mes], (err, resultados) => {
        if (err) return res.json({ error: err });
        res.json(resultados);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
