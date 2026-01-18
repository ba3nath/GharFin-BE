import { getTotalCorpus, getCorpusAllocationPercentages } from '../../models/CustomerProfile';
import {
  minimalCustomerProfile,
  zeroCorpusProfile,
  multiAssetProfile,
} from '../fixtures/customerProfiles';

describe('getTotalCorpus', () => {
  it('should calculate total corpus correctly', () => {
    const result = getTotalCorpus(minimalCustomerProfile);
    expect(result).toBe(1000000);
  });

  it('should return 0 for zero corpus profile', () => {
    const result = getTotalCorpus(zeroCorpusProfile);
    expect(result).toBe(0);
  });

  it('should calculate total for multi-asset profile', () => {
    const result = getTotalCorpus(multiAssetProfile);
    expect(result).toBe(5000000);
  });
});

describe('getCorpusAllocationPercentages', () => {
  it('should calculate allocation percentages correctly', () => {
    const result = getCorpusAllocationPercentages(minimalCustomerProfile);
    expect(result.largeCap).toBe(50);
    expect(result.bond).toBe(50);
  });

  it('should return empty object for zero corpus', () => {
    const result = getCorpusAllocationPercentages(zeroCorpusProfile);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should calculate percentages for multi-asset profile', () => {
    const result = getCorpusAllocationPercentages(multiAssetProfile);
    const total = Object.values(result).reduce((sum, pct) => sum + pct, 0);
    expect(total).toBe(100);
    expect(result.largeCap).toBe(40);
    expect(result.midCap).toBe(30);
    expect(result.bond).toBe(20);
    expect(result.gold).toBe(10);
  });
});
