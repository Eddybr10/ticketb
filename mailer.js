require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // false para STARTTLS en 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const sendMail = async (to, subject, htmlContent) => {
  try {
    const info = await transporter.sendMail({
      from: '"Eddy" <eddy201222@gmail.com>',
      to,
      subject,
      html: htmlContent
    });

    console.log('Correo enviado: %s a %s', info.messageId, to);
    return info;
  } catch (error) {
    console.error('Error al enviar correo SMTP:', error);
    throw error;
  }
};

module.exports = { sendMail };