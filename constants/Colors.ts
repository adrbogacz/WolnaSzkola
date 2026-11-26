export const palette = {
  cream: '#F4F1EA',
  paper: '#FFFcf7',
  ink: '#1C1917',
  muted: '#78716C',
  line: '#E7E0D6',
  navy: '#1E3A5F',
  navySoft: '#2C5282',
  terracotta: '#C45C26',
  green: '#3F7D4E',
  red: '#B42318',
  amber: '#B45309',
  blue: '#1D4E89',
};

const Colors = {
  light: {
    text: palette.ink,
    background: palette.cream,
    tint: palette.navy,
    tabIconDefault: '#A8A29E',
    tabIconSelected: palette.navy,
    card: '#FFFcf7',
    muted: palette.muted,
    line: palette.line,
    accent: palette.terracotta,
    /** Text and icons on a tint-coloured background (buttons, selected chips). */
    onTint: '#FFFFFF',
    danger: palette.red,
    warning: palette.amber,
    demoBackground: '#F6E1C8',
    demoText: '#7A4A18',
  },
  dark: {
    text: '#F5F0E8',
    background: '#161410',
    tint: '#E8D5C4',
    tabIconDefault: '#78716C',
    tabIconSelected: '#E8D5C4',
    card: '#221F1B',
    muted: '#A8A29E',
    line: '#3F3A34',
    accent: '#E07A3D',
    onTint: '#1C1917',
    danger: '#F97066',
    warning: '#F5A524',
    demoBackground: '#3D2A16',
    demoText: '#F6D2A8',
  },
};

export default Colors;

/** Dark or white text, whichever reads better on a background colour like '#9BE89B' or 'rgb(...)'. */
export function textOn(background: string | undefined): string {
  const rgb = parseColor(background);
  if (!rgb) return '#FFFFFF';
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs against near-black ink; take the larger.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.06 ? '#FFFFFF' : palette.ink;
}

function parseColor(value: string | undefined): [number, number, number] | null {
  const text = value?.trim() ?? '';
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(text);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}
