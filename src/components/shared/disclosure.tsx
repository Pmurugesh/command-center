'use client'

import { createContext, useContext, useState } from 'react'

type DisclosureState = [open: boolean, setOpen: (open: boolean) => void]

const DisclosureContext = createContext<DisclosureState | null>(null)

/**
 * Open state shared by a button and the panel it opens, when the two render
 * apart: the button in PageHeader's actions, the panel below the header.
 *
 * /bids and /content used to render the open form inside the actions slot, so
 * the slot took the form's width: on a 375px phone the page scrolled sideways
 * (349px and 129px), and on a desktop the header grew as tall as the form with
 * the title floating halfway down it.
 */
export function Disclosure({ children }: { children: React.ReactNode }) {
  const state = useState(false)
  return <DisclosureContext.Provider value={state}>{children}</DisclosureContext.Provider>
}

export function useDisclosure(): DisclosureState {
  const state = useContext(DisclosureContext)
  if (!state) throw new Error('useDisclosure must be used inside <Disclosure>')
  return state
}
