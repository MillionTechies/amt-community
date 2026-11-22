import { useLocation } from 'react-router-dom'

// Writes the router's current address into the page, for currentPath() in ./render.
export function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location" hidden>{location.pathname + location.search}</output>
}
