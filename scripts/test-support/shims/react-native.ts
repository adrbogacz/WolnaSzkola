export const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  select<T>(options: { ios?: T; android?: T; web?: T; default?: T }): T | undefined {
    return options.ios ?? options.default;
  },
};

/** Tests set `currentState` to check foreground vs background behaviour. */
export const AppState = { currentState: 'background' as 'active' | 'background' | 'inactive' };
