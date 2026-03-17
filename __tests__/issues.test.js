import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Issue from '../models/Issue';
import issuesRoutes from '../routes/issues';

describe('Issues Routes', () => {
  let app;
  let mongoServer;
  let authToken;
  let testUser;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    app = express();
    app.use(express.json());
    app.use('/api/issues', issuesRoutes);

    // Create test user and get auth token
    testUser = new User({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123'
    });
    await testUser.save();

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    authToken = loginResponse.body.token;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Issue.deleteMany({});
  });

  describe('GET /api/issues', () => {
    beforeEach(async () => {
      // Create test issues
      await Issue.create([
        {
          title: 'Issue 1',
          description: 'Description 1',
          category: 'Infrastructure',
          location: 'Location 1',
          reporter: { name: 'Reporter 1', email: 'reporter1@example.com' },
          priority: 'High',
          status: 'Open'
        },
        {
          title: 'Issue 2',
          description: 'Description 2',
          category: 'Safety',
          location: 'Location 2',
          reporter: { name: 'Reporter 2', email: 'reporter2@example.com' },
          priority: 'Medium',
          status: 'In Progress'
        }
      ]);
    });

    test('should get all issues', async () => {
      const response = await request(app)
        .get('/api/issues')
        .expect(200);

      expect(response.body).toHaveProperty('issues');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('pages');
      expect(response.body.issues).toHaveLength(2);
    });

    test('should filter by status', async () => {
      const response = await request(app)
        .get('/api/issues?status=Open')
        .expect(200);

      expect(response.body.issues).toHaveLength(1);
      expect(response.body.issues[0].status).toBe('Open');
    });

    test('should filter by category', async () => {
      const response = await request(app)
        .get('/api/issues?category=Infrastructure')
        .expect(200);

      expect(response.body.issues).toHaveLength(1);
      expect(response.body.issues[0].category).toBe('Infrastructure');
    });

    test('should filter by priority', async () => {
      const response = await request(app)
        .get('/api/issues?priority=High')
        .expect(200);

      expect(response.body.issues).toHaveLength(1);
      expect(response.body.issues[0].priority).toBe('High');
    });

    test('should search issues', async () => {
      const response = await request(app)
        .get('/api/issues?search=Issue 1')
        .expect(200);

      expect(response.body.issues).toHaveLength(1);
      expect(response.body.issues[0].title).toBe('Issue 1');
    });

    test('should paginate results', async () => {
      // Create more issues
      for (let i = 3; i <= 25; i++) {
        await Issue.create({
          title: `Issue ${i}`,
          description: `Description ${i}`,
          category: 'Other',
          location: `Location ${i}`,
          reporter: { name: `Reporter ${i}`, email: `reporter${i}@example.com` }
        });
      }

      const response = await request(app)
        .get('/api/issues?page=1&limit=10')
        .expect(200);

      expect(response.body.issues).toHaveLength(10);
      expect(response.body.page).toBe(1);
      expect(response.body.pages).toBeGreaterThan(1);
    });
  });

  describe('GET /api/issues/stats', () => {
    beforeEach(async () => {
      await Issue.create([
        { title: 'Open Issue', category: 'Infrastructure', status: 'Open', reporter: { name: 'Test', email: 'test@example.com' } },
        { title: 'In Progress Issue', category: 'Safety', status: 'In Progress', reporter: { name: 'Test', email: 'test@example.com' } },
        { title: 'Resolved Issue', category: 'Sanitation', status: 'Resolved', reporter: { name: 'Test', email: 'test@example.com' } }
      ]);
    });

    test('should get issue statistics', async () => {
      const response = await request(app)
        .get('/api/issues/stats')
        .expect(200);

      expect(response.body).toHaveProperty('total', 3);
      expect(response.body).toHaveProperty('open', 1);
      expect(response.body).toHaveProperty('inProgress', 1);
      expect(response.body).toHaveProperty('resolved', 1);
      expect(response.body).toHaveProperty('priorityBreakdown');
      expect(response.body).toHaveProperty('topTags');
      expect(response.body).toHaveProperty('neighborhoods');
    });
  });

  describe('GET /api/issues/:id', () => {
    test('should get single issue', async () => {
      const issue = await Issue.create({
        title: 'Test Issue',
        description: 'Test Description',
        category: 'Infrastructure',
        location: 'Test Location',
        reporter: { name: 'Test Reporter', email: 'reporter@example.com' },
        views: 5
      });

      const response = await request(app)
        .get(`/api/issues/${issue._id}`)
        .expect(200);

      expect(response.body.issue.title).toBe('Test Issue');
      expect(response.body.issue.views).toBe(6); // Should increment by 1
    });

    test('should return 404 for non-existent issue', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/issues/${fakeId}`)
        .expect(404);

      expect(response.body.message).toContain('not found');
    });
  });

  describe('POST /api/issues', () => {
    test('should create new issue', async () => {
      const issueData = {
        title: 'New Issue',
        description: 'This is a new issue description that is at least 20 characters long',
        category: 'Infrastructure',
        location: 'Test Location',
        priority: 'High',
        tags: ['tag1', 'tag2'],
        reporter: {
          name: 'Test Reporter',
          email: 'reporter@example.com'
        }
      };

      const response = await request(app)
        .post('/api/issues')
        .send(issueData)
        .expect(201);

      expect(response.body.issue.title).toBe('New Issue');
      expect(response.body.issue.category).toBe('Infrastructure');
      expect(response.body.issue.status).toBe('Open');
      expect(response.body.issue.supportCount).toBe(0);
    });

    test('should create issue with authenticated user', async () => {
      const issueData = {
        title: 'Authenticated Issue',
        description: 'This is an issue created by an authenticated user that is at least 20 characters',
        category: 'Safety',
        location: 'Test Location'
      };

      const response = await request(app)
        .post('/api/issues')
        .set('Authorization', `Bearer ${authToken}`)
        .send(issueData)
        .expect(201);

      expect(response.body.issue.reporter.name).toBe('Test User');
      expect(response.body.issue.reporter.email).toBe('test@example.com');
      expect(response.body.issue.reporter.userId).toBe(testUser._id.toString());
    });

    test('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/issues')
        .send({
          title: 'Test Issue'
          // Missing description, category, location
        })
        .expect(400);

      expect(response.body.message).toContain('required');
    });

    test('should return 400 for invalid category', async () => {
      const issueData = {
        title: 'Test Issue',
        description: 'Test description that is at least 20 characters long',
        category: 'Invalid Category',
        location: 'Test Location',
        reporter: { name: 'Test', email: 'test@example.com' }
      };

      const response = await request(app)
        .post('/api/issues')
        .send(issueData)
        .expect(400);

      expect(response.body.message).toContain('Category must be one of');
    });

    test('should return 400 for title too short', async () => {
      const issueData = {
        title: 'Short',
        description: 'Test description that is at least 20 characters long',
        category: 'Infrastructure',
        location: 'Test Location',
        reporter: { name: 'Test', email: 'test@example.com' }
      };

      const response = await request(app)
        .post('/api/issues')
        .send(issueData)
        .expect(400);

      expect(response.body.message).toContain('at least 5 characters');
    });

    test('should return 400 for description too short', async () => {
      const issueData = {
        title: 'Test Issue Title',
        description: 'Too short',
        category: 'Infrastructure',
        location: 'Test Location',
        reporter: { name: 'Test', email: 'test@example.com' }
      };

      const response = await request(app)
        .post('/api/issues')
        .send(issueData)
        .expect(400);

      expect(response.body.message).toContain('at least 20 characters');
    });
  });

  describe('POST /api/issues/:id/support', () => {
    let issue;

    beforeEach(async () => {
      issue = await Issue.create({
        title: 'Test Issue',
        description: 'Test description',
        category: 'Infrastructure',
        location: 'Test Location',
        reporter: { name: 'Test Reporter', email: 'reporter@example.com' },
        supportCount: 2,
        supporters: [new mongoose.Types.ObjectId()]
      });
    });

    test('should support issue', async () => {
      const response = await request(app)
        .post(`/api/issues/${issue._id}/support`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.issue.supportCount).toBe(3);
      expect(response.body.supported).toBe(true);
    });

    test('should unsupport already supported issue', async () => {
      // Add user to supporters
      issue.supporters.push(testUser._id);
      issue.supportCount = 3;
      await issue.save();

      const response = await request(app)
        .post(`/api/issues/${issue._id}/support`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.issue.supportCount).toBe(2);
      expect(response.body.supported).toBe(false);
    });

    test('should return 401 for unauthenticated request', async () => {
      const response = await request(app)
        .post(`/api/issues/${issue._id}/support`)
        .expect(401);
    });

    test('should return 404 for non-existent issue', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/issues/${fakeId}/support`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('POST /api/issues/:id/comments', () => {
    let issue;

    beforeEach(async () => {
      issue = await Issue.create({
        title: 'Test Issue',
        description: 'Test description',
        category: 'Infrastructure',
        location: 'Test Location',
        reporter: { name: 'Test Reporter', email: 'reporter@example.com' },
        comments: []
      });
    });

    test('should add comment to issue', async () => {
      const commentData = {
        text: 'This is a test comment'
      };

      const response = await request(app)
        .post(`/api/issues/${issue._id}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(commentData)
        .expect(201);

      expect(response.body.issue.comments).toHaveLength(1);
      expect(response.body.issue.comments[0].text).toBe('This is a test comment');
      expect(response.body.issue.comments[0].author.name).toBe('Test User');
    });

    test('should return 400 for empty comment', async () => {
      const response = await request(app)
        .post(`/api/issues/${issue._id}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ text: '' })
        .expect(400);

      expect(response.body.message).toContain('required');
    });

    test('should return 401 for unauthenticated request', async () => {
      const response = await request(app)
        .post(`/api/issues/${issue._id}/comments`)
        .send({ text: 'Test comment' })
        .expect(401);
    });

    test('should handle mentions in comments', async () => {
      // Create mentioned user
      const mentionedUser = await User.create({
        name: 'Mentioned User',
        email: 'mentioned@example.com',
        password: 'password123'
      });

      const commentData = {
        text: 'Hey @Mentioned User, check this out!'
      };

      const response = await request(app)
        .post(`/api/issues/${issue._id}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(commentData)
        .expect(201);

      expect(response.body.issue.comments[0].mentions).toContain('MentionedUser');
    });
  });

  describe('PATCH /api/issues/:id/status', () => {
    let issue;

    beforeEach(async () => {
      issue = await Issue.create({
        title: 'Test Issue',
        description: 'Test description',
        category: 'Infrastructure',
        location: 'Test Location',
        reporter: { 
          name: 'Test Reporter', 
          email: 'reporter@example.com',
          userId: testUser._id
        },
        status: 'Open'
      });
    });

    test('should update issue status', async () => {
      const statusData = {
        status: 'In Progress',
        message: 'Working on this issue'
      };

      const response = await request(app)
        .patch(`/api/issues/${issue._id}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(statusData)
        .expect(200);

      expect(response.body.issue.status).toBe('In Progress');
      expect(response.body.issue.updates).toHaveLength(1);
      expect(response.body.issue.updates[0].message).toBe('Working on this issue');
    });

    test('should set resolved timestamp when status is Resolved', async () => {
      const statusData = {
        status: 'Resolved'
      };

      const response = await request(app)
        .patch(`/api/issues/${issue._id}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(statusData)
        .expect(200);

      expect(response.body.issue.status).toBe('Resolved');
      expect(response.body.issue.resolvedAt).toBeDefined();
      expect(response.body.issue.resolutionTimeHours).toBeDefined();
    });

    test('should return 403 for unauthorized user', async () => {
      // Create another user
      const otherUser = await User.create({
        name: 'Other User',
        email: 'other@example.com',
        password: 'password123'
      });

      const otherLoginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'other@example.com',
          password: 'password123'
        });

      const response = await request(app)
        .patch(`/api/issues/${issue._id}/status`)
        .set('Authorization', `Bearer ${otherLoginResponse.body.token}`)
        .send({ status: 'In Progress' })
        .expect(403);
    });

    test('should return 400 for missing status', async () => {
      const response = await request(app)
        .patch(`/api/issues/${issue._id}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: 'Test message' })
        .expect(400);

      expect(response.body.message).toContain('Status is required');
    });
  });

  describe('DELETE /api/issues/:id', () => {
    test('should delete issue as admin', async () => {
      // Create admin user
      const adminUser = await User.create({
        name: 'Admin User',
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin'
      });

      const adminLoginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'password123'
        });

      const issue = await Issue.create({
        title: 'Test Issue',
        description: 'Test description',
        category: 'Infrastructure',
        location: 'Test Location',
        reporter: { name: 'Test Reporter', email: 'reporter@example.com' }
      });

      const response = await request(app)
        .delete(`/api/issues/${issue._id}`)
        .set('Authorization', `Bearer ${adminLoginResponse.body.token}`)
        .expect(200);

      expect(response.body.message).toContain('deleted');

      // Verify issue is deleted
      const deletedIssue = await Issue.findById(issue._id);
      expect(deletedIssue).toBeNull();
    });

    test('should return 403 for non-admin user', async () => {
      const issue = await Issue.create({
        title: 'Test Issue',
        description: 'Test description',
        category: 'Infrastructure',
        location: 'Test Location',
        reporter: { name: 'Test Reporter', email: 'reporter@example.com' }
      });

      const response = await request(app)
        .delete(`/api/issues/${issue._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      expect(response.body.message).toContain('Not authorized');
    });
  });
});
