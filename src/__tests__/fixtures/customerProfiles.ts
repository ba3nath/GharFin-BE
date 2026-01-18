import { CustomerProfile } from '../../models/CustomerProfile';

export const minimalCustomerProfile: CustomerProfile = {
  asOfDate: "2024-01-01",
  totalNetWorth: 1000000,
  corpus: {
    byAssetClass: {
      largeCap: 500000,
      bond: 500000,
    },
    allowedAssetClasses: ["largeCap", "bond"],
  },
};

export const zeroCorpusProfile: CustomerProfile = {
  asOfDate: "2024-01-01",
  totalNetWorth: 0,
  corpus: {
    byAssetClass: {},
    allowedAssetClasses: ["largeCap", "bond"],
  },
};

export const multiAssetProfile: CustomerProfile = {
  asOfDate: "2024-01-01",
  totalNetWorth: 5000000,
  corpus: {
    byAssetClass: {
      largeCap: 2000000,
      midCap: 1500000,
      bond: 1000000,
      gold: 500000,
    },
    allowedAssetClasses: ["largeCap", "midCap", "bond", "gold"],
  },
};

export const cashOnlyProfile: CustomerProfile = {
  asOfDate: "2024-01-01",
  totalNetWorth: 1000000,
  corpus: {
    byAssetClass: {
      cash: 1000000,
    },
    allowedAssetClasses: ["cash"],
  },
};
