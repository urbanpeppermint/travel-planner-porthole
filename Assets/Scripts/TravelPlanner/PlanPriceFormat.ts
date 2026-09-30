import { CategoryOption, TripPlanResponse, TripPlanningCategory } from './TripTypes'

/**
 * Normalizes **model-written price strings** (leading zeros, Unicode dashes, "0120–0180 typical range").
 * Used at **display** time and once after **trip JSON parse** so every consumer sees the same strings.
 * **€ (U+20AC):** Some device fonts substitute a digit-like glyph for euro — final output uses ASCII `EUR ` for Text.
 * If your `Text` font includes U+20AC, you can stop calling `euroSignToAsciiForTextRendering` at the end of `formatModelPriceHint` and keep the literal `€`.
 */

/** Bump when changing price rules — printed once on first format so device logs prove bundle freshness. */
export const PLAN_PRICE_FORMAT_REVISION = 7

let loggedRevisionOnce = false

function logRevisionOnce(): void {
  if (loggedRevisionOnce) {
    return
  }
  loggedRevisionOnce = true
  print(
    `[PlanPriceFormat] revision=${PLAN_PRICE_FORMAT_REVISION} loaded. If padded prices still show raw, capture logs from [PlanPriceFormat] / [GeminiAssistant] / [CategoryPlanDetail].`,
  )
}

/** ASCII + common Unicode digits/hyphens that break our digit-only regexes. */
function charCodesSnippet(s: string, maxChars: number): string {
  const n = Math.min(s.length, maxChars)
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    parts.push(`U+${s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`)
  }
  return parts.join(' ')
}

function looksLikePaddedMoneyRange(s: string): boolean {
  return /(^|[^0-9])0\d{1,4}[^\d\n]{0,3}0?\d{2,5}/.test(s)
}

function stripPaddedMoneyNumbers(s: string): string {
  return s.replace(/\b0+([1-9]\d{1,4})\b/g, (_, n) => `${parseInt(n, 10)}`)
}

/**
 * Padded money ranges like `080-0120` / `0120-0180` without relying on `\\b` (some embedded
 * runtimes + Unicode edges mishandle word boundaries around digits and hyphens).
 * Skips `2024-05`-style year-month fragments.
 */
function collapseZeroPaddedIntegerRanges(s: string): string {
  return s.replace(
    /(^|[^0-9])(0*\d{2,5})(\s*-\s*)(0*\d{2,5})(?=$|[^0-9])/g,
    (full, prefix: string, left: string, dash: string, right: string) => {
      const padded =
        (left.length > 1 && left[0] === '0') || (right.length > 1 && right[0] === '0')
      if (!padded) {
        return full
      }
      const a = parseInt(left, 10)
      const b = parseInt(right, 10)
      if (a >= 1900 && a <= 2100 && b >= 1 && b <= 31 && right.length <= 2) {
        return full
      }
      if (a >= 1900 && a <= 2100 && b >= 1900 && b <= 2100 && b - a <= 80) {
        return full
      }
      return `${prefix}${a}${dash}${b}`
    },
  )
}

function stripPaddedMoneyNumbersRepeat(s: string): string {
  let out = s
  for (let i = 0; i < 8; i++) {
    const next = stripPaddedMoneyNumbers(out)
    if (next === out) {
      break
    }
    out = next
  }
  return out
}

/**
 * Category `Text` fonts on some Spectacles builds lack U+20AC; the engine can substitute a glyph that
 * looks like **0**, so `€120` reads as `0120`. Normalize to ASCII `EUR` + **space** + digits; also fix
 * glued `EUR200` from upstream text.
 */
function euroSignToAsciiForTextRendering(s: string): string {
  let t = s.replace(/\u20ac\s*/g, 'EUR ')
  t = t.replace(/\bEUR(\d{1,6})\b/gi, 'EUR $1')
  return t
}

/** Structured price fields and short free-text that often embed ranges. */
export function formatModelPriceHint(raw: string): string {
  logRevisionOnce()
  const rawStr = typeof raw === 'string' ? raw : raw != null ? String(raw) : ''
  if (!rawStr || rawStr.length === 0) {
    return rawStr
  }
  const tracePadded = looksLikePaddedMoneyRange(rawStr)
  if (tracePadded) {
    print(
      `[PlanPriceFormat] formatModelPriceHint IN (${rawStr.length}ch): ${rawStr.substring(0, 120)}${
        rawStr.length > 120 ? '…' : ''
      } | codes: ${charCodesSnippet(rawStr, 48)}`,
    )
  }
  let s = rawStr.trim().replace(/\u00a0/g, ' ').replace(/\u202f/g, ' ')
  // Gemini sometimes emits Latin letter O instead of € or digit 0 in amounts (e.g. "O120-O180").
  s = s.replace(/\b[oO](\d{2,6})\s*-\s*[oO](\d{2,6})\b/g, '$1-$2')
  s = s.replace(/\b[oO](\d{2,6})\b/g, '$1')
  s = s.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '')
  // Fullwidth digits (model / IME) → ASCII so all numeric passes below apply.
  s = s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
  s = s.replace(/\u20ac/g, '€')
  s = s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
  s = collapseZeroPaddedIntegerRanges(s)
  s = s.replace(/\bfrom\s+0+(\d{1,5})\b/gi, (_, n) => `from €${parseInt(n, 10)}`)
  // "08.80" day-ticket style (leading zero + cents) — not a year.
  s = s.replace(/\b0(\d\.\d{2})\b/g, (_, rest) => {
    const v = parseFloat(rest)
    if (isNaN(v)) {
      return `0${rest}`
    }
    return `€${v.toFixed(2)}`
  })
  // Lines that start with a numeric range (model JSON often has bare "0100-0150 typical…"). `\b` does NOT match at string start before a digit in JS.
  s = s.replace(/^(\d{1,6})\s*-\s*(\d{1,6})\b/gm, (_, a, b) => `${parseInt(a, 10)}-${parseInt(b, 10)}`)
  // Bare padded nightly ranges (common in accommodation JSON) — before label rules.
  s = s.replace(
    /\b(0*\d{2,5})\s*-\s*(0*\d{2,5})\s+(typical\s*range)\b/gi,
    (_, a, b, tail) => `${parseInt(a, 10)}-${parseInt(b, 10)} ${tail}`,
  )
  const labelPrice =
    '(?:Best price|Price|Per night|Full stay|From|Est\\.\\s*per person)'
  // Do not end label+number with `\b` before an optional range: `\b` matches between digit and `-`, so
  // `Per night: 0120-0180` could match only `0120` and corrupt the string. Use explicit range first, then single.
  s = s.replace(
    new RegExp(`\\b${labelPrice}\\s*:\\s*(\\d{1,6})\\s*-\\s*(\\d{1,6})(?=\\s|$|€|/|,|\\.|\\)|typical)`, 'gi'),
    (_m, label, n1, n2) => `${label}: ${parseInt(n1, 10)}-${parseInt(n2, 10)}`,
  )
  s = s.replace(
    new RegExp(`\\b${labelPrice}\\s*:\\s*(\\d{1,4}\\.\\d{2})(?=\\s|$|€|/|,|\\.|\\)|typical|-)`, 'gi'),
    (_m, label, dec) => `${label}: €${parseFloat(dec).toFixed(2)}`,
  )
  s = s.replace(
    new RegExp(`\\b${labelPrice}\\s*:\\s*(\\d{1,6})(?!\\s*-\\s*\\d)(?=\\s|$|€|/|,|\\.|\\)|typical)`, 'gi'),
    (_m, label, n1) => `${label}: ${parseInt(n1, 10)}`,
  )
  // Mid-string ranges: only rewrite when at least one side has a **leading zero** (money quirk), not `2024-05` dates.
  s = s.replace(/\b(\d{2,6})\s*-\s*(\d{2,6})\b/g, (full, a, b) => {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    const padded = (a.length > 1 && a[0] === '0') || (b.length > 1 && b[0] === '0')
    if (!padded) {
      return full
    }
    if (na >= 1900 && na <= 2035 && b.length <= 2) {
      return full
    }
    if (na >= 1900 && na <= 2035 && nb >= 1900 && nb <= 2035 && nb - na >= 0 && nb - na <= 50) {
      return full
    }
    return `${na}-${nb}`
  })
  s = s.replace(/\bEUR\s*[:=]?\s*0*([0-9]{1,6})\b/gi, (_, n) => `€${parseInt(n, 10)}`)
  s = s.replace(/\b0*([0-9]{1,6})\s*(?:EUR|euros?)\b/gi, (_, n) => `${parseInt(n, 10)} €`)
  s = s.replace(/€\s*0+([0-9]{1,6})\b/g, (_, n) => `€${parseInt(n, 10)}`)
  s = s.replace(/\$\s*0+([0-9]{1,6})\b/g, (_, n) => `$${parseInt(n, 10)}`)
  s = s.replace(/\b£\s*0+([0-9]{1,6})\b/g, (_, n) => `£${parseInt(n, 10)}`)
  s = s.replace(/\b0+([0-9]{1,6})\s*€\b/g, (_, n) => `${parseInt(n, 10)} €`)
  s = s.replace(/\b0+([0-9]{1,6})\s*\$\b/g, (_, n) => `${parseInt(n, 10)} $`)
  s = s.replace(/\b0+([1-9]\d{0,5})\s+€/g, (_, n) => `${parseInt(n, 10)} €`)
  const hasSym = /[€$£¥]/.test(s)
  if (!hasSym) {
    s = s.replace(/\b(from|around|~|approx\.?)\s+0*(\d{2,5})\b/gi, (_m, p, n) => `${p} €${parseInt(n, 10)}`)
    if (/^\d{2,5}$/.test(s)) {
      s = `€${parseInt(s, 10)}`
    } else {
      s = s.replace(/\b(\d{3,5})\s*(?:\/|\s+per\s+)\s*night\b/gi, (_, n) => `€${parseInt(n, 10)} / night`)
    }
  } else {
    s = s.replace(/\b(from|around|~|approx\.?)\s+0+(\d{2,5})\b/gi, (_m, p, n) => `${p} ${parseInt(n, 10)}`)
  }
  s = s.replace(/\b(from|around|~)\s+€\s*0+(\d{1,6})\b/gi, (_m, p, n) => `${p} €${parseInt(n, 10)}`)
  if (!/[€$£¥]/.test(s)) {
    s = s.replace(/^(\d{1,5}\s*-\s*\d{1,5})\s+(typical\s*range)\b/gim, '$1 € $2')
    s = s.replace(/\b(\d{1,5}\s*-\s*\d{1,5})\s+(typical\s*range)\b/gi, '$1 € $2')
  }
  s = stripPaddedMoneyNumbersRepeat(s)
  s = collapseZeroPaddedIntegerRanges(s)
  const out = euroSignToAsciiForTextRendering(s.trim())
  if (tracePadded) {
    print(
      `[PlanPriceFormat] formatModelPriceHint OUT (${out.length}ch): ${out.substring(0, 120)}${
        out.length > 120 ? '…' : ''
      }`,
    )
  }
  if (looksLikePaddedMoneyRange(out)) {
    print(
      `[PlanPriceFormat] WARN still looks padded after format — OUT: ${out.substring(0, 160)} | codes: ${charCodesSnippet(out, 56)}`,
    )
  }
  return out
}

export function sanitizeEmbeddedPricesInText(raw: string): string {
  const rawStr = typeof raw === 'string' ? raw : raw != null ? String(raw) : ''
  if (!rawStr || rawStr.trim().length === 0) {
    return rawStr
  }
  let s = rawStr.trim()
  s = s.replace(/\b[oO](\d{2,6})\s*-\s*[oO](\d{2,6})\b/g, '$1-$2')
  s = s.replace(/\b[oO](\d{2,6})\b/g, '$1')
  if (/€|EUR|euro|\$|£|price|night|per\s+night|from\s+0|per\s+person|\d\s*\/\s*night|typical\s*range/i.test(s)) {
    s = formatModelPriceHint(s)
  } else {
    s = stripPaddedMoneyNumbers(s)
  }
  return euroSignToAsciiForTextRendering(s)
}

const OPTION_PRICE_FIELDS: (keyof CategoryOption)[] = [
  'price',
  'pricePerNight',
  'totalStayPrice',
  'pricePerPerson',
]

const OPTION_TEXT_FIELDS: (keyof CategoryOption)[] = [
  'title',
  'notes',
  'outboundSummary',
  'inboundSummary',
  'ticketOfficeHint',
  'weatherPracticalTips',
  'luggageVisionHint',
]

/**
 * Mutates parsed plan options in place so UI, TTS, and any future surfaces all read cleaned money strings.
 * Call once from `GeminiAssistant.parseTripPlanJson` after `JSON.parse` succeeds.
 */
export function normalizeTripPlanPriceFields(plan: TripPlanResponse): void {
  logRevisionOnce()
  if (plan.summary && typeof plan.summary === 'string' && plan.summary.length > 0) {
    plan.summary = sanitizeEmbeddedPricesInText(plan.summary)
  }
  if (!plan.cards || typeof plan.cards !== 'object') {
    return
  }
  const keys = Object.keys(plan.cards) as TripPlanningCategory[]
  for (let i = 0; i < keys.length; i++) {
    const cat = keys[i]
    const card = plan.cards[cat]
    if (!card || !card.options) {
      continue
    }
    for (let j = 0; j < card.options.length; j++) {
      const opt = card.options[j]
      for (let k = 0; k < OPTION_PRICE_FIELDS.length; k++) {
        const field = OPTION_PRICE_FIELDS[k]
        const v = opt[field]
        if (typeof v === 'number' && !isNaN(v)) {
          const before = String(v)
          const after = formatModelPriceHint(before)
          ;(opt as unknown as Record<string, string>)[field as string] = after
          if (cat === 'accommodation' && (field === 'pricePerNight' || field === 'totalStayPrice')) {
            print(`[PlanPriceFormat] normalizeTripPlan ${cat} opt${j + 1} ${field} num→str: "${before}" → "${after}"`)
          }
        } else if (typeof v === 'string' && v.length > 0) {
          const before = v
          const padded = looksLikePaddedMoneyRange(before)
          const after = formatModelPriceHint(before)
          ;(opt as unknown as Record<string, string>)[field as string] = after
          if (cat === 'accommodation' && padded) {
            print(
              `[PlanPriceFormat] normalizeTripPlan ${cat} opt${j + 1} ${field}: "${before.substring(0, 100)}" → "${after.substring(0, 100)}"`,
            )
          }
        } else if (v != null && typeof v !== 'string' && typeof v !== 'number') {
          print(
            `[PlanPriceFormat] normalizeTripPlan ${cat} opt${j + 1} ${field}: unexpected type ${typeof v} (value not stringified — UI may skip format).`,
          )
        }
      }
      for (let k = 0; k < OPTION_TEXT_FIELDS.length; k++) {
        const field = OPTION_TEXT_FIELDS[k]
        const v = opt[field]
        if (typeof v === 'string' && v.length > 0) {
          ;(opt as unknown as Record<string, string>)[field as string] = sanitizeEmbeddedPricesInText(v)
        }
      }
    }
  }
}
