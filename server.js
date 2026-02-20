const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDB, getConnectionStatus } = require('./config/db');

// Load env vars
dotenv.config();

// Connect to database (continues even if MongoDB is unavailable)
connectDB();

// Route files
const issues = require('./routes/issues');

const app = express();

// Body parser
app.use(express.json());

// Enable CORS
app.use(cors());

// Mount routers
app.use('/api/issues', issues);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: 'Server is running',
    database: getConnectionStatus() ? 'connected' : 'demo mode (in-memory)'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle unhandled promise rejections - don't exit in development
process.on('unhandledRejection', (err, promise) => {
  console.log(`Unhandled Error: ${err.message}`);
  // Don't exit the process - let the server continue running
});
