const express = require('express');        // Carga Express
const mysql = require('mysql2');           // Carga el conector de MySQL
const app = express();
const PORT = 3000;

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

// Conecta a la base de datos
db.connect((err) => {
    if (err) {
        console.log('Error conectando a MySQL:', err); // Si falla muestra el error
    } else {
        console.log('Conectado a MySQL ✅');            // Si funciona muestra esto
    }
});

// Ruta para GUARDAR un registro
app.post('/api/guardar', (req, res) => {
    console.log('Datos recibidos:', req.body); // ← AGREGA ESTA LÍNEA
    const { tienda, kwh, total, mes } = req.body;
    const sql = 'INSERT INTO registros (tienda, kwh, total, mes) VALUES (?, ?, ?, ?)';
    db.query(sql, [tienda, kwh, total, mes], (err, result) => {
        if (err) {
            console.log('Error SQL:', err); // ← Y ESTA
            return res.json({ error: err });
        }
        console.log('Insertado:', result);   // ← Y ESTA
        res.json({ mensaje: 'Guardado correctamente ✅' });
    });
});

// Ruta para OBTENER registros de un mes
app.get('/api/registros/:mes', (req, res) => {     // GET = pedir datos
    const mes = req.params.mes;                    // El mes viene en la URL
    const sql = 'SELECT * FROM registros WHERE mes = ?';
    db.query(sql, [mes], (err, resultados) => {
        if (err) return res.json({ error: err });
        res.json(resultados);                      // Devuelve los registros al frontend
    });
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});