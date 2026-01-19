import { getBasicTiersSorted, getAmbitiousTiersSorted, getAllTiersSorted, getTierPriority, getGoalTarget, sortGoalsByPriority } from '../../models/Goal';
import { multipleGoals, singleGoal } from '../fixtures/goals';

describe('getTierPriority', () => {
  it('should get basic tier priority', () => {
    const priority = getTierPriority(singleGoal, 'basic');
    expect(priority).toBe(1);
  });

  it('should get ambitious tier priority', () => {
    const priority = getTierPriority(singleGoal, 'ambitious');
    expect(priority).toBe(2);
  });
});

describe('getBasicTiersSorted', () => {
  it('should sort goals by basic tier priority ascending', () => {
    const goal1 = {
      ...singleGoal,
      goalId: 'goal1',
      tiers: { ...singleGoal.tiers, basic: { ...singleGoal.tiers.basic, priority: 3 } }
    };
    const goal2 = {
      ...singleGoal,
      goalId: 'goal2',
      tiers: { ...singleGoal.tiers, basic: { ...singleGoal.tiers.basic, priority: 1 } }
    };
    const goal3 = {
      ...singleGoal,
      goalId: 'goal3',
      tiers: { ...singleGoal.tiers, basic: { ...singleGoal.tiers.basic, priority: 2 } }
    };
    const unsorted = [goal1, goal2, goal3];
    const sorted = getBasicTiersSorted(unsorted);
    expect(sorted[0].tiers.basic.priority).toBe(1);
    expect(sorted[1].tiers.basic.priority).toBe(2);
    expect(sorted[2].tiers.basic.priority).toBe(3);
  });

  it('should not mutate original array', () => {
    const original = [...multipleGoals];
    getBasicTiersSorted(original);
    expect(original).toEqual(multipleGoals);
  });

  it('should handle single goal', () => {
    const sorted = getBasicTiersSorted([singleGoal]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].goalId).toBe(singleGoal.goalId);
  });
});

describe('getAmbitiousTiersSorted', () => {
  it('should sort goals by ambitious tier priority ascending', () => {
    const goal1 = {
      ...singleGoal,
      goalId: 'goal1',
      tiers: { ...singleGoal.tiers, ambitious: { ...singleGoal.tiers.ambitious, priority: 3 } }
    };
    const goal2 = {
      ...singleGoal,
      goalId: 'goal2',
      tiers: { ...singleGoal.tiers, ambitious: { ...singleGoal.tiers.ambitious, priority: 1 } }
    };
    const goal3 = {
      ...singleGoal,
      goalId: 'goal3',
      tiers: { ...singleGoal.tiers, ambitious: { ...singleGoal.tiers.ambitious, priority: 2 } }
    };
    const unsorted = [goal1, goal2, goal3];
    const sorted = getAmbitiousTiersSorted(unsorted);
    expect(sorted[0].tiers.ambitious.priority).toBe(1);
    expect(sorted[1].tiers.ambitious.priority).toBe(2);
    expect(sorted[2].tiers.ambitious.priority).toBe(3);
  });

  it('should not mutate original array', () => {
    const original = [...multipleGoals];
    getAmbitiousTiersSorted(original);
    expect(original).toEqual(multipleGoals);
  });
});

describe('getAllTiersSorted', () => {
  it('should flatten and sort all tiers by priority', () => {
    const goal1 = {
      ...singleGoal,
      goalId: 'goal1',
      tiers: {
        basic: { targetAmount: 1000, priority: 3 },
        ambitious: { targetAmount: 2000, priority: 1 }
      }
    };
    const goal2 = {
      ...singleGoal,
      goalId: 'goal2',
      tiers: {
        basic: { targetAmount: 1000, priority: 2 },
        ambitious: { targetAmount: 2000, priority: 4 }
      }
    };
    const allTiers = getAllTiersSorted([goal1, goal2]);
    
    expect(allTiers).toHaveLength(4);
    expect(allTiers[0].priority).toBe(1);
    expect(allTiers[0].tier).toBe('ambitious');
    expect(allTiers[0].goal.goalId).toBe('goal1');
    expect(allTiers[1].priority).toBe(2);
    expect(allTiers[1].tier).toBe('basic');
    expect(allTiers[1].goal.goalId).toBe('goal2');
    expect(allTiers[2].priority).toBe(3);
    expect(allTiers[2].tier).toBe('basic');
    expect(allTiers[2].goal.goalId).toBe('goal1');
    expect(allTiers[3].priority).toBe(4);
    expect(allTiers[3].tier).toBe('ambitious');
    expect(allTiers[3].goal.goalId).toBe('goal2');
  });
});

describe('sortGoalsByPriority (deprecated)', () => {
  it('should still work for backward compatibility using basic tier priority', () => {
    const goal1 = {
      ...singleGoal,
      goalId: 'goal1',
      tiers: { ...singleGoal.tiers, basic: { ...singleGoal.tiers.basic, priority: 3 } }
    };
    const goal2 = {
      ...singleGoal,
      goalId: 'goal2',
      tiers: { ...singleGoal.tiers, basic: { ...singleGoal.tiers.basic, priority: 1 } }
    };
    const unsorted = [goal1, goal2];
    const sorted = sortGoalsByPriority(unsorted);
    expect(sorted[0].tiers.basic.priority).toBe(1);
    expect(sorted[1].tiers.basic.priority).toBe(3);
  });
});

describe('getGoalTarget', () => {
  it('should get basic tier target', () => {
    const result = getGoalTarget(singleGoal, 'basic');
    expect(result).toBe(5000000);
  });

  it('should get ambitious tier target', () => {
    const result = getGoalTarget(singleGoal, 'ambitious');
    expect(result).toBe(8000000);
  });
});
