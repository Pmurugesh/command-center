import { redirect } from 'next/navigation'

// Partnerships became part of Channels (vehicles + partners, one clocked
// store). Old bookmarks and deep links land on the new page.
export default function PartnershipsPage() {
  redirect('/channels')
}
