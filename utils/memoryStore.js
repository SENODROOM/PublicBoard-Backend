// In-memory store for demo mode when MongoDB is unavailable
// Simple UUID generator
const generateId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

class MemoryStore {
  constructor() {
    this.issues = new Map();
    this.seedData();
  }

  seedData() {
    // Add some sample data
    const sampleIssues = [
      {
        _id: generateId(),
        title: 'Broken streetlight on Main Street',
        description: 'The streetlight near the community center has been out for a week. It creates a safety hazard for pedestrians at night.',
        category: 'Infrastructure',
        location: 'Main Street, near Community Center',
        status: 'Open',
        reporterName: 'John Smith',
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        _id: generateId(),
        title: 'Need more badminton shuttles for community center',
        description: 'The community center badminton court is running low on shuttles. We need about 2 dozen new ones for the upcoming tournament.',
        category: 'Community Resources',
        location: 'Community Center - Sports Hall',
        status: 'In Progress',
        reporterName: 'Sarah Chen',
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        _id: generateId(),
        title: 'Pothole on Oak Avenue',
        description: 'Large pothole developing on Oak Avenue near the school. Cars are swerving to avoid it.',
        category: 'Infrastructure',
        location: 'Oak Avenue, near Lincoln Elementary',
        status: 'Pending Review',
        reporterName: 'Mike Johnson',
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        _id: generateId(),
        title: 'Stray cats need food at the park',
        description: 'There are several stray cats near the north entrance of Central Park that appear hungry. Would appreciate if someone could help with cat food.',
        category: 'Personal Concern',
        location: 'Central Park, North Entrance',
        status: 'Resolved',
        reporterName: 'Emily Davis',
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
      }
    ];

    sampleIssues.forEach(issue => {
      this.issues.set(issue._id, issue);
    });
  }

  find(filter = {}, sort = '-createdAt') {
    let results = Array.from(this.issues.values());

    // Apply filters
    if (filter.status) {
      results = results.filter(issue => issue.status === filter.status);
    }
    if (filter.category) {
      results = results.filter(issue => issue.category === filter.category);
    }

    // Apply sorting
    const sortField = sort.startsWith('-') ? sort.substring(1) : sort;
    const sortOrder = sort.startsWith('-') ? -1 : 1;
    
    results.sort((a, b) => {
      const aVal = new Date(a[sortField]);
      const bVal = new Date(b[sortField]);
      return sortOrder * (aVal - bVal);
    });

    return results;
  }

  findById(id) {
    return this.issues.get(id) || null;
  }

  create(data) {
    const issue = {
      _id: generateId(),
      ...data,
      status: data.status || 'Open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.issues.set(issue._id, issue);
    return issue;
  }

  findByIdAndUpdate(id, update, options = {}) {
    const issue = this.issues.get(id);
    if (!issue) return null;

    const updatedIssue = {
      ...issue,
      ...update,
      updatedAt: new Date().toISOString()
    };
    this.issues.set(id, updatedIssue);
    return updatedIssue;
  }

  findByIdAndDelete(id) {
    const issue = this.issues.get(id);
    if (!issue) return null;
    this.issues.delete(id);
    return issue;
  }
}

module.exports = new MemoryStore();
