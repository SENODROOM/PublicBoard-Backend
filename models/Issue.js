const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot be more than 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot be more than 2000 characters']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: {
      values: ['Infrastructure', 'Community Resources', 'Personal Concern', 'Other'],
      message: '{VALUE} is not a valid category'
    }
  },
  location: {
    type: String,
    trim: true,
    maxlength: [200, 'Location cannot be more than 200 characters']
  },
  status: {
    type: String,
    enum: {
      values: ['Open', 'In Progress', 'Pending Review', 'Resolved'],
      message: '{VALUE} is not a valid status'
    },
    default: 'Open'
  },
  reporterName: {
    type: String,
    required: [true, 'Reporter name is required'],
    trim: true,
    maxlength: [100, 'Reporter name cannot be more than 100 characters']
  }
}, {
  timestamps: true // Adds createdAt and updatedAt automatically
});

// Index for efficient querying
issueSchema.index({ status: 1, createdAt: -1 });
issueSchema.index({ category: 1 });

module.exports = mongoose.model('Issue', issueSchema);
