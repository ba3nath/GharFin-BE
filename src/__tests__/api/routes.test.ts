import request from 'supertest';
import app from '../../api/server';
import { minimalValidRequest } from '../fixtures/requests';
import { assetsConfigToAssetClasses } from '../../models/AssetsConfig';
import { minimalAssetsConfig } from '../fixtures/assetsConfig';

describe('GET /api', () => {
  it('should return API information', async () => {
    const response = await request(app).get('/api');
    
    expect(response.status).toBe(200);
    expect(response.body.message).toBeDefined();
    expect(response.body.endpoints).toBeDefined();
    expect(response.body.endpoints.gharfin).toBeDefined();
    expect(response.body.endpoints.method2).toBeDefined(); // deprecated alias
  });
});

describe('GET /api/health', () => {
  it('should return status ok with timestamp', async () => {
    const response = await request(app).get('/api/health');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeDefined();
  });
});

describe('GET /api/plan/gharfin', () => {
  it('should return method information', async () => {
    const response = await request(app).get('/api/plan/gharfin');
    
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('POST');
    expect(response.body.endpoint).toBe('/api/plan/gharfin');
    expect(response.body.requiredFields).toBeDefined();
  });
});

describe('GET /api/plan/method2 (deprecated)', () => {
  it('should return deprecated info', async () => {
    const response = await request(app).get('/api/plan/method2');
    
    expect(response.status).toBe(200);
    expect(response.body.endpoint).toBe('/api/plan/method2');
  });
});

describe('POST /api/plan/gharfin', () => {
  it('should return success with valid request (with volatilityPct)', async () => {
    const requestWithPaths = {
      ...minimalValidRequest,
      monteCarloPaths: 100,
    };
    
    const response = await request(app)
      .post('/api/plan/gharfin')
      .send(requestWithPaths);
    
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('gharfin');
    expect(response.body.goalFeasibilityTable).toBeDefined();
    expect(response.body.sipAllocation).toBeDefined();
  }, 30000);

  it('should return 400 for invalid request', async () => {
    const response = await request(app)
      .post('/api/plan/gharfin')
      .send({});
    
    expect(response.status).toBe(400);
  });

  it('should handle custom monteCarloPaths parameter', async () => {
    const requestWithPaths = {
      ...minimalValidRequest,
      monteCarloPaths: 100,
    };

    const response = await request(app)
      .post('/api/plan/gharfin')
      .send(requestWithPaths);
    
    expect(response.status).toBe(200);
  }, 30000);
});

describe('POST /api/plan/method2 (deprecated, same as gharfin)', () => {
  it('should return gharfin result', async () => {
    const requestWithPaths = {
      ...minimalValidRequest,
      monteCarloPaths: 100,
    };
    
    const response = await request(app)
      .post('/api/plan/method2')
      .send(requestWithPaths);
    
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('gharfin');
  }, 30000);
});

describe('POST /api/validate', () => {
  it('should validate envelope bounds', async () => {
    const assetClasses = assetsConfigToAssetClasses(minimalAssetsConfig, 'realistic');
    const largeCapData = assetClasses['Large Cap Fund'];
    const validateRequest = {
      initialCorpus: 1000000,
      monthlySIP: 50000,
      allocations: [
        { assetClass: 'Large Cap Fund', percentage: 100 },
      ],
      assetClassDataMap: {
        'Large Cap Fund': largeCapData,
      },
      horizonYears: 10,
      envelopeBounds: {
        lower: 2000000,
        mean: 3000000,
      },
    };

    const response = await request(app)
      .post('/api/validate')
      .send(validateRequest);
    
    expect(response.status).toBe(200);
    expect(response.body.containmentPercent).toBeDefined();
    expect(response.body.isValid).toBeDefined();
  });

  it('should return 400 for invalid request', async () => {
    const response = await request(app)
      .post('/api/validate')
      .send({});
    
    expect(response.status).toBe(400);
  });
});

describe('Error Handling', () => {
  it('should return 400 for bad requests', async () => {
    const response = await request(app)
      .post('/api/plan/gharfin')
      .send({ invalid: 'data' });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should return 400 for invalid payload', async () => {
    const response = await request(app)
      .post('/api/plan/gharfin')
      .send({
        assets: null,
        customer_profile: null,
        goals: null,
        monthlySIP: 'invalid',
      });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});

describe('Zod validation - invalid but present payloads', () => {
  it('should return 400 with details for negative monthlySIP', async () => {
    const invalidRequest = {
      ...minimalValidRequest,
      monthlySIP: -1000,
    };
    const response = await request(app)
      .post('/api/plan/gharfin')
      .send(invalidRequest);
    
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.details).toBeDefined();
    expect(Array.isArray(response.body.details)).toBe(true);
    expect(response.body.details.length).toBeGreaterThan(0);
  });

  it('should return 400 with details when goals.goals is not an array', async () => {
    const invalidRequest = {
      ...minimalValidRequest,
      goals: { goals: 'not-an-array' },
    };
    const response = await request(app)
      .post('/api/plan/gharfin')
      .send(invalidRequest);
    
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.details).toBeDefined();
    expect(Array.isArray(response.body.details)).toBe(true);
  });

  it('should return 400 with details when stretchSIPPercent exceeds 100', async () => {
    const invalidRequest = {
      ...minimalValidRequest,
      stretchSIPPercent: 150,
    };
    const response = await request(app)
      .post('/api/plan/gharfin')
      .send(invalidRequest);
    
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.details).toBeDefined();
  });
});
