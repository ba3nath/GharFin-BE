import { SIPInput } from '../../planner/goalPlanner';

export const minimalSIPInput: SIPInput = {
  monthlySIP: 50000,
  stretchSIPPercent: 0,
  annualStepUpPercent: 0,
};

export const withStretchSIP: SIPInput = {
  monthlySIP: 50000,
  stretchSIPPercent: 20,
  annualStepUpPercent: 0,
};

export const withStepUp: SIPInput = {
  monthlySIP: 50000,
  stretchSIPPercent: 0,
  annualStepUpPercent: 10,
};

export const zeroSIP: SIPInput = {
  monthlySIP: 0,
  stretchSIPPercent: 0,
  annualStepUpPercent: 0,
};
