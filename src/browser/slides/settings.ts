/**
 * KIND-SPECIFIC (slides): the header settings the chrome and the editor's
 * toolbar offer — `theme` (the 14 slide themes) and `ratio` (16:9 / 4:3),
 * FC-18 §5.1. Document data: choosing writes the header. The Q3 keys
 * (slide numbers, progress, section numbers) join in rebuild step 4.
 */
import type { SettingControl } from 'orz-markdown/carrier/app';
import { RATIOS } from '../../deck/config.js';
import { presentationOf } from '../../presentation.js';
import { THEMES } from '../../themes.js';

/** A swatch colour per scheme (the chrome cannot read a theme's colours without loading it). */
const SWATCH = { light: 'oklch(97% 0.01 100)', dark: 'oklch(28% 0.02 260)' } as const;

export const SLIDES_SETTINGS: readonly SettingControl[] = Object.freeze([
  {
    key: 'theme',
    label: 'Theme',
    icon: 'theme',
    choices: THEMES.map((t) => ({ value: t.id, label: t.name, swatch: SWATCH[t.scheme] })),
    current: (text: string) => presentationOf(text).theme.id,
  },
  {
    key: 'ratio',
    label: 'Ratio',
    choices: RATIOS.map((r) => ({ value: r, label: r })),
    current: (text: string) => presentationOf(text).ratio,
  },
]);
