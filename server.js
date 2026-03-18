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

app.use(express.json());
app.use(express.static('./'));

const db = mysql.createConnection({
    host: process.env.MYSQLHOST || 'localhost',
    user: process.env.MYSQLUSER || 'pablo',
    password: process.env.MYSQLPASSWORD || '1234',
    database: process.env.MYSQLDATABASE || 'control_electricidad',
    port: process.env.MYSQLPORT || 3306
});

db.connect((err) => {
    if (err) { console.log('Error conectando a MySQL:', err); }
    else { console.log('Conectado a MySQL ✅'); crearTablaUsuario(); }
});

function crearTablaUsuario() {
    const sql = `
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
    db.query(sql, (err) => {
        if (err) { console.log('Error creando tabla usuario:', err); return; }
        const agregarColumna = (col, tipo) => {
            db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = ?`, [col], (err, rows) => {
                if (err || rows.length > 0) return;
                db.query(`ALTER TABLE usuario ADD COLUMN ${col} ${tipo}`, () => {});
            });
        };
        agregarColumna('email', 'VARCHAR(255)');
        agregarColumna('codigo_recuperacion', 'VARCHAR(255)');
        agregarColumna('codigo_expira', 'DATETIME');
        db.query('SELECT COUNT(*) as total FROM usuario', (err, res) => {
            if (err || res[0].total > 0) return;
            const passwordHash = bcrypt.hashSync('admin1234', 10);
            db.query('INSERT INTO usuario (username, password_hash, email) VALUES (?, ?, ?)',
                ['admin', passwordHash, 'gabriel19soto00@gmail.com'],
                () => console.log('Usuario por defecto creado ✅'));
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

// Endpoint temporal para arreglar columnas (eliminar después de usar)
app.get('/api/fix-columnas', (req, res) => {
    const pasos = [];
    db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'codigo_recuperacion'", (err, rows) => {
        if (rows.length === 0) {
            db.query("ALTER TABLE usuario ADD COLUMN codigo_recuperacion VARCHAR(255)", (err) => {
                pasos.push(err ? 'Error codigo_recuperacion: ' + err.message : 'codigo_recuperacion agregada ✅');
                db.query("ALTER TABLE usuario ADD COLUMN codigo_expira DATETIME", (err) => {
                    pasos.push(err ? 'Error codigo_expira: ' + err.message : 'codigo_expira agregada ✅');
                    res.json({ pasos });
                });
            });
        } else {
            res.json({ mensaje: 'Las columnas ya existen ✅', pasos });
        }
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
        const PRECIO_KWH = 2;
        const total = kwh * PRECIO_KWH;
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
