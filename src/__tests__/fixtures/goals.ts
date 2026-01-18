import { Goal } from '../../models/Goal';

export const singleGoal: Goal = {
  goalId: "goal1",
  goalName: "Retirement",
  priority: 1,
  horizonYears: 10,
  amountVariancePct: 5,
  tiers: {
    basic: { targetAmount: 5000000 },
    ambitious: { targetAmount: 8000000 },
  },
};

export const multipleGoals: Goal[] = [
  {
    goalId: "goal1",
    goalName: "Retirement",
    priority: 1,
    horizonYears: 10,
    amountVariancePct: 5,
    tiers: { basic: { targetAmount: 5000000 }, ambitious: { targetAmount: 8000000 } },
  },
  {
    goalId: "goal2",
    goalName: "Education",
    priority: 2,
    horizonYears: 5,
    amountVariancePct: 10,
    tiers: { basic: { targetAmount: 2000000 }, ambitious: { targetAmount: 3000000 } },
  },
];

export const shortHorizonGoal: Goal = {
  goalId: "goal3",
  goalName: "Emergency",
  priority: 1,
  horizonYears: 1,
  amountVariancePct: 0,
  tiers: { basic: { targetAmount: 500000 }, ambitious: { targetAmount: 500000 } },
};

export const unachievableGoal: Goal = {
  goalId: "goal4",
  goalName: "Impossible",
  priority: 1,
  horizonYears: 5,
  amountVariancePct: 0,
  tiers: { basic: { targetAmount: 1000000000 }, ambitious: { targetAmount: 2000000000 } },
};
