const Issue = require('../models/Issue');
const memoryStore = require('../utils/memoryStore');
const { getConnectionStatus } = require('../config/db');

// Helper to determine which store to use
const getStore = () => {
  const useMongoDB = getConnectionStatus();
  return {
    find: (filter, sort) => useMongoDB ? Issue.find(filter).sort(sort) : Promise.resolve(memoryStore.find(filter, sort)),
    findById: (id) => useMongoDB ? Issue.findById(id) : Promise.resolve(memoryStore.findById(id)),
    create: (data) => useMongoDB ? Issue.create(data) : Promise.resolve(memoryStore.create(data)),
    findByIdAndUpdate: (id, update, options) => useMongoDB ? Issue.findByIdAndUpdate(id, update, options) : Promise.resolve(memoryStore.findByIdAndUpdate(id, update, options)),
    findByIdAndDelete: (id) => useMongoDB ? Issue.findByIdAndDelete(id) : Promise.resolve(memoryStore.findByIdAndDelete(id))
  };
};

// @desc    Get all issues
// @route   GET /api/issues
// @access  Public
const getAllIssues = async (req, res) => {
  try {
    const { status, category, sort = '-createdAt' } = req.query;
    
    // Build filter object
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    
    const store = getStore();
    const issues = await store.find(filter, sort);
    
    res.status(200).json({
      success: true,
      count: issues.length,
      data: issues
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Get single issue
// @route   GET /api/issues/:id
// @access  Public
const getIssue = async (req, res) => {
  try {
    const store = getStore();
    const issue = await store.findById(req.params.id);
    
    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: issue
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Create new issue
// @route   POST /api/issues
// @access  Public
const createIssue = async (req, res) => {
  try {
    const { title, description, category, location, reporterName } = req.body;
    
    // Validation
    if (!title || !description || !category || !reporterName) {
      return res.status(400).json({
        success: false,
        message: 'Please provide title, description, category, and reporterName'
      });
    }
    
    const store = getStore();
    const issue = await store.create({
      title,
      description,
      category,
      location,
      reporterName
    });
    
    res.status(201).json({
      success: true,
      data: issue
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: messages
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Update issue status
// @route   PATCH /api/issues/:id/status
// @access  Public
const updateIssueStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Please provide status'
      });
    }
    
    const validStatuses = ['Open', 'In Progress', 'Pending Review', 'Resolved'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    const store = getStore();
    const issue = await store.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    
    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: issue
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Delete issue
// @route   DELETE /api/issues/:id
// @access  Public (would typically be admin only)
const deleteIssue = async (req, res) => {
  try {
    const store = getStore();
    const issue = await store.findByIdAndDelete(req.params.id);
    
    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Issue deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

module.exports = {
  getAllIssues,
  getIssue,
  createIssue,
  updateIssueStatus,
  deleteIssue
};
