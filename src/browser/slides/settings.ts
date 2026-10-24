/**
 * KIND-SPECIFIC (slides): the header settings the chrome and the editor's
 * toolbar offer — `theme` (the 14 slide themes), `ratio` (16:9 / 4:3) and
 * the Q3 keys `slide_numbers`, `progress`, `section_numbers` (FC-18 §5.1;
 * REBUILD §3c step 4). Document data: choosing writes the header (one
 * undoable edit); `section_numbers`' "Theme default" removes the key, so
 * the theme decides (Paper roman, the others 01).
 */
import type { SettingControl } from 'orz-markdown/carrier/app';
import { deckConfig, RATIOS } from '../../deck/config.js';
import { presentationOf } from '../../presentation.js';
import { THEMES, themeOf, themeSwatch } from '../../themes.js';

const YES_NO = Object.freeze([{ value: 'yes', label: 'Shown' }, { value: 'no', label: 'Hidden' }]);
const STYLE_LABEL: Readonly<Record<string, string>> = Object.freeze({ '01': '01, 02, 03', plain: '1, 2, 3', roman: 'I, II, III', none: 'None' });

export const SLIDES_SETTINGS: readonly SettingControl[] = Object.freeze([
  {
    key: 'theme',
    label: 'Theme',
    icon: 'theme',
    choices: THEMES.map((t) => ({ value: t.id, label: t.name, swatch: themeSwatch(t.id) })),
    current: (text: string) => presentationOf(text).theme.id,
  },
  {
    key: 'ratio',
    label: 'Ratio',
    choices: RATIOS.map((r) => ({ value: r, label: r })),
    current: (text: string) => presentationOf(text).ratio,
  },
  {
    key: 'slide_numbers',
    label: 'Slide numbers',
    choices: YES_NO,
    current: (text: string) => (deckConfig(text).slideNumbers ? 'yes' : 'no'),
  },
  {
    key: 'progress',
    label: 'Progress bar',
    choices: YES_NO,
    current: (text: string) => (deckConfig(text).progress ? 'yes' : 'no'),
  },
  {
    key: 'section_numbers',
    label: 'Section numbers',
    choices: [{ value: 'theme', label: 'Theme default' }, ...(['01', 'plain', 'roman', 'none'] as const).map((v) => ({ value: v, label: STYLE_LABEL[v] }))],
    choicesFor: (text: string) => [
      { value: 'theme', label: `Theme default (${STYLE_LABEL[themeOf(deckConfig(text).theme).sectionNumbers]})` },
      ...(['01', 'plain', 'roman', 'none'] as const).map((v) => ({ value: v, label: STYLE_LABEL[v] })),
    ],
    current: (text: string) => deckConfig(text).sectionNumbers ?? 'theme',
    apply: (_text: string, value: string) => ({ section_numbers: value === 'theme' ? null : value }),
  },
]);
