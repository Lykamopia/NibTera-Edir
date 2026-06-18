
import * as React from "react"

const MOBILE_BREAKPOINT = 768 // Corresponds to Tailwind's `md` breakpoint

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(false)

  React.useEffect(() => {
    const checkDevice = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    // Initial check
    checkDevice();
    
    window.addEventListener("resize", checkDevice)
    
    return () => window.removeEventListener("resize", checkDevice)
  }, [])

  return isMobile
}
