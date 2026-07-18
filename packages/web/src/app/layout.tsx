/* eslint-disable @next/next/no-css-tags -- Global CSS that does not need Next processing
 * (xterm vendor + app-level token/control styles) is served as static stylesheets to
 * bypass Next dev's flight CSS loader which chokes on class selectors and non-root CSS. */
import type { Metadata, Viewport } from 'next';
import { AgentHueInjector } from '@/components/AgentHueInjector';
import { AppShell } from '@/components/AppShell';
import { BrakeModal } from '@/components/BrakeModal';
import { GuideOverlay } from '@/components/GuideOverlay';
import { SessionBootstrap } from '@/components/SessionBootstrap';
import { ThemeApplier } from '@/components/ThemeApplier';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastContainer } from '@/components/ToastContainer';
import { ConfirmProvider } from '@/components/useConfirm';
import { META_THEME_COLOR } from '@/lib/color-defaults';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: META_THEME_COLOR,
};

export const metadata: Metadata = {
  title: 'Baiyuxi Agent Studio',
  description: 'Baiyuxi personal development-team agent workspace',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icons/studio-mark.svg', type: 'image/svg+xml' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Baiyuxi Agent Studio',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="/vendor/app/theme-tokens.css" />
        <link rel="stylesheet" href="/vendor/app/agent-persona-tokens.css" />
        <link rel="stylesheet" href="/vendor/app/agent-persona-derived.css" />
        <link rel="stylesheet" href="/vendor/app/connector-tokens.css" />
        <link rel="stylesheet" href="/vendor/app/theme-extras.css" />
        <link rel="stylesheet" href="/vendor/app/console-tokens.css" />
        <link rel="stylesheet" href="/vendor/app/console-shell.css" />
        <link rel="stylesheet" href="/vendor/app/console-controls.css" />
        <link rel="stylesheet" href="/vendor/app/werewolf-theme.css" />
        <link rel="stylesheet" href="/vendor/xterm/xterm.css" />
      </head>
      <body className="min-h-screen">
        <SessionBootstrap />
        <AgentHueInjector />
        <ThemeProvider>
          <ThemeApplier />
          <ConfirmProvider>
            <AppShell>{children}</AppShell>
          </ConfirmProvider>
          <BrakeModal />
          <GuideOverlay />
          <ToastContainer />
        </ThemeProvider>
      </body>
    </html>
  );
}
