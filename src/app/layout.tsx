import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Sidebar } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/top-bar'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Command Center',
  description: 'Founder Command Center — OpenClaw Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${mono.variable}`}>
      <body className="font-sans">
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar />
            {/* Fluid: the dashboard is a single-user data surface on a large
                display, so width is used, not capped. Readable measure is the
                job of Board columns and the markdown measure policy, not of a
                container cap — see tasks/todo.md Phase 14. */}
            <main className="flex-1 overflow-auto">
              <div className="px-4 py-4 md:px-6 md:py-5">
                {children}
              </div>
            </main>
          </div>
        </div>
      </body>
    </html>
  )
}
