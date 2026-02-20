# PublicBoard Backend 🚀

The RESTful API server for PublicBoard - A community issue reporting platform. Built with Node.js, Express.js, and MongoDB.

## 📋 Overview

This backend provides a robust API for managing community issues, including CRUD operations, authentication, and data persistence. It's designed to be scalable, secure, and easy to maintain.

## 🛠️ Tech Stack

- **Node.js** - JavaScript runtime environment
- **Express.js** - Fast, unopinionated web framework
- **MongoDB** - NoSQL database for flexible data storage
- **Mongoose** - Elegant MongoDB object modeling for Node.js
- **CORS** - Cross-Origin Resource Sharing middleware
- **dotenv** - Environment variable management
- **nodemon** - Development utility that auto-restarts the server

## 📦 Installation

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (optional - can run in demo mode)

### Setup Instructions

1. **Navigate to the backend directory**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root of the backend directory:
   ```env
   # Server Configuration
   PORT=5000
   NODE_ENV=development
   
   # Database Configuration
   MONGODB_URI=mongodb://localhost:27017/publicboard
   
   # Security (optional)
   JWT_SECRET=your-super-secret-jwt-key
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

   For production:
   ```bash
   npm start
   ```

## 🗂️ Project Structure

```
backend/
├── config/
│   └── db.js              # Database connection configuration
├── controllers/
│   └── issues.js          # Issue-related business logic
├── models/
│   └── Issue.js           # MongoDB Issue model/schema
├── routes/
│   └── issues.js          # Issue API routes
├── utils/
│   └── errorHandler.js    # Error handling utilities
├── .env                   # Environment variables (create this)
├── .gitignore            # Git ignore file
├── package.json          # Dependencies and scripts
├── server.js             # Main server entry point
└── README.md             # This file
```

## 🔌 API Endpoints

### Issues Management

| Method | Endpoint | Description | Authentication |
|--------|----------|-------------|----------------|
| GET | `/api/issues` | Get all issues | Public |
| GET | `/api/issues/:id` | Get specific issue by ID | Public |
| POST | `/api/issues` | Create new issue | Public |
| PUT | `/api/issues/:id` | Update issue | Admin |
| DELETE | `/api/issues/:id` | Delete issue | Admin |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check and server status |

### Example API Calls

**Get all issues:**
```bash
curl http://localhost:5000/api/issues
```

**Create a new issue:**
```bash
curl -X POST http://localhost:5000/api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Broken Streetlight",
    "description": "Streetlight at main intersection is not working",
    "location": "Main St & Oak Ave",
    "category": "Infrastructure",
    "priority": "High"
  }'
```

**Get specific issue:**
```bash
curl http://localhost:5000/api/issues/64a1b2c3d4e5f6789012345
```

## 🗄️ Database Schema

### Issue Model

```javascript
{
  _id: ObjectId,
  title: String,           // Issue title
  description: String,      // Detailed description
  location: String,         // Location of the issue
  category: String,         // Issue category (Infrastructure, Safety, etc.)
  priority: String,         // Priority level (Low, Medium, High)
  status: String,          // Current status (Open, In Progress, Resolved)
  reportedBy: String,      // Name of reporter
  contactInfo: String,      // Contact information
  createdAt: Date,         // Creation timestamp
  updatedAt: Date,         // Last update timestamp
  resolvedAt: Date         // Resolution timestamp (if applicable)
}
```

## 🔧 Configuration

### Database Connection

The application supports both MongoDB and in-memory demo mode:

- **MongoDB Mode**: Full persistence with MongoDB
- **Demo Mode**: In-memory storage for development/testing

The server automatically falls back to demo mode if MongoDB is unavailable.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 5000 |
| `NODE_ENV` | Environment mode | development |
| `MONGODB_URI` | MongoDB connection string | mongodb://localhost:27017/publicboard |
| `JWT_SECRET` | JWT signing secret | (auto-generated) |

## 🧪 Development

### Running Tests
```bash
npm test
```

### Development Mode
```bash
npm run dev
```
This starts the server with nodemon for auto-restart on file changes.

### Linting
```bash
npm run lint
```

## 🚀 Deployment

### Production Build

1. **Set production environment variables**
   ```env
   NODE_ENV=production
   MONGODB_URI=mongodb://your-production-db
   ```

2. **Install production dependencies**
   ```bash
   npm ci --only=production
   ```

3. **Start the server**
   ```bash
   npm start
   ```

### Docker Deployment

Create a `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t publicboard-backend .
docker run -p 5000:5000 publicboard-backend
```

## 🔒 Security Features

- **CORS Configuration**: Cross-origin requests properly configured
- **Input Validation**: Request data validation and sanitization
- **Error Handling**: Secure error responses without information leakage
- **Environment Variables**: Sensitive data stored in environment variables

## 📝 Logging

The application includes comprehensive logging:
- Request logging
- Error logging
- Database connection status
- Development vs production log levels

## 🤝 Contributing to Backend

We welcome contributions! Here's how to get started:

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature
   ```
3. **Make your changes**
4. **Add tests for new functionality**
5. **Ensure all tests pass**
6. **Submit a pull request**

### Backend Development Guidelines

- Follow RESTful API design principles
- Use meaningful HTTP status codes
- Validate all input data
- Handle errors gracefully
- Write comprehensive tests
- Document new endpoints
- Follow existing code style

## 🐛 Troubleshooting

### Common Issues

**MongoDB Connection Failed:**
- Ensure MongoDB is running
- Check connection string in `.env`
- Verify network connectivity

**Port Already in Use:**
```bash
# Find process using port 5000
lsof -i :5000
# Kill the process
kill -9 <PID>
```

**Dependencies Issues:**
```bash
# Clear npm cache
npm cache clean --force
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

## 📞 Support

For backend-specific issues:

1. Check the [troubleshooting section](#-troubleshooting)
2. Search existing [GitHub issues](https://github.com/yourusername/PublicBoard/issues)
3. Create a new issue with detailed information

---

**Built with ❤️ for the PublicBoard community**
