require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');

const db = require('./db');
const { sendMail } = require('./mailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('[:date[iso]] :method :url :status :res[content-length] - :response-time ms'));
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));

const uploadDir = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'data', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const SECRET_KEY = process.env.JWT_SECRET || 'super_secret_key_for_jwt';

const authenticateAdmin = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    req.admin = decoded;
    next();
  });
};

const authenticateAny = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    req.user = decoded;
    next();
  });
};

const formatId = (id) => 'TKT-' + String(id).padStart(5, '0');

/* --- MINIMALIST HTML EMAIL TEMPLATES --- */
const getPremiumEmailTemplate = (brand, title, content) => `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #09090b; border: 1px solid #27272a; border-radius: 12px; overflow: hidden; color: #fafafa;">
  <div style="padding: 32px; border-bottom: 1px solid #27272a;">
    <p style="color: #a1a1aa; margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">${brand}</p>
    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">${title}</h1>
  </div>
  <div style="padding: 32px;">
    ${content}
  </div>
  <div style="padding: 24px 32px; text-align: center; border-top: 1px solid #27272a; background-color: #18181b;">
    <p style="color: #52525b; margin: 0; font-size: 12px;">© ${new Date().getFullYear()} ${brand}. Todos los derechos reservados.</p>
  </div>
</div>
`;

// --- AUTHENTICATION ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    bcrypt.compare(password, user.password, (err, result) => {
      if (result) {
        const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ token, role: user.role });
      } else {
        res.status(401).json({ error: 'Contraseña inválida' });
      }
    });
  });
});

// --- TICKETS (Public / Client) ---
app.post('/api/tickets', upload.single('file'), (req, res) => {
  const { brand, subject, description, email, category, urgency, phone } = req.body;
  const filePath = req.file ? req.file.filename : null;
  const originalFileName = req.file ? req.file.originalname : null;

  const query = 'INSERT INTO tickets (brand, subject, description, email, filePath, originalFileName, category, urgency, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
  db.run(query, [brand, subject, description, email, filePath, originalFileName, category, urgency, phone], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    
    const ticketId = this.lastID;
    const formattedId = formatId(ticketId);
    
    const content = `
      <p style="color: #d4d4d8; line-height: 1.6; font-size: 15px;">Tu ticket <strong>${formattedId}</strong> ha sido registrado en nuestro sistema.</p>
      <div style="background-color: #18181b; border: 1px solid #27272a; padding: 20px; margin: 24px 0; border-radius: 8px;">
        <table style="width: 100%; font-size: 14px; color: #d4d4d8; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; border-bottom: 1px solid #27272a;"><strong>Asunto:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #27272a; text-align: right;">${subject}</td></tr>
          <tr><td style="padding: 6px 0; border-bottom: 1px solid #27272a;"><strong>Categoría:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #27272a; text-align: right;">${category || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>Prioridad:</strong></td><td style="padding: 6px 0; text-align: right;">${urgency || 'N/A'}</td></tr>
        </table>
      </div>
      <p style="color: #a1a1aa; line-height: 1.6; font-size: 14px;">Nuestro equipo técnico revisará el requerimiento y te contactará pronto a través de este medio.</p>
    `;
    const htmlContent = getPremiumEmailTemplate(brand, 'Hemos recibido tu reporte', content);
    sendMail(email, `${formattedId} - ${subject}`, htmlContent);

    res.json({ success: true, ticketId });
  });
});

app.get('/api/tickets/user', (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({error: 'Email is required'});
    db.all('SELECT * FROM tickets WHERE email = ? ORDER BY createdAt DESC', [email], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/tickets/:id/messages', (req, res) => {
  const { id } = req.params;
  db.all('SELECT * FROM messages WHERE ticketId = ? ORDER BY createdAt ASC', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/tickets', authenticateAdmin, (req, res) => {
  db.all('SELECT * FROM tickets ORDER BY createdAt DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/admin/tickets/:id', authenticateAny, (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM tickets WHERE id = ?', [id], (err, ticket) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(ticket);
  });
});

// --- APPROVAL SYSTEM ROUTES ---
app.post('/api/admin/tickets/:id/request-approval', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;
  const formattedId = formatId(id);

  db.get('SELECT * FROM tickets WHERE id = ?', [id], (err, ticket) => {
    if (err || !ticket) return res.status(404).json({ error: 'Ticket not found' });
    
    const q = "UPDATE tickets SET approvalState = 'Wait', karenApproval = 'Pending', raulApproval = 'Pending' WHERE id = ?";
    db.run(q, [id], function(err) {
       if(err) return res.status(500).json({error: err.message});
       
       const messageText = `El ticket fue enviado a proceso de Aprobación Gerencial (Karen y Raúl).${comment ? `\n\nComentario del Administrador:\n${comment}` : ''}`;
       
       db.run("INSERT INTO messages (ticketId, sender, message) VALUES (?, 'System', ?)", [id, messageText]);

       // Send email to managers
       const managers = ['kcalderon@oemoda.com', 'rgalvan@oemoda.com'];
       const content = `
         <p style="color: #d4d4d8; line-height: 1.6; font-size: 15px;">Se requiere tu aprobación para el ticket <strong>${formattedId}</strong>.</p>
         <div style="background-color: #18181b; border: 1px solid #27272a; padding: 20px; margin: 24px 0; border-radius: 8px;">
           <table style="width: 100%; font-size: 14px; color: #d4d4d8; border-collapse: collapse;">
             <tr><td style="padding: 6px 0; border-bottom: 1px solid #27272a;"><strong>Asunto:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #27272a; text-align: right;">${ticket.subject}</td></tr>
             <tr><td style="padding: 6px 0; border-bottom: 1px solid #27272a;"><strong>Categoría:</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #27272a; text-align: right;">${ticket.category || 'N/A'}</td></tr>
             <tr><td style="padding: 6px 0;"><strong>Prioridad:</strong></td><td style="padding: 6px 0; text-align: right;">${ticket.urgency || 'N/A'}</td></tr>
           </table>
         </div>
         ${comment ? `
         <p style="color: #d4d4d8; line-height: 1.6; font-size: 15px;"><strong>Comentario del Administrador:</strong></p>
         <div style="background-color: #18181b; border: 1px solid #27272a; border-left: 4px solid #3b82f6; padding: 16px; margin: 16px 0; border-radius: 4px; color: #a1a1aa; font-style: italic; white-space: pre-wrap;">
           ${comment}
         </div>
         ` : ''}
         <p style="color: #a1a1aa; line-height: 1.6; font-size: 14px; text-align: center; margin-top: 24px;">Por favor, ingresa al panel para aprobar o rechazar este ticket.</p>
       `;
       const htmlContent = getPremiumEmailTemplate(ticket.brand, `Aprobación Requerida: ${formattedId}`, content);
       
       managers.forEach(email => {
         sendMail(email, `Aprobación Requerida ${formattedId}: ${ticket.subject}`, htmlContent).catch(console.error);
       });
       
       res.json({success: true});
    });
  });
});

app.get('/api/approver/tickets', authenticateAny, (req, res) => {
  db.all("SELECT * FROM tickets WHERE approvalState = 'Wait' ORDER BY createdAt DESC", (err, rows) => {
     res.json(rows || []);
  });
});

app.post('/api/approver/tickets/:id/vote', authenticateAny, (req, res) => {
   const { id } = req.params;
   const { vote, comment } = req.body; 
   const username = req.user.username; 
   
   if (username !== 'karen' && username !== 'raul') return res.status(403).json({error: 'Invalid approver'});
   
   db.get('SELECT * FROM tickets WHERE id = ?', [id], (err, ticket) => {
       if(!ticket) return res.status(404).json({error: 'Not found'});
       
       let kVote = ticket.karenApproval;
       let rVote = ticket.raulApproval;
       
       if (username === 'karen') kVote = vote;
       if (username === 'raul') rVote = vote;
       
       let newState = 'Wait';
       if (kVote === 'Approved' && rVote === 'Approved') newState = 'Approved';
       if (kVote === 'Rejected' || rVote === 'Rejected') newState = 'Rejected';
       
       db.run("UPDATE tickets SET karenApproval = ?, raulApproval = ?, approvalState = ? WHERE id = ?", [kVote, rVote, newState, id], () => {
           let reviewerName = username.charAt(0).toUpperCase() + username.slice(1);
           const reviewText = `${reviewerName} ha ${vote === 'Approved' ? 'APROBADO' : 'RECHAZADO'} el ticket. ${comment ? 'Comentario: '+comment : ''}`;
           db.run("INSERT INTO messages (ticketId, sender, message) VALUES (?, ?, ?)", [id, 'System', reviewText]);
           
           if (newState === 'Approved') {
              db.run("INSERT INTO messages (ticketId, sender, message) VALUES (?, 'System', '✅ El ticket ha sido APROBADO por ambos gerentes y puede iniciar su desarrollo.')", [id], () => {
                 db.run("UPDATE tickets SET status = 'En progreso' WHERE id = ?", [id]);
              });
           } else if (newState === 'Rejected') {
              db.run("INSERT INTO messages (ticketId, sender, message) VALUES (?, 'System', '❌ El ticket ha sido RECHAZADO y no procederá.')", [id], () => {
                 db.run("UPDATE tickets SET status = 'Cerrado' WHERE id = ?", [id]);
              });
           }
           res.json({success: true, newState});
       });
   });
});

app.put('/api/admin/tickets/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status, dueDate } = req.body;
  const formattedId = formatId(id);
  
  db.get('SELECT * FROM tickets WHERE id = ?', [id], (err, ticket) => {
    if (err || !ticket) return res.status(404).json({ error: 'Ticket not found' });
    
    const query = 'UPDATE tickets SET status = ?, dueDate = ? WHERE id = ?';
    db.run(query, [status, dueDate, id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      let updates = [];
      if (ticket.status !== status) updates.push(`El estado ha cambiado a <b style="color:#ffffff">${status}</b>`);
      if (dueDate && ticket.dueDate !== dueDate) updates.push(`Se fijó un SLA / fecha para: <b style="color:#ffffff">${dueDate}</b>`);
      
      if (updates.length > 0) {
          const content = `
            <p style="color: #d4d4d8; line-height: 1.6; font-size: 15px;">Se ha registrado una actualización oficial en el ticket <strong>${formattedId}</strong>:</p>
            <ul style="color: #a1a1aa; font-size: 14px; line-height: 1.7; padding-left: 20px;">
              ${updates.map(u => `<li style="margin-bottom: 8px;">${u}</li>`).join('')}
            </ul>
          `;
          const htmlContent = getPremiumEmailTemplate(ticket.brand, `Actualización: ${formattedId}`, content);
          sendMail(ticket.email, `Actualización ${formattedId}: ${ticket.subject}`, htmlContent);
      }
      res.json({ success: true });
    });
  });
});

app.post('/api/tickets/:id/messages', (req, res) => {
  const { id } = req.params;
  const { sender, message, isAdmin } = req.body;
  const formattedId = formatId(id);
  
  const query = 'INSERT INTO messages (ticketId, sender, message) VALUES (?, ?, ?)';
  db.run(query, [id, sender, message], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    
    if (isAdmin) {
      db.get('SELECT email, subject, brand FROM tickets WHERE id = ?', [id], (err, ticket) => {
         if (ticket) {
            const content = `
              <p style="color: #d4d4d8; line-height: 1.6; font-size: 15px;">El equipo de desarrollo añadió un comentario interno:</p>
              <div style="background-color: #18181b; border: 1px solid #27272a; border-left: 4px solid #ffffff; padding: 16px; margin: 24px 0; border-radius: 4px; color: #a1a1aa; font-style: italic;">
                ${message}
              </div>
            `;
            const htmlContent = getPremiumEmailTemplate(ticket.brand, `Nuevo Mensaje en ${formattedId}`, content);
            sendMail(ticket.email, `Nuevo Mensaje ${formattedId}`, htmlContent);
         }
      });
    }
    res.json({ success: true, messageId: this.lastID });
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Servidor corriendo API en puerto ' + PORT));
