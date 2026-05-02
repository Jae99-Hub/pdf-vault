export type ThemeMode = 'dark' | 'light'

export interface Theme {
  bg: string
  surface: string
  card: string
  border: string
  borderLight: string
  text: string
  textMuted: string
  textDim: string
  accent: string
  accentDim: string
  success: string
  warning: string
  danger: string
  dangerBg: string
  // sidebar
  sidebarBg: string
  hover: string
  active: string
  activeBorder: string
  dropHover: string
  dropText: string
  muted: string
  // document list
  listBg: string
  listHover: string
  selectedBg: string
  selectionBarBg: string
  selectionBarBorder: string
  badgeBg: string
  dateDim: string
  folderBadgeBg: string
  folderBadgeText: string
  favoriteOff: string
  contextMenuBg: string
  inputBg: string
  // pdf viewer
  toolbar: string
  canvas: string
  panelBg: string
}

export const darkTheme: Theme = {
  bg: '#16161a',
  surface: '#1e1e24',
  card: '#22222b',
  border: '#2a2a33',
  borderLight: '#32323e',
  text: '#e2e2e8',
  textMuted: '#8888a0',
  textDim: '#4a4a5a',
  accent: '#4d94e8',
  accentDim: '#1a3560',
  success: '#4ec97e',
  warning: '#f0c040',
  danger: '#e05555',
  dangerBg: '#2e1515',
  sidebarBg: '#22222a',
  hover: '#2a2a33',
  active: '#1a3560',
  activeBorder: '#4d94e8',
  dropHover: '#163328',
  dropText: '#4eca7c',
  muted: '#666678',
  listBg: '#1c1c21',
  listHover: '#26262f',
  selectedBg: '#162440',
  selectionBarBg: '#0e2840',
  selectionBarBorder: '#1a3a60',
  badgeBg: '#2a2a35',
  dateDim: '#4a4a60',
  folderBadgeBg: '#2a2510',
  folderBadgeText: '#7a6a30',
  favoriteOff: '#333345',
  contextMenuBg: '#2a2a33',
  inputBg: '#1e1e28',
  toolbar: '#1a1a20',
  canvas: '#2a2a32',
  panelBg: '#1a1a20',
}

export const lightTheme: Theme = {
  bg: '#f4f4f8',
  surface: '#ffffff',
  card: '#fafafe',
  border: '#dcdce8',
  borderLight: '#c8c8d8',
  text: '#1c1c2e',
  textMuted: '#606080',
  textDim: '#a8a8c0',
  accent: '#2468c8',
  accentDim: '#dde8f8',
  success: '#1d8a5a',
  warning: '#b06820',
  danger: '#c43030',
  dangerBg: '#fce8e8',
  sidebarBg: '#ededf2',
  hover: '#e4e4ec',
  active: '#d8e6f8',
  activeBorder: '#2468c8',
  dropHover: '#d0e8d8',
  dropText: '#1a7a48',
  muted: '#8888a8',
  listBg: '#f0f0f6',
  listHover: '#e8e8f2',
  selectedBg: '#d0e0f8',
  selectionBarBg: '#dde8f8',
  selectionBarBorder: '#a8c8e8',
  badgeBg: '#e4e4ee',
  dateDim: '#9090aa',
  folderBadgeBg: '#f0e8d0',
  folderBadgeText: '#8a6800',
  favoriteOff: '#c8c8d8',
  contextMenuBg: '#ffffff',
  inputBg: '#f4f4fa',
  toolbar: '#eeeef4',
  canvas: '#d8d8e4',
  panelBg: '#f4f4fa',
}
