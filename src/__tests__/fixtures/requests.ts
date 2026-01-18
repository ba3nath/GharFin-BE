import { AssetClasses } from '../../models/AssetClass';
import { CustomerProfile } from '../../models/CustomerProfile';
import { Goals } from '../../models/Goal';
import { fullAssetClasses } from './assetClasses';
import { minimalCustomerProfile } from './customerProfiles';
import { multipleGoals } from './goals';
import { minimalSIPInput } from './sipInputs';

export const minimalValidRequest = {
  assetClasses: fullAssetClasses,
  customerProfile: minimalCustomerProfile,
  goals: { goals: multipleGoals },
  monthlySIP: minimalSIPInput.monthlySIP,
  stretchSIPPercent: minimalSIPInput.stretchSIPPercent,
  annualStepUpPercent: minimalSIPInput.annualStepUpPercent,
};
