/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Semantic status colors — single source of truth
        status: {
          success: "#10b981",  // emerald-500
          warning: "#f59e0b",  // amber-500
          danger:  "#ef4444",  // red-500
          info:    "#8b5cf6",  // violet-500
          accent:  "#3b82f6",  // blue-500
        },
        // Bid workflow stages — each stage gets a distinct color
        bid: {
          discovered:  "#94a3b8",  // slate-400
          analyzing:   "#3b82f6",  // blue-500
          draft:       "#8b5cf6",  // violet-500
          review:      "#f59e0b",  // amber-500
          submitted:   "#06b6d4",  // cyan-500
          won:         "#10b981",  // emerald-500
          lost:        "#ef4444",  // red-500
          nobid:       "#64748b",  // slate-500
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  safelist: [
    // Bid status badge classes built dynamically in StatusBadge
    "bg-bid-discovered/10", "text-bid-discovered", "border-bid-discovered/30",
    "bg-bid-analyzing/10",  "text-bid-analyzing",  "border-bid-analyzing/30",
    "bg-bid-draft/10",      "text-bid-draft",      "border-bid-draft/30",
    "bg-bid-review/10",     "text-bid-review",     "border-bid-review/30",
    "bg-bid-submitted/10",  "text-bid-submitted",  "border-bid-submitted/30",
    "bg-bid-won/10",        "text-bid-won",        "border-bid-won/30",
    "bg-bid-lost/10",       "text-bid-lost",       "border-bid-lost/30",
    "bg-bid-nobid/10",      "text-bid-nobid",      "border-bid-nobid/30",
    "bg-bid-discovered", "bg-bid-analyzing", "bg-bid-draft", "bg-bid-review",
    "bg-bid-submitted", "bg-bid-won", "bg-bid-lost", "bg-bid-nobid",
  ],
  plugins: [require("tailwindcss-animate")],
}
