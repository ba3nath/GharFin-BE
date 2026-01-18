import { sortGoalsByPriority, getGoalTarget } from '../../models/Goal';
import { multipleGoals, singleGoal } from '../fixtures/goals';

describe('sortGoalsByPriority', () => {
  it('should sort goals by priority ascending', () => {
    const unsorted = [
      { ...multipleGoals[1], priority: 3 },
      { ...multipleGoals[0], priority: 1 },
      { ...multipleGoals[1], priority: 2 },
    ];
    const sorted = sortGoalsByPriority(unsorted);
    expect(sorted[0].priority).toBe(1);
    expect(sorted[1].priority).toBe(2);
    expect(sorted[2].priority).toBe(3);
  });

  it('should not mutate original array', () => {
    const original = [...multipleGoals];
    sortGoalsByPriority(original);
    expect(original).toEqual(multipleGoals);
  });

  it('should handle single goal', () => {
    const sorted = sortGoalsByPriority([singleGoal]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].goalId).toBe(singleGoal.goalId);
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
