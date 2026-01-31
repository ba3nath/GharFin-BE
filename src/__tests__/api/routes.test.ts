import request from 'supertest';
import app from '../../api/server';
import { minimalValidRequest } from '../fixtures/requests';

describe('GET /api', () => {
  it('should return API information', async () => {
    const response = await request(app).get('/api');
    
    expect(response.status).toBe(200);
    expect(response.body.message).toBeDefined();
    expect(response.body.endpoints).toBeDefined();
    expect(response.body.endpoints.method1).toBeDefined();
    expect(response.body.endpoints.method2).toBeDefined();
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

describe('GET /api/plan/method1', () => {
  it('should return method information', async () => {
    const response = await request(app).get('/api/plan/method1');
    
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('POST');
    expect(response.body.endpoint).toBe('/api/plan/method1');
    expect(response.body.requiredFields).toBeDefined();
  });
});

describe('GET /api/plan/method2', () => {
  it('should return method information', async () => {
    const response = await request(app).get('/api/plan/method2');
    
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('POST');
    expect(response.body.endpoint).toBe('/api/plan/method2');
    expect(response.body.requiredFields).toBeDefined();
  });
});

describe('POST /api/plan/method1', () => {
  it('should return success with valid request', async () => {
    const response = await request(app)
      .post('/api/plan/method1')
      .send(minimalValidRequest);
    
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('method1');
    expect(response.body.goalFeasibilityTable).toBeDefined();
    expect(response.body.sipAllocation).toBeDefined();
    expect(response.body.corpusAllocation).toBeDefined();
  });

  it('should return 400 for invalid request', async () => {
    const response = await request(app)
      .post('/api/plan/method1')
      .send({});
    
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should return 400 for missing fields', async () => {
    const response = await request(app)
      .post('/api/plan/method1')
      .send({
        assetClasses: minimalValidRequest.assetClasses,
        // Missing other required fields
      });
    
    expect(response.status).toBe(400);
  });

  it('should handle stretch SIP and step-up', async () => {
    const requestWithOptions = {
      ...minimalValidRequest,
      stretchSIPPercent: 20,
      annualStepUpPercent: 10,
    };

    const response = await request(app)
      .post('/api/plan/method1')
      .send(requestWithOptions);
    
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('method1');
  });
});

describe('POST /api/plan/method2', () => {
  it('should return success with valid request (with volatilityPct)', async () => {
    const requestWithPaths = {
      ...minimalValidRequest,
      monteCarloPaths: 100, // Use fewer paths for faster test
    };
    
    const response = await request(app)
      .post('/api/plan/method2')
      .send(requestWithPaths);
    
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('method2');
    expect(response.body.goalFeasibilityTable).toBeDefined();
    expect(response.body.sipAllocation).toBeDefined();
  }, 30000); // Method 2 with Monte Carlo can take 15-20+ seconds

  it('should return 400 for invalid request', async () => {
    const response = await request(app)
      .post('/api/plan/method2')
      .send({});
    
    expect(response.status).toBe(400);
  });

  it('should handle custom monteCarloPaths parameter', async () => {
    const requestWithPaths = {
      ...minimalValidRequest,
      monteCarloPaths: 100,
    };

    const response = await request(app)
      .post('/api/plan/method2')
      .send(requestWithPaths);
    
    expect(response.status).toBe(200);
  }, 30000); // Method 2 with Monte Carlo can take time

  it('should return error if volatilityPct missing', async () => {
    const requestWithoutVolatility = {
      ...minimalValidRequest,
      assetClasses: {
        largeCap: {
          "10Y": {
            avgReturnPct: 11.0,
            probNegativeYearPct: 18,
            expectedShortfallPct: -15,
            maxDrawdownPct: -28,
            // volatilityPct missing
          },
        },
      },
    };

    const response = await request(app)
      .post('/api/plan/method2')
      .send(requestWithoutVolatility);
    
    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
  });
});

describe('POST /api/validate', () => {
  it('should validate envelope bounds', async () => {
    const validateRequest = {
      initialCorpus: 1000000,
      monthlySIP: 50000,
      allocations: [
        { assetClass: 'largeCap', percentage: 100 },
      ],
      assetClassDataMap: {
        largeCap: minimalValidRequest.assetClasses.largeCap['10Y'],
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
      .post('/api/plan/method1')
      .send({ invalid: 'data' });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should return 400 or 500 for internal errors', async () => {
    // Send malformed data - validation catches it first (400)
    const response = await request(app)
      .post('/api/plan/method1')
      .send({
        assetClasses: null,
        customerProfile: null,
        goals: null,
        monthlySIP: 'invalid',
      });
    
    // Validation catches invalid data first (400), or could be 500 if it passes validation
    expect([400, 500]).toContain(response.status);
    expect(response.body.error).toBeDefined();
  });
});
