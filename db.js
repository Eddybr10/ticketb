const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, 'tickets.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error al conectar con la base de datos:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite.');
    db.serialize(() => {
      // Tabla de usuarios (admin)
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT
      )`);
      
      // Tabla de tickets
      db.run(`CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand TEXT,
        subject TEXT,
        description TEXT,
        email TEXT,
        status TEXT DEFAULT 'Abierto',
        dueDate TEXT,
        filePath TEXT,
        originalFileName TEXT,
        category TEXT,
        urgency TEXT,
        orderNumber TEXT,
        phone TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, () => {
         // Migraciones automáticas (ignora error si las columnas ya existen)
         db.run("ALTER TABLE tickets ADD COLUMN category TEXT", () => {});
         db.run("ALTER TABLE tickets ADD COLUMN urgency TEXT", () => {});
         db.run("ALTER TABLE tickets ADD COLUMN orderNumber TEXT", () => {});
         db.run("ALTER TABLE tickets ADD COLUMN phone TEXT", () => {});
         db.run("UPDATE tickets SET status = 'Abierto' WHERE status = 'Pendiente'", () => {});
         db.run("ALTER TABLE tickets ADD COLUMN approvalState TEXT DEFAULT 'None'", () => {});
         db.run("ALTER TABLE tickets ADD COLUMN karenApproval TEXT DEFAULT 'Pending'", () => {});
         db.run("ALTER TABLE tickets ADD COLUMN raulApproval TEXT DEFAULT 'Pending'", () => {});
      });

      // Tabla de mensajes
      db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticketId INTEGER,
        sender TEXT,
        message TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticketId) REFERENCES tickets (id)
      )`);

      // Crear usuario admin por defecto si no existe
      bcrypt.hash('admin123', 10, (err, hash) => {
        if (err) return;
        db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, row) => {
          if (!row) {
             db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', hash, 'admin']);
             console.log('Usuario administrador creado (admin / admin123)');
          }
        });
      });
      // Crear aprobadores Karen y Raul
      bcrypt.hash('karen123', 10, (err, hash) => {
         if (err) return;
         db.run("INSERT OR IGNORE INTO users (username, password, role) VALUES ('karen', ?, 'approver')", [hash]);
      });
      bcrypt.hash('raul123', 10, (err, hash) => {
         if (err) return;
         db.run("INSERT OR IGNORE INTO users (username, password, role) VALUES ('raul', ?, 'approver')", [hash]);
      });
    });
  }
});

module.exports = db;
 
