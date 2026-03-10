const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = process.env.PORT || 8080;

const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_electricidad_2024';

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
        crearTablaUsuario();
    }
});

// Crea la tabla de usuario si no existe
function crearTablaUsuario() {
    const sql = `
        CREATE TABLE IF NOT EXISTS usuario (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            codigo_recuperacion VARCHAR(255) NOT NULL,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;
    db.query(sql, (err) => {
        if (err) { console.log('Error creando tabla usuario:', err); return; }
        // Si no hay usuario, crea uno por defecto
        db.query('SELECT COUNT(*) as total FROM usuario', (err, res) => {
            if (err || res[0].total > 0) return;
            const passwordHash = bcrypt.hashSync('admin1234', 10);
            const codigoHash = bcrypt.hashSync('RECUPERAR-2024', 10);
            db.query(
                'INSERT INTO usuario (username, password_hash, codigo_recuperacion) VALUES (?, ?, ?)',
                ['admin', passwordHash, codigoHash],
                () => console.log('Usuario por defecto creado ✅ user: admin | pass: admin1234 | codigo: RECUPERAR-2024')
            );
        });
    });
}

// Middleware para verificar JWT
function verificarToken(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth) return res.status(401).json({ error: 'No autorizado' });
    const token = auth.split(' ')[1];
    try {
        req.usuario = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

// ── AUTH ROUTES ──

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM usuario WHERE username = ?', [username], (err, rows) => {
        if (err || rows.length === 0) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        const user = rows[0];
        if (!bcrypt.compareSync(password, user.password_hash))
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, username: user.username });
    });
});

// Recuperar contraseña con código
app.post('/api/recuperar', (req, res) => {
    const { codigo, nueva_password } = req.body;
    db.query('SELECT * FROM usuario LIMIT 1', (err, rows) => {
        if (err || rows.length === 0) return res.status(400).json({ error: 'Error interno' });
        const user = rows[0];
        if (!bcrypt.compareSync(codigo, user.codigo_recuperacion))
            return res.status(401).json({ error: 'Código de recuperación incorrecto' });
        const nuevoHash = bcrypt.hashSync(nueva_password, 10);
        db.query('UPDATE usuario SET password_hash = ? WHERE id = ?', [nuevoHash, user.id], (err) => {
            if (err) return res.status(500).json({ error: 'Error actualizando contraseña' });
            res.json({ mensaje: 'Contraseña actualizada ✅' });
        });
    });
});

// Cambiar contraseña (autenticado)
app.post('/api/cambiar-password', verificarToken, (req, res) => {
    const { password_actual, nueva_password } = req.body;
    db.query('SELECT * FROM usuario WHERE id = ?', [req.usuario.id], (err, rows) => {
        if (err || rows.length === 0) return res.status(400).json({ error: 'Error interno' });
        const user = rows[0];
        if (!bcrypt.compareSync(password_actual, user.password_hash))
            return res.status(401).json({ error: 'Contraseña actual incorrecta' });
        const nuevoHash = bcrypt.hashSync(nueva_password, 10);
        db.query('UPDATE usuario SET password_hash = ? WHERE id = ?', [nuevoHash, user.id], (err) => {
            if (err) return res.status(500).json({ error: 'Error actualizando contraseña' });
            res.json({ mensaje: 'Contraseña cambiada ✅' });
        });
    });
});

// ── APP ROUTES (protegidas) ──

app.post('/api/guardar', verificarToken, (req, res) => {
    const { tienda, lectura, mes } = req.body;

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
            lecturaAnterior = parseFloat(resultados[0].lectura);
            kwh = lectura - lecturaAnterior;
            if (kwh < 0) kwh = 0;
        }

        const PRECIO_KWH = 2;
        const total = kwh * PRECIO_KWH;

        const sqlExiste = 'SELECT id FROM registros WHERE tienda = ? AND mes = ?';
        db.query(sqlExiste, [tienda, mes], (err, existe) => {
            if (err) return res.json({ error: err });

            if (existe.length > 0) {
                const sqlUpdate = 'UPDATE registros SET lectura = ?, kwh = ?, total = ? WHERE tienda = ? AND mes = ?';
                db.query(sqlUpdate, [lectura, kwh, total, tienda, mes], (err) => {
                    if (err) return res.json({ error: err });
                    res.json({ mensaje: 'Actualizado ✅', kwh, total });
                });
            } else {
                const sqlInsert = 'INSERT INTO registros (tienda, lectura, kwh, total, mes) VALUES (?, ?, ?, ?, ?)';
                db.query(sqlInsert, [tienda, lectura, kwh, total, mes], (err) => {
                    if (err) return res.json({ error: err });
                    res.json({ mensaje: 'Guardado ✅', kwh, total });
                });
            }
        });
    });
});

app.get('/api/lecturas-anteriores/:mes', verificarToken, (req, res) => {
    const mes = req.params.mes;
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

app.get('/api/registros/:mes', verificarToken, (req, res) => {
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
