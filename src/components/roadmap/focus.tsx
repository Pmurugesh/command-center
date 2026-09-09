'use client'

/**
 * Open and hold focus on whatever the URL points at.
 *
 * Clicking an item in Build next jumps to `#<slug>`, which lands you on a
 * collapsed `<details>` somewhere inside a row card with nine tiles that look
 * alike. The browser scrolls, and you cannot tell which one it meant.
 *
 * Progressive enhancement, deliberately: the `:target` ring in the tile's own
 * styles already marks the landing spot with no JavaScript at all. This adds the
 * two things CSS cannot do — expand the tile so you see the proof and the
 * definition of done rather than a highlighted summary, and re-run on
 * `hashchange` so a second click inside the same page still works (the browser
 * fires no navigation for a same-page anchor).
 *
 * It never closes anything. Collapsing a tile the reader opened by hand, just
 * because they followed a link afterwards, would lose their place.
 */
import { useEffect } from 'react'

export function FocusOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      if (!id) return
      const el = document.getElementById(id)
      if (!(el instanceof HTMLDetailsElement)) return
      el.open = true
      // Re-scroll after expanding: the browser positioned against the collapsed
      // height, so the tile is usually half off-screen by the time it opens.
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  return null
}
