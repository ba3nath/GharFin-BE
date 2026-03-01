import { multipleGoals } from './goals';
import { minimalSIPInput } from './sipInputs';
import { minimalAssetsConfig } from './assetsConfig';
import { moderateCustomerProfileInput } from './customerProfileInputs';

/** Valid planning request: assets + customer_profile. */
export const minimalValidRequest = {
  assets: minimalAssetsConfig,
  customer_profile: moderateCustomerProfileInput,
  goals: { goals: multipleGoals },
  monthlySIP: minimalSIPInput.monthlySIP,
  stretchSIPPercent: minimalSIPInput.stretchSIPPercent,
  annualStepUpPercent: minimalSIPInput.annualStepUpPercent,
};
