/**
 * Shared test helpers: in-memory MongoDB via mongodb-memory-server,
 * JWT signing, and Express app factory for supertest.
 *
 * Usage in any test file:
 *   const { connectDB, disconnectDB, clearDB, signToken, buildApp } = require('./helpers');
 */

const mongoose      = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt           = require('jsonwebtoken');
const express       = require('express');

// Set a predictable secret before any auth middleware imports
process.env.JWT_SECRET = 'test_secret_at_least_32_chars_long_xxx';
process.env.NODE_ENV   = 'test';

let mongod;

async function connectDB() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

async function disconnectDB() {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod?.stop();
}

async function clearDB() {
  const cols = Object.values(mongoose.connection.collections);
  await Promise.all(cols.map(c => c.deleteMany({})));
}

function signToken(payload, expiresIn = '1h') {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

/**
 * Builds a minimal Express app mounting one router — used so route tests
 * don't need to boot the real index.js (no DB connection on startup).
 */
function buildApp(path, router) {
  const app = express();
  app.use(express.json());
  // Expose sseClients so broadcast tests work
  app.locals.sseClients = new Set();
  app.use(path, router);
  return app;
}

module.exports = { connectDB, disconnectDB, clearDB, signToken, buildApp };
