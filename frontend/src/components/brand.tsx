/** A Million Techies brand marks: the monitor logo, and the rhino used as an accent. */

/** The A Million Techies monitor (cursor and code on screen), as on amilliontechies.com. */
export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="26" height="18" rx="3" />
      <path d="m10.5 10-3 3 3 3M21.5 10l3 3-3 3M17.5 9l-3 8" />
      <path d="M16 22v4M10.5 27h11" />
    </svg>
  )
}

/** The logo as a tile: a white monitor on A Million Techies green. */
export function LogoTile({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span className={`grid place-items-center rounded-xl bg-brand-600 text-white ${className}`}>
      <LogoMark className="h-[62%] w-[62%]" />
    </span>
  )
}

/** Side-on white rhino, grazing. Drawn in currentColor; `far` colours the far legs, `fold` the skin folds. */
export function Rhino({
  className = '',
  fold = '#ffffff',
  far = '#3f4a44',
}: {
  className?: string
  fold?: string
  far?: string
}) {
  return (
    <svg className={className} viewBox="0 0 640 340" fill="currentColor" aria-hidden="true">
      {/* The far legs, a shade lighter so the body reads as solid. */}
      <g fill={far}>
        <path d="M486 244C490 276 488 306 490 326C491 332 496 334 502 334L522 334C528 334 530 328 528 320C524 296 524 272 526 246Z" />
        <path d="M262 246C266 278 264 306 266 326C267 332 272 334 278 334L296 334C302 334 304 328 302 320C298 296 298 272 300 246Z" />
      </g>
      <path d="M588 170C600 186 602 206 596 224" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M60 300C44 296 38 278 46 262C48 254 52 248 58 244C52 206 54 164 70 126C80 166 96 204 114 230C122 228 128 226 134 224C136 210 140 196 148 186C154 200 160 212 168 220C190 212 208 198 218 178L226 140C236 148 240 160 238 176C256 150 284 116 322 104C366 94 426 100 474 106C524 112 566 128 584 162C596 188 596 214 588 236C584 262 582 296 586 322C587 330 580 334 572 334L536 334C528 334 526 326 528 318C530 298 528 272 522 248C480 262 400 264 352 252C350 280 350 310 354 322C356 330 350 334 342 334L306 334C298 334 294 326 298 318C302 300 300 276 296 250C276 252 256 262 238 274C210 292 180 304 150 306C120 308 86 306 70 304C66 303 62 302 60 300Z" />
      <g fill="none" stroke={fold} strokeOpacity="0.3" strokeWidth="2.5" strokeLinecap="round">
        <path d="M244 178C238 206 240 238 252 266" />
        <path d="M312 112C296 160 298 210 316 250" />
        <path d="M510 114C494 158 496 206 516 246" />
        <path d="M300 300C312 304 330 304 344 300" />
        <path d="M532 300C544 304 562 304 576 300" />
      </g>
      <circle cx="182" cy="240" r="3.5" fill={fold} />
    </svg>
  )
}
