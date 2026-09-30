/**
 * Google Places API (New) client: text search, photos and reviews.
 *
 * The API key is passed in at runtime (Inspector field on TripOpticLayoutPrototype).
 * Never hardcode it in a committed file. Wikipedia / Commons thumbnails work
 * without a key (serialized to avoid 429s).
 */

import { fetchTexture, REMOTE_UA } from './TripOpticRemoteImage'

export interface PlaceReview {
  author: string
  rating: number
  text: string
  when: string
}

export interface PlacePhotoRef {
  name: string
  widthPx: number
  heightPx: number
  attribution: string
}

export interface PlaceResult {
  id: string
  name: string
  address: string
  rating?: number
  ratingCount?: number
  priceLevel?: string
  summary?: string
  photo?: PlacePhotoRef
  reviews: PlaceReview[]
  lat?: number
  lng?: number
}

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.shortFormattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.editorialSummary',
  'places.photos',
  'places.reviews',
  'places.location',
].join(',')
// SKU: displayName/address/photos metadata = Text Search Pro.
// rating/priceLevel = Enterprise. reviews/editorialSummary = Enterprise + Atmosphere.
// Fetching a photo URI is billed separately as Place Photos (~$7/1k, 1k free/month).

const PRICE_SYMBOLS: { [level: string]: string } = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '€',
  PRICE_LEVEL_MODERATE: '€€',
  PRICE_LEVEL_EXPENSIVE: '€€€',
  PRICE_LEVEL_VERY_EXPENSIVE: '€€€€',
}

export class TripOpticPlaces {
  private searches: { [query: string]: Promise<PlaceResult[]> } = {}
  private photos: { [name: string]: Promise<Texture> } = {}
  private wikiTail: Promise<void> = Promise.resolve()

  constructor(
    private internetModule: InternetModule,
    private remoteMediaModule: RemoteMediaModule,
    apiKey: string,
    private host: ScriptComponent,
  ) {
    this.apiKey = (apiKey || '').trim()
  }

  private apiKey: string

  get enabled(): boolean {
    return !!this.apiKey && this.apiKey.length > 20
  }

  static priceSymbol(level: string | undefined): string | undefined {
    return level ? PRICE_SYMBOLS[level] : undefined
  }

  /** Cached per query string. `includedType` is a Places type such as restaurant, lodging, tourist_attraction. */
  search(query: string, maxResults: number = 3, includedType?: string): Promise<PlaceResult[]> {
    const key = `${query}|${maxResults}|${includedType || ''}`
    if (!this.searches[key]) {
      this.searches[key] = this.runSearch(query, maxResults, includedType)
      this.searches[key].catch(() => delete this.searches[key])
    }
    return this.searches[key]
  }

  /** Wikipedia / Commons thumbnail — no Places key. Requests are serialized to avoid 429s. */
  wikiPhoto(title: string): Promise<Texture> {
    const key = `wiki:${title}`
    if (!this.photos[key]) {
      this.photos[key] = this.enqueueWiki(title)
      this.photos[key].catch(() => delete this.photos[key])
    }
    return this.photos[key]
  }

  private enqueueWiki(title: string): Promise<Texture> {
    const run = this.wikiTail.then(() => this.wait(280)).then(() => this.loadWikiSearch(title))
    this.wikiTail = run.then(
      () => {},
      () => {},
    )
    return run
  }

  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const ev = this.host.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent
      ev.bind(() => resolve())
      ev.reset(ms / 1000)
    })
  }

  private async loadWikiSearch(title: string, retried: boolean = false): Promise<Texture> {
    const q = encodeURIComponent(title)
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q}` +
      `&gsrlimit=3&prop=pageimages&piprop=thumbnail%7Coriginal&pithumbsize=800`
    const response = await this.internetModule.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': REMOTE_UA },
    })
    if (response.status === 429 && !retried) {
      await this.wait(1200)
      return this.loadWikiSearch(title, true)
    }
    if (response.status !== 200) {
      throw new Error(`wiki search ${response.status}`)
    }
    const json = await response.json()
    const pages: any = json && json.query && json.query.pages ? json.query.pages : {}
    let foundTitle = ''
    for (const id in pages) {
      const page = pages[id]
      if (!foundTitle && page && page.title) {
        foundTitle = page.title
      }
      const src =
        page && page.thumbnail && page.thumbnail.source
          ? page.thumbnail.source
          : page && page.original && page.original.source
            ? page.original.source
            : ''
      if (src) {
        return this.loadUrl(src)
      }
    }
    if (foundTitle) {
      try {
        return await this.loadWikiSummary(foundTitle)
      } catch (e) {
        try {
          return await this.loadWikiMediaList(foundTitle)
        } catch (e2) {
          return this.loadCommons(title)
        }
      }
    }
    return this.loadCommons(title)
  }

  /** Cached per photo resource name. */
  photoTexture(photo: PlacePhotoRef, maxWidthPx: number = 800): Promise<Texture> {
    if (!this.photos[photo.name]) {
      this.photos[photo.name] = this.loadPhoto(photo.name, maxWidthPx)
      this.photos[photo.name].catch(() => delete this.photos[photo.name])
    }
    return this.photos[photo.name]
  }

  private async runSearch(query: string, maxResults: number, includedType?: string): Promise<PlaceResult[]> {
    if (!this.enabled) {
      throw new Error('Places API key missing')
    }
    const body: any = { textQuery: query, maxResultCount: maxResults, languageCode: 'en' }
    if (includedType) {
      body.includedType = includedType
    }
    const response = await this.internetModule.fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    })
    if (response.status !== 200) {
      throw new Error(`Places search ${response.status}: ${await response.text()}`)
    }
    const json = await response.json()
    const places: any[] = json && json.places ? json.places : []
    return places.map((p) => this.toResult(p))
  }

  private async loadWikiSummary(title: string): Promise<Texture> {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    const response = await this.internetModule.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': REMOTE_UA },
    })
    if (response.status !== 200) {
      throw new Error(`wiki ${response.status}`)
    }
    const json = await response.json()
    const src: string =
      json && json.originalimage && json.originalimage.source
        ? json.originalimage.source
        : json && json.thumbnail && json.thumbnail.source
          ? json.thumbnail.source
          : ''
    if (!src) {
      return this.loadWikiMediaList(title)
    }
    return this.loadUrl(src)
  }

  private async loadWikiMediaList(title: string): Promise<Texture> {
    const slug = encodeURIComponent(title.replace(/ /g, '_'))
    const url = `https://en.wikipedia.org/api/rest_v1/page/media-list/${slug}`
    const response = await this.internetModule.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': REMOTE_UA },
    })
    if (response.status !== 200) {
      throw new Error(`wiki media ${response.status}`)
    }
    const json = await response.json()
    const items: any[] = json && json.items ? json.items : []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type !== 'image') {
        continue
      }
      const srcset: any[] = items[i].srcset || []
      const raw: string = srcset.length > 0 && srcset[0].src ? srcset[0].src : ''
      if (raw) {
        const abs = raw.indexOf('//') === 0 ? `https:${raw}` : raw
        return this.loadUrl(abs)
      }
    }
    throw new Error('wiki media: no image')
  }

  private async loadCommons(title: string): Promise<Texture> {
    const q = encodeURIComponent(title)
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search` +
      `&gsrsearch=${q}&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=800`
    const response = await this.internetModule.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': REMOTE_UA },
    })
    if (response.status !== 200) {
      throw new Error(`commons ${response.status}`)
    }
    const json = await response.json()
    const pages: any = json && json.query && json.query.pages ? json.query.pages : {}
    for (const id in pages) {
      const infos: any[] = pages[id] && pages[id].imageinfo ? pages[id].imageinfo : []
      const src = infos.length > 0 ? infos[0].thumburl || infos[0].url : ''
      if (src) {
        return this.loadUrl(src)
      }
    }
    throw new Error('commons: no image')
  }

  private loadUrl(url: string): Promise<Texture> {
    return fetchTexture(this.internetModule, url)
  }

  private async loadPhoto(name: string, maxWidthPx: number): Promise<Texture> {
    const url = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`
    const response = await this.internetModule.fetch(url, { method: 'GET', headers: { 'X-Goog-Api-Key': this.apiKey } })
    if (response.status !== 200) {
      throw new Error(`Places photo ${response.status}`)
    }
    const json = await response.json()
    const photoUri: string = json && json.photoUri ? json.photoUri : ''
    if (!photoUri) {
      throw new Error('Places photo: no photoUri')
    }
    return fetchTexture(this.internetModule, photoUri)
  }

  private toResult(p: any): PlaceResult {
    const photos: any[] = p.photos || []
    const first = photos.length > 0 ? photos[0] : null
    const authors: any[] = first && first.authorAttributions ? first.authorAttributions : []
    const reviews: any[] = p.reviews || []
    return {
      id: p.id,
      name: p.displayName && p.displayName.text ? p.displayName.text : '',
      address: p.shortFormattedAddress || '',
      rating: typeof p.rating === 'number' ? p.rating : undefined,
      ratingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : undefined,
      priceLevel: p.priceLevel,
      summary: p.editorialSummary && p.editorialSummary.text ? p.editorialSummary.text : undefined,
      photo: first
        ? {
            name: first.name,
            widthPx: first.widthPx || 4,
            heightPx: first.heightPx || 3,
            attribution: authors.length > 0 && authors[0].displayName ? authors[0].displayName : '',
          }
        : undefined,
      reviews: reviews.slice(0, 5).map((r) => ({
        author: r.authorAttribution && r.authorAttribution.displayName ? r.authorAttribution.displayName : 'Google user',
        rating: typeof r.rating === 'number' ? r.rating : 0,
        text: r.text && r.text.text ? r.text.text : r.originalText && r.originalText.text ? r.originalText.text : '',
        when: r.relativePublishTimeDescription || '',
      })),
      lat: p.location && typeof p.location.latitude === 'number' ? p.location.latitude : undefined,
      lng: p.location && typeof p.location.longitude === 'number' ? p.location.longitude : undefined,
    }
  }
}
