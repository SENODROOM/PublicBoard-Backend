const express = require('express');
const router = express.Router();
const {
  getAllIssues,
  getIssue,
  createIssue,
  updateIssueStatus,
  deleteIssue
} = require('../controllers/issueController');

router.route('/')
  .get(getAllIssues)
  .post(createIssue);

router.route('/:id')
  .get(getIssue)
  .delete(deleteIssue);

router.route('/:id/status')
  .patch(updateIssueStatus);

module.exports = router;
