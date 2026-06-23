import type { WidgetBootstrapConfig } from './widget-bootstrap';

export type WidgetThemeTokenInput = Partial<Record<keyof WidgetBootstrapConfig['theme'], unknown>> | undefined;

export type ResolvedWidgetTheme = WidgetBootstrapConfig['theme'] & {
  className: string;
};

const DEFAULT_WIDGET_THEME = {
  colorMode: 'system',
  accent: 'blue',
  radius: 'md',
} as const satisfies WidgetBootstrapConfig['theme'];

const COLOR_MODE_CLASS_NAMES = {
  light: 'widget-welcome--mode-light',
  dark: 'widget-welcome--mode-dark',
  system: 'widget-welcome--mode-system',
} as const satisfies Record<WidgetBootstrapConfig['theme']['colorMode'], string>;

const ACCENT_CLASS_NAMES = {
  blue: 'widget-welcome--accent-blue',
} as const satisfies Record<WidgetBootstrapConfig['theme']['accent'], string>;

const RADIUS_CLASS_NAMES = {
  md: 'widget-welcome--radius-md',
} as const satisfies Record<WidgetBootstrapConfig['theme']['radius'], string>;

function isToken<T extends string>(value: unknown, tokenMap: Record<T, string>): value is T {
  return typeof value === 'string' && Object.hasOwn(tokenMap, value);
}

export function resolveWidgetTheme(theme: WidgetThemeTokenInput = {}): ResolvedWidgetTheme {
  const colorMode = isToken(theme.colorMode, COLOR_MODE_CLASS_NAMES)
    ? theme.colorMode
    : DEFAULT_WIDGET_THEME.colorMode;
  const accent = isToken(theme.accent, ACCENT_CLASS_NAMES) ? theme.accent : DEFAULT_WIDGET_THEME.accent;
  const radius = isToken(theme.radius, RADIUS_CLASS_NAMES) ? theme.radius : DEFAULT_WIDGET_THEME.radius;

  return {
    colorMode,
    accent,
    radius,
    className: [COLOR_MODE_CLASS_NAMES[colorMode], ACCENT_CLASS_NAMES[accent], RADIUS_CLASS_NAMES[radius]].join(' '),
  };
}
