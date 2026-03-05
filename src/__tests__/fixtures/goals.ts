import { Goal } from '../../models/Goal';

export const singleGoal: Goal = {
  goalId: "goal1",
  goalName: "Retirement",
  horizonYears: 10,
  tiers: {
    basic: { targetAmount: [4500000, 5000000], priority: 1 },
    ambitious: { targetAmount: [7500000, 8000000], priority: 2 },
  },
};

export const multipleGoals: Goal[] = [
  {
    goalId: "goal1",
    goalName: "Retirement",
    horizonYears: 10,
    tiers: { basic: { targetAmount: [4500000, 5000000], priority: 1 }, ambitious: { targetAmount: [7500000, 8000000], priority: 2 } },
  },
  {
    goalId: "goal2",
    goalName: "Education",
    horizonYears: 5,
    tiers: { basic: { targetAmount: [1800000, 2000000], priority: 2 }, ambitious: { targetAmount: [2800000, 3000000], priority: 3 } },
  },
];

export const shortHorizonGoal: Goal = {
  goalId: "goal3",
  goalName: "Emergency",
  horizonYears: 1,
  tiers: { basic: { targetAmount: [450000, 500000], priority: 1 }, ambitious: { targetAmount: [500001, 550000], priority: 2 } },
};

export const unachievableGoal: Goal = {
  goalId: "goal4",
  goalName: "Impossible",
  horizonYears: 5,
  tiers: { basic: { targetAmount: [1000000000, 1100000000], priority: 1 }, ambitious: { targetAmount: [2000000000, 2100000000], priority: 2 } },
};
