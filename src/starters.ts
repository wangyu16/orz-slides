/**
 * The deck templates of `newDocument({ template })` and `orz-slides new
 * --template` (rebuild step 7): the starter BODY a new text gets after its
 * header. A template is only a starting text — the header holds no
 * `template` key for slides (a slide's `template=` option is something
 * else: the title / section / outline / closing pages).
 *
 * - `starter` (the default): a tour of every kind of slide — the four
 *   template pages, a plain slide, stepped points with speaker notes, the
 *   presets, a float, a custom split and a slide's own footer;
 * - `talk`: the skeleton of a talk — title, outline, three sections of two
 *   slides, closing;
 * - `minimal`: a title page and one slide (what the browser's "New
 *   document" writes).
 *
 * Every starter is lint-clean and needs no network (no math, chart,
 * diagram, molecule or QR code: those load their libraries when shown).
 * Isomorphic: no Node built-ins.
 */

/** One deck template. */
export interface TemplateInfo {
  /** The id `newDocument({ template })` and `orz-slides new --template` take. */
  id: string;
  /** Its name. */
  label: string;
  /** One line for `orz-slides templates`. */
  description: string;
}

/** The deck templates, in the listing's order. */
export const TEMPLATES: readonly TemplateInfo[] = Object.freeze([
  { id: 'starter', label: 'Starter', description: 'a tour of every kind of slide: title, outline, section and closing pages, points, notes, presets, a float, a custom split' },
  { id: 'talk', label: 'Talk', description: 'the skeleton of a talk: title, outline, three sections of two slides, closing' },
  { id: 'minimal', label: 'Minimal', description: 'a title page and one slide' },
].map((t) => Object.freeze(t)));

/** The template `newDocument` and `orz-slides new` use when none is named. */
export const DEFAULT_TEMPLATE = 'starter';

/** The template ids. */
export const TEMPLATE_IDS: readonly string[] = Object.freeze(TEMPLATES.map((t) => t.id));

/** True for a template id. */
export const isTemplateId = (id: unknown): id is string => typeof id === 'string' && TEMPLATE_IDS.includes(id);

/** The starter body of a template, with `heading` (Markdown inline text) as the deck's title-page heading. */
export function starterBody(template: string, heading: string): string {
  switch (template) {
    case 'minimal':
      return `<!-- slide template=title -->\n# ${heading}\n## A subtitle\nYour name · the date\n\n<!-- slide -->\n## First slide\n\n- A point\n- Another point\n`;
    case 'talk':
      return [
        `<!-- slide template=title -->\n# ${heading}\n## What the talk is about, in one line\nYour name · where you are from · the date\n<!-- @notes -->\nSpeaker notes: press S in the read view for the speaker window, T for the timer.\n`,
        `<!-- slide template=outline -->\n## Outline\n1. The question\n2. What we did\n3. What we found\n`,
        `<!-- slide template=section -->\n# The question\nWhy it matters\n`,
        `<!-- slide -->\n## Why this matters\n\n- The problem, in the audience's words\n- What is known already\n- What is missing\n`,
        `<!-- slide -->\n## The question\n\n::: info\nOne sentence the rest of the talk answers.\n:::\n`,
        `<!-- slide template=section -->\n# What we did\nThe approach\n`,
        `<!-- slide 2col -->\n## The approach\n<!-- @left -->\n- Step one\n- Step two\n- Step three\n<!-- @right -->\nA picture, a table or a diagram goes here.\n`,
        `<!-- slide step -->\n## How it went\n\n- First this\n- Then that\n- And finally this\n`,
        `<!-- slide template=section -->\n# What we found\nThe results\n`,
        `<!-- slide main-side -->\n## The main result\n<!-- @main -->\n| Case | Before | After |\n|---|---:|---:|\n| A | 1.0 | 2.0 |\n| B | 1.5 | 2.5 |\n<!-- @side -->\n> The one thing to remember.\n`,
        `<!-- slide -->\n## Summary\n\n1. The question\n2. The answer\n3. What comes next\n`,
        `<!-- slide template=closing -->\n# Thank you\n## Questions?\nyour.address@example.org\n`,
      ].join('\n');
    case 'starter':
    default:
      return [
        `<!-- slide template=title -->\n# ${heading}\n## A subtitle\nYour name · the date\n<!-- @notes -->\nSpeaker notes: only you see them. In the read view press S for the speaker window, T for the timer, Esc for the overview.\n`,
        `<!-- slide template=outline -->\n## Outline\n1. Writing slides\n2. Layouts\n3. Wrapping up\n`,
        `<!-- slide template=section -->\n# Writing slides\nWhat a slide is made of\n`,
        `<!-- slide -->\n## A plain slide\n\nEvery \`<!-- slide -->\` line starts a slide; its first \`##\` heading is the title.\n\n- Write Markdown as usual: **bold**, *italic*, \`code\`, [links](https://markdown.orz.how)\n- A slide with too much text shrinks to fit its box\n- The header at the top holds the deck's title, theme, ratio and footer\n`,
        `<!-- slide step -->\n## Points that appear one by one\n\n- The \`step\` option shows list items one at a time\n- Press → or Space for the next one\n- Press S to see this slide's notes\n<!-- @notes -->\nNotes for this slide. A slide's own options go on its marker line: \`step\`, \`bg=\`, \`t=\`, \`fit=\`.\n`,
        `<!-- slide template=section -->\n# Layouts\nSplitting a slide into boxes\n`,
        `<!-- slide 2col -->\n## Two columns\n<!-- @left -->\nThe left box.\n\n- \`2col\`, \`3col\`, \`2row\`, \`main-side\` and \`quad\` are presets\n- \`2col 3/2\` sets the widths\n<!-- @right -->\n::: info\nThe right box. In the editor, enlarge the slide card to split, resize or delete boxes by hand.\n:::\n`,
        `<!-- slide main-side -->\n## Main and side, with a float\n<!-- @main -->\n| Step | What you do |\n|---|---|\n| 1 | Write the text |\n| 2 | Assemble the file |\n| 3 | Present it |\n<!-- @side -->\n> A side box for a note or a quote.\n<!-- @float left=66% top=70% w=28% h=16% -->\nA float sits over the slide.\n`,
        `<!-- slide row 1/3 { top; col 1/1 { left; right } } -->\n## A split of your own\n<!-- @top -->\nA row on top, two columns under it: \`row 1/3 { top; col 1/1 { left; right } }\`.\n<!-- @left -->\n- Name every box\n- Fill it with its marker\n<!-- @right -->\n- Nest rows and columns\n- Any depth\n<!-- @footer -->\nThis slide's own footer\n`,
        `<!-- slide template=section -->\n# Wrapping up\n`,
        `<!-- slide template=closing -->\n# Thank you\n## Questions?\nyour.address@example.org\n`,
      ].join('\n');
  }
}
