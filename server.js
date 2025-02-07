// server.js
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
require('dotenv').config();

// Import Message model
const Message = require('./models/message.js');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware configuration
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// In-memory stores for demonstration purposes
let students = [];   // Each student: { reg, name, branch, gender, email, crushes }
let otpStore = {};   // Stores OTP keyed by email

// Configure Nodemailer transporter (using Gmail)
let transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,  // Sender's email address
    pass: process.env.EMAIL_PASS   // Gmail App Password
  },
  debug: true,
  logger: true
});

// Utility function: Validate college email and extract name and reg number.
// Expected format: firstName.20XXXXXX@mnnit.ac.in
function parseCollegeEmail(email) {
  const regex = /^([a-zA-Z]+)\.(20\d{6})@mnnit\.ac\.in$/;
  const match = email.match(regex);
  if (match) {
    return {
      name: match[1],
      reg: match[2]
    };
  }
  return null;
}

// Route: Serve the login/registration page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route: Process login, validate college email, generate OTP, and send email
app.post('/login', (req, res) => {
  const { email, gender, branch } = req.body;
  const parsed = parseCollegeEmail(email);
  if (!parsed) {
    return res.send("Invalid email format. Please use your college email (e.g., john.20123456@mnnit.ac.in).");
  }
  const { name, reg } = parsed;
  
  // Generate a 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[email] = otp; // Store the OTP temporarily

  // Prepare the OTP email
  let mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your OTP for MNNIT Matchmaking Login',
    text: `Hi ${name},\n\nYour OTP is: ${otp}\n\nRegards,\nMNNIT Matchmaking Team`
  };

  transporter.sendMail(mailOptions, function(error, info) {
    if (error) {
      console.error('Error sending OTP:', error);
      return res.send('Error sending OTP. Please try again.');
    } else {
      console.log('OTP sent:', info.response);
      // Save or update student details
      let student = students.find(s => s.reg === reg);
      if (!student) {
        student = { reg, name, branch, gender, email, crushes: [] };
        students.push(student);
      } else {
        student.gender = gender;
        student.branch = branch;
      }
      // Display OTP verification page
      res.send(`
        <html>
          <head>
            <title>OTP Verification</title>
            <link rel="stylesheet" href="/style.css">
          </head>
          <body>
            <div class="container">
              <h1>OTP Verification</h1>
              <p>An OTP has been sent to ${email}. Please enter it below:</p>
              <form action="/verify-otp" method="POST">
                <input type="hidden" name="email" value="${email}" />
                <input type="hidden" name="reg" value="${reg}" />
                <label for="otp">OTP:</label>
                <input type="text" id="otp" name="otp" required />
                <button type="submit">Verify OTP</button>
              </form>
            </div>
          </body>
        </html>
      `);
    }
  });
});

// Route: Verify OTP entered by the user
app.post('/verify-otp', (req, res) => {
  const { email, otp, reg } = req.body;
  if (otpStore[email] && otpStore[email] === otp) {
    delete otpStore[email]; // Remove OTP once verified
    res.redirect(`/choices?reg=${reg}`);
  } else {
    res.send('Invalid OTP. Please try again.');
  }
});

// Route: Crush selection page
app.get('/choices', (req, res) => {
  const reg = req.query.reg;
  const student = students.find(s => s.reg === reg);
  if (!student) return res.redirect('/');
  res.send(`
    <html>
      <head>
        <title>Choose Your Crushes</title>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <div class="container">
          <h1>Hello, ${student.name}!</h1>
          <p>Enter the registration numbers (comma separated) of up to 5 people you have a crush on:</p>
          <form action="/submit-choices" method="POST">
            <input type="hidden" name="reg" value="${student.reg}" />
            <input type="text" name="crushes" placeholder="e.g., 20123456,20123457,20123458" required/>
            <button type="submit">Submit Choices</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

// Route: Process crush choices and check for mutual matches
app.post('/submit-choices', (req, res) => {
  const { reg, crushes } = req.body;
  const student = students.find(s => s.reg === reg);
  if (!student) return res.redirect('/');
  student.crushes = crushes.split(',').map(s => s.trim());

  let matches = [];
  student.crushes.forEach(crushReg => {
    const other = students.find(s => s.reg === crushReg);
    if (other && other.crushes.includes(student.reg)) {
      matches.push(other);
    }
  });

  let responseHtml = `
    <html>
      <head>
        <title>Your Matches</title>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <div class="container">
          <h1>Hi ${student.name}!</h1>
  `;
  if (matches.length > 0) {
    responseHtml += `<h2>Mutual Matches Found!</h2><ul>`;
    matches.forEach(match => {
      responseHtml += `<li>${match.name} (Reg: ${match.reg}) - <a href="/chat?user1=${student.reg}&user2=${match.reg}">Chat Now</a></li>`;
    });
    responseHtml += `</ul>`;
  } else {
    responseHtml += `<h2>No mutual matches found yet.</h2>`;
  }
  responseHtml += `<a href="/">Back to Home</a></div></body></html>`;
  res.send(responseHtml);
});

// Route: Serve the chat interface page
app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Socket.IO: Real-time chat handling with additional features
io.on('connection', (socket) => {
  console.log('A user connected to chat.');
  
  // When a client joins a room, load chat history from MongoDB
  socket.on('joinRoom', async (data) => {
    const { room, user } = data; // user is the registration number
    socket.join(room);
    console.log(`User ${user} joined room: ${room}`);
    try {
      const messages = await Message.find({ room }).sort({ timestamp: 1 });
      socket.emit('chatHistory', messages);
    } catch (err) {
      console.error('Error loading chat history:', err);
    }
  });

  // Handle incoming chat messages
  socket.on('chatMessage', async (data) => {
    // Data should include room, message, and sender (registration number)
    const newMessage = new Message({
      room: data.room,
      sender: data.sender,
      text: data.message
    });
    try {
      await newMessage.save();
      io.to(data.room).emit('chatMessage', {
        sender: data.sender,
        text: data.message,
        timestamp: newMessage.timestamp
      });
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });
  
  // Typing indicator events
  socket.on('typing', (data) => {
    socket.to(data.room).emit('typing', data);
  });
  
  socket.on('stopTyping', (data) => {
    socket.to(data.room).emit('stopTyping', data);
  });
  
  // Mark messages as read
  socket.on('markAsRead', async (data) => {
    // data: { room, user }
    try {
      await Message.updateMany(
        { room: data.room, readBy: { $ne: data.user } },
        { $push: { readBy: data.user } }
      );
      // Optionally, notify others that messages have been read
      socket.to(data.room).emit('messagesRead', { user: data.user });
    } catch (err) {
      console.error('Error updating read receipts:', err);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected from chat.');
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
