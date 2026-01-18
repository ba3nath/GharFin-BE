import { AssetClassData, AssetClasses } from '../../models/AssetClass';

export const minimalAssetClass: AssetClassData = {
  avgReturnPct: 10.0,
  probNegativeYearPct: 20,
  expectedShortfallPct: -15,
  maxDrawdownPct: -30,
};

export const assetClassWithVolatility: AssetClassData = {
  ...minimalAssetClass,
  volatilityPct: 18.0,
};

export const bondAssetClass: AssetClassData = {
  avgReturnPct: 7.0,
  probNegativeYearPct: 0,
  expectedShortfallPct: 0,
  maxDrawdownPct: 0,
  volatilityPct: 5.0,
};

export const highRiskAssetClass: AssetClassData = {
  avgReturnPct: 20.0,
  probNegativeYearPct: 35,
  expectedShortfallPct: -40,
  maxDrawdownPct: -65,
  volatilityPct: 30.0,
};

export const zeroReturnAssetClass: AssetClassData = {
  avgReturnPct: 0,
  probNegativeYearPct: 0,
  expectedShortfallPct: 0,
  maxDrawdownPct: 0,
  volatilityPct: 0,
};

export const probNegative100AssetClass: AssetClassData = {
  avgReturnPct: -10.0,
  probNegativeYearPct: 100,
  expectedShortfallPct: -10,
  maxDrawdownPct: -20,
  volatilityPct: 15.0,
};

export const fullAssetClasses: AssetClasses = {
  largeCap: {
    "3Y": { avgReturnPct: 12.0, probNegativeYearPct: 22, expectedShortfallPct: -18, maxDrawdownPct: -35, volatilityPct: 20.0 },
    "5Y": { avgReturnPct: 11.5, probNegativeYearPct: 20, expectedShortfallPct: -17, maxDrawdownPct: -32, volatilityPct: 18.0 },
    "10Y": { avgReturnPct: 11.0, probNegativeYearPct: 18, expectedShortfallPct: -15, maxDrawdownPct: -28, volatilityPct: 15.0 },
  },
  bond: {
    "3Y": { avgReturnPct: 6.5, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 5.0 },
    "5Y": { avgReturnPct: 6.8, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 5.0 },
    "10Y": { avgReturnPct: 7.0, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 5.0 },
  },
  midCap: {
    "3Y": { avgReturnPct: 15.0, probNegativeYearPct: 26, expectedShortfallPct: -24, maxDrawdownPct: -45, volatilityPct: 26.0 },
    "5Y": { avgReturnPct: 14.0, probNegativeYearPct: 24, expectedShortfallPct: -22, maxDrawdownPct: -42, volatilityPct: 23.0 },
    "10Y": { avgReturnPct: 13.0, probNegativeYearPct: 22, expectedShortfallPct: -20, maxDrawdownPct: -38, volatilityPct: 20.0 },
  },
};
