import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark';

interface UseThemeReturn {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

export const useTheme = (): UseThemeReturn => {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  return {
    theme,
    toggleTheme,
    isDark: theme === 'dark',
  };
};
