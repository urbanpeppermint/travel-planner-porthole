/**
 * Download an image over fetch (with User-Agent) and decode it in-engine.
 * RemoteMediaModule.makeResourceFromUrl cannot set headers, so OSM / Wikimedia
 * block it on device. Do not use tile.openstreetmap.org from an app.
 */

export const REMOTE_UA = 'TripOptic/1.0 (Spectacles travel lens; educational; not OSMF tiles)'

export async function fetchTexture(
  internet: InternetModule,
  url: string,
  extraHeaders?: { [name: string]: string },
): Promise<Texture> {
  const headers: { [name: string]: string } = {
    'User-Agent': REMOTE_UA,
    Accept: 'image/png,image/jpeg,image/webp,image/*,*/*',
  }
  if (extraHeaders) {
    const keys = Object.keys(extraHeaders)
    for (let i = 0; i < keys.length; i++) {
      headers[keys[i]] = extraHeaders[keys[i]]
    }
  }
  const response = await internet.fetch(url, { method: 'GET', headers })
  if (response.status !== 200) {
    throw new Error(`image HTTP ${response.status}`)
  }
  const raw = await response.bytes()
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as any)
  if (!bytes || bytes.length < 24) {
    throw new Error('image empty')
  }
  if (!isRaster(bytes)) {
    throw new Error('not an image (blocked or HTML)')
  }
  const b64 = toBase64(bytes)
  return decodeTexture(b64)
}

function isRaster(bytes: Uint8Array): boolean {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return true
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return true
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return true
  }
  if (bytes.length > 11 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57) {
    return true
  }
  return false
}

function decodeTexture(b64: string): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    Base64.decodeTextureAsync(b64, resolve, () => reject(new Error('decodeTextureAsync failed')))
  })
}

function toBase64(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const len = bytes.length
  let out = ''
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i]
    const b = i + 1 < len ? bytes[i + 1] : 0
    const c = i + 2 < len ? bytes[i + 2] : 0
    const n = (a << 16) | (b << 8) | c
    out += table[(n >> 18) & 63]
    out += table[(n >> 12) & 63]
    out += i + 1 < len ? table[(n >> 6) & 63] : '='
    out += i + 2 < len ? table[n & 63] : '='
  }
  return out
}
