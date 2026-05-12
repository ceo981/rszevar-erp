'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';

// ============================================================================
// RS ZEVAR ERP — ThemeContext
// ----------------------------------------------------------------------------
// Dark ↔ Light theme switcher with localStorage persistence + no-flash SSR.
//
// How it works:
//   • Default theme = 'dark' (matches legacy brand look)
//   • User preference saved in localStorage('rszevar-theme')
//   • A tiny inline script in app/layout.js sets `document.documentElement
//     .dataset.theme` BEFORE React hydrates → no dark-flash on light page load
//   • This context just syncs React state with that attribute and writes back
//     on toggle
//
// Usage in any client component:
//   const { theme, toggleTheme, setTheme } = useTheme();
//
// Theme values:  'dark' | 'light'
// ============================================================================

const ThemeContext = createContext({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }) {
  // Initial state: read from <html data-theme="..."> which the no-flash script
  // already set. Fallback to 'dark'. We use lazy init to avoid hydration mismatch.
  const [theme, setThemeState] = useState(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  });

  // Apply theme to <html> + persist to localStorage whenever state changes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('rszevar-theme', theme);
    } catch {
      // localStorage might be blocked (private browsing) — just skip
    }
    // Also update the browser theme-color meta so iOS status bar matches
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'light' ? '#faf7f0' : '#080c16');
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (next === 'light' || next === 'dark') setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
