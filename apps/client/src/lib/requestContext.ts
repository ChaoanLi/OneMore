/** Pure request identity; no Taro dependency, so delayed response behavior is unit-testable. */
export class RequestContext {
  private generation = 0
  private contentGeneration = 0
  private locale: 'zh-CN' | 'en' = 'zh-CN'
  private token: string | null = null
  private spaceId: string | null = null
  setIdentity(token: string | null) {
    if (token !== this.token) {
      this.token = token
      this.spaceId = null
      this.generation++
      this.contentGeneration++
    }
  }
  setSpace(id: string | null) {
    if (id !== this.spaceId) {
      this.spaceId = id
      this.generation++
      this.contentGeneration++
    }
  }
  setLocale(locale: 'zh-CN' | 'en') {
    if (locale !== this.locale) {
      this.locale = locale
      this.generation++
    }
  }
  sameContent(snapshot: { contentGeneration: number }) {
    return snapshot.contentGeneration === this.contentGeneration
  }
  capture() {
    return {
      generation: this.generation,
      contentGeneration: this.contentGeneration,
      token: this.token,
      spaceId: this.spaceId,
      locale: this.locale,
    }
  }
  isCurrent(snapshot: { generation: number }) {
    return snapshot.generation === this.generation
  }
}
export const requestContext = new RequestContext()
