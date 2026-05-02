import React, { createContext, useCallback, useContext, useState } from 'react'
import { Theme, ThemeMode, darkTheme, lightTheme } from './themes'

interface ThemeContextValue {
  theme: Theme
  mode: ThemeMode
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  mode: 'dark',
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [mode, setMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('pdf-vault-theme') as ThemeMode) ?? 'dark'
  })

  const toggle = useCallback(() => {
    setMode(m => {
      const next = m === 'dark' ? 'light' : 'dark'
      localStorage.setItem('pdf-vault-theme', next)
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme: mode === 'dark' ? darkTheme : lightTheme, mode, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme
}

export function useThemeContext(): ThemeContextValue {
  return useContext(ThemeContext)
}
