const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = process.env.PORT || 8080;

const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_electricidad_2024';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Función para enviar email con Resend
async function enviarEmail(to, subject, html) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: 'Control Electricidad <onboarding@resend.dev>',
            to,
            subject,
            html
        })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(JSON.stringify(err));
    }
    return res.json();
}

// Tarifa escalonada CRE Santa Cruz - Categoría Domiciliaria (D-PD-BT)
function calcularTarifaCRE(kwh) {
    if (kwh <= 0) return 0;
    if (kwh <= 15) return 13.73; // cargo mínimo fijo
    if (kwh <= 120) return kwh * 0.758;
    if (kwh <= 300) return kwh * 0.969;
    if (kwh <= 500) return kwh * 1.020;
    if (kwh <= 1000) return kwh * 1.068;
    return kwh * 1.479;
}

app.use(express.json());
app.use(express.static('./'));

const db = mysql.createConnection({
    host: process.env.MYSQLHOST || '50412o.h.filess.io',
    user: process.env.MYSQLUSER || 'control_electricidad_hotdetail',
    password: process.env.MYSQLPASSWORD || '92591b731b32a07875a4e1cf51da61f6ccbc3ee3',
    database: process.env.MYSQLDATABASE || 'control_electricidad_hotdetail',
    port: process.env.MYSQLPORT || 3307
});

db.connect((err) => {
    if (err) { console.log('Error conectando a MySQL:', err); }
    else { console.log('Conectado a MySQL ✅'); crearTablas(); }
});

function crearTablas() {
    const sqlUsuario = `
        CREATE TABLE IF NOT EXISTS usuario (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            codigo_recuperacion VARCHAR(255),
            codigo_expira DATETIME,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;
    const sqlRegistros = `
        CREATE TABLE IF NOT EXISTS registros (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tienda VARCHAR(100) NOT NULL,
            lectura DECIMAL(10,2) NOT NULL,
            kwh DECIMAL(10,2) NOT NULL,
            total DECIMAL(10,2) NOT NULL,
            mes VARCHAR(7) NOT NULL,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;
    db.query(sqlUsuario, (err) => {
        if (err) { console.log('Error creando tabla usuario:', err); return; }
        db.query(sqlRegistros, (err) => {
            if (err) { console.log('Error creando tabla registros:', err); return; }
            console.log('Tablas listas ✅');
            db.query('SELECT COUNT(*) as total FROM usuario', (err, res) => {
                if (err) return;
                const passwordHash = bcrypt.hashSync('admin1234', 10);
                if (res[0].total === 0) {
                    // Crear usuario admin por primera vez
                    db.query('INSERT INTO usuario (username, password_hash, email) VALUES (?, ?, ?)',
                        ['admin', passwordHash, 'gabriel19soto00@gmail.com'],
                        () => console.log('Usuario admin creado ✅'));
                } else {
                    // Siempre resetear la contraseña a admin1234 al arrancar
                    db.query('UPDATE usuario SET password_hash = ? WHERE username = ?',
                        [passwordHash, 'admin'],
                        () => console.log('Contraseña admin reseteada a admin1234 ✅'));
                }
            });
        });
    });
}

function verificarToken(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth) return res.status(401).json({ error: 'No autorizado' });
    const token = auth.split(' ')[1];
    if (!token || token.length < 10) return res.status(401).json({ error: 'Token inválido' });
    try { req.usuario = jwt.verify(token, JWT_SECRET); next(); }
    catch { res.status(401).json({ error: 'Token inválido o expirado' }); }
}

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

app.post('/api/solicitar-recuperacion', (req, res) => {
    const { email } = req.body;
    db.query('SELECT * FROM usuario WHERE email = ?', [email], (err, rows) => {
        if (err || rows.length === 0) return res.status(404).json({ error: 'No se encontró una cuenta con ese correo' });
        const user = rows[0];
        const codigo = Math.floor(100000 + Math.random() * 900000).toString();
        const expira = new Date(Date.now() + 15 * 60 * 1000);
        db.query('UPDATE usuario SET codigo_recuperacion = ?, codigo_expira = ? WHERE id = ?', [codigo, expira, user.id], async (err) => {
            if (err) return res.status(500).json({ error: 'Error interno' });
            const html = `
                <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 30px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #1a1a1a;">🔑 Recuperar contraseña</h2>
                    <p style="color: #666;">Tu código de recuperación es:</p>
                    <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                        <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1a1a1a;">${codigo}</span>
                    </div>
                    <p style="color: #999; font-size: 14px;">Este código expira en <strong>15 minutos</strong>.</p>
                    <p style="color: #999; font-size: 14px;">Si no solicitaste este código, ignorá este mensaje.</p>
                </div>
            `;
            try {
                await enviarEmail(email, 'Código de recuperación - Control de Electricidad', html);
                res.json({ mensaje: 'Código enviado al correo ✅' });
            } catch (error) {
                console.log('Error enviando email:', error);
                res.status(500).json({ error: 'Error enviando el correo' });
            }
        });
    });
});

app.post('/api/recuperar', (req, res) => {
    const { email, codigo, nueva_password } = req.body;
    db.query('SELECT * FROM usuario WHERE email = ?', [email], (err, rows) => {
        if (err || rows.length === 0) return res.status(400).json({ error: 'Error interno' });
        const user = rows[0];
        if (!user.codigo_recuperacion) return res.status(401).json({ error: 'No hay código activo. Solicitá uno nuevo.' });
        if (user.codigo_recuperacion !== codigo) return res.status(401).json({ error: 'Código incorrecto' });
        if (new Date() > new Date(user.codigo_expira)) return res.status(401).json({ error: 'El código expiró. Solicitá uno nuevo.' });
        const nuevoHash = bcrypt.hashSync(nueva_password, 10);
        db.query('UPDATE usuario SET password_hash = ?, codigo_recuperacion = NULL, codigo_expira = NULL WHERE id = ?', [nuevoHash, user.id], (err) => {
            if (err) return res.status(500).json({ error: 'Error actualizando contraseña' });
            res.json({ mensaje: 'Contraseña actualizada ✅' });
        });
    });
});

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

app.post('/api/guardar', verificarToken, (req, res) => {
    const { tienda, lectura, mes } = req.body;
    db.query('SELECT lectura FROM registros WHERE tienda = ? ORDER BY mes DESC LIMIT 1', [tienda], (err, resultados) => {
        if (err) return res.json({ error: err });
        let lecturaAnterior = resultados.length > 0 ? parseFloat(resultados[0].lectura) : 0;
        let kwh = Math.max(0, lectura - lecturaAnterior);
        const total = calcularTarifaCRE(kwh);
        db.query('SELECT id FROM registros WHERE tienda = ? AND mes = ?', [tienda, mes], (err, existe) => {
            if (err) return res.json({ error: err });
            if (existe.length > 0) {
                db.query('UPDATE registros SET lectura = ?, kwh = ?, total = ? WHERE tienda = ? AND mes = ?', [lectura, kwh, total, tienda, mes], (err) => {
                    if (err) return res.json({ error: err });
                    res.json({ mensaje: 'Actualizado ✅', kwh, total });
                });
            } else {
                db.query('INSERT INTO registros (tienda, lectura, kwh, total, mes) VALUES (?, ?, ?, ?, ?)', [tienda, lectura, kwh, total, mes], (err) => {
                    if (err) return res.json({ error: err });
                    res.json({ mensaje: 'Guardado ✅', kwh, total });
                });
            }
        });
    });
});

app.get('/api/lecturas-anteriores/:mes', verificarToken, (req, res) => {
    const mes = req.params.mes;
    db.query(`SELECT tienda, lectura, mes FROM registros r1 WHERE mes = (SELECT MAX(mes) FROM registros r2 WHERE r2.tienda = r1.tienda AND r2.mes < ?)`, [mes], (err, resultados) => {
        if (err) return res.json({ error: err });
        res.json(resultados);
    });
});

app.get('/api/registros/:mes', verificarToken, (req, res) => {
    const mes = req.params.mes;
    db.query('SELECT * FROM registros WHERE mes = ?', [mes], (err, resultados) => {
        if (err) return res.json({ error: err });
        res.json(resultados);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
