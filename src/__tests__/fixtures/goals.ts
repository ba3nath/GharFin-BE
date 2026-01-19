import { Goal } from '../../models/Goal';

export const singleGoal: Goal = {
  goalId: "goal1",
  goalName: "Retirement",
  horizonYears: 10,
  amountVariancePct: 5,
  tiers: {
    basic: { targetAmount: 5000000, priority: 1 },
    ambitious: { targetAmount: 8000000, priority: 2 },
  },
};

export const multipleGoals: Goal[] = [
  {
    goalId: "goal1",
    goalName: "Retirement",
    horizonYears: 10,
    amountVariancePct: 5,
    tiers: { basic: { targetAmount: 5000000, priority: 1 }, ambitious: { targetAmount: 8000000, priority: 2 } },
  },
  {
    goalId: "goal2",
    goalName: "Education",
    horizonYears: 5,
    amountVariancePct: 10,
    tiers: { basic: { targetAmount: 2000000, priority: 2 }, ambitious: { targetAmount: 3000000, priority: 3 } },
  },
];

export const shortHorizonGoal: Goal = {
  goalId: "goal3",
  goalName: "Emergency",
  horizonYears: 1,
  amountVariancePct: 0,
  tiers: { basic: { targetAmount: 500000, priority: 1 }, ambitious: { targetAmount: 500000, priority: 2 } },
};

export const unachievableGoal: Goal = {
  goalId: "goal4",
  goalName: "Impossible",
  horizonYears: 5,
  amountVariancePct: 0,
  tiers: { basic: { targetAmount: 1000000000, priority: 1 }, ambitious: { targetAmount: 2000000000, priority: 2 } },
};
