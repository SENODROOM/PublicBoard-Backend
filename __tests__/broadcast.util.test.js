const broadcast = require('../utils/broadcast');

describe('broadcast utility', () => {
  function makeApp(clients = []) {
    const sseClients = new Set(clients);
    return { locals: { sseClients } };
  }

  it('does nothing when app is null', () => {
    expect(() => broadcast(null, 'test', {})).not.toThrow();
  });

  it('does nothing when sseClients is absent', () => {
    const app = { locals: {} };
    expect(() => broadcast(app, 'test', {})).not.toThrow();
  });

  it('writes a properly formatted SSE message to each client', () => {
    const written = [];
    const client = { res: { write: (msg) => written.push(msg) } };
    const app = makeApp([client]);

    broadcast(app, 'issue.created', { id: 'abc', title: 'Test' });

    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^data: /);
    expect(written[0]).toMatch(/\n\n$/);

    const payload = JSON.parse(written[0].replace(/^data: /, '').trim());
    expect(payload.type).toBe('issue.created');
    expect(payload.payload.id).toBe('abc');
    expect(typeof payload.ts).toBe('number');
  });

  it('broadcasts to multiple clients', () => {
    const writes1 = [], writes2 = [];
    const c1 = { res: { write: (m) => writes1.push(m) } };
    const c2 = { res: { write: (m) => writes2.push(m) } };
    const app = makeApp([c1, c2]);

    broadcast(app, 'ping', {});

    expect(writes1).toHaveLength(1);
    expect(writes2).toHaveLength(1);
  });

  it('removes dead clients that throw on write', () => {
    const good = { res: { write: jest.fn() } };
    const dead = { res: { write: () => { throw new Error('broken pipe'); } } };
    const app = makeApp([good, dead]);

    expect(app.locals.sseClients.size).toBe(2);
    broadcast(app, 'test', {});
    expect(app.locals.sseClients.size).toBe(1);
    expect(app.locals.sseClients.has(good)).toBe(true);
    expect(app.locals.sseClients.has(dead)).toBe(false);
  });

  it('still delivers to healthy clients when a dead one is present', () => {
    const goodWrites = [];
    const good = { res: { write: (m) => goodWrites.push(m) } };
    const dead = { res: { write: () => { throw new Error('pipe closed'); } } };
    const app = makeApp([dead, good]);

    broadcast(app, 'status', { value: 'ok' });

    expect(goodWrites).toHaveLength(1);
  });

  it('serialises the payload correctly', () => {
    const writes = [];
    const client = { res: { write: (m) => writes.push(m) } };
    const app = makeApp([client]);
    const payload = { id: '123', status: 'Resolved', count: 42 };

    broadcast(app, 'issue.status', payload);

    const msg = JSON.parse(writes[0].replace(/^data: /, '').trim());
    expect(msg.payload).toEqual(payload);
  });
});
