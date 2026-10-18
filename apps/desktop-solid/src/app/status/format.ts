import { formatNumber } from '../../localization';

/** Whole percent, never rounding a running task up to 100%. */
export const percentText = (progress: number) =>
  formatNumber(Math.floor(progress * 100) / 100, { style: 'percent', maximumFractionDigits: 0 });
