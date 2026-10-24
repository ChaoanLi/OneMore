/** Pure request identity; no Taro dependency, so delayed response behavior is unit-testable. */
export class RequestContext {
  private generation=0
  private token: string|null=null
  private spaceId: string|null=null
  setIdentity(token: string|null) { if(token!==this.token) { this.token=token; this.spaceId=null; this.generation++ } }
  setSpace(id: string|null) { if(id!==this.spaceId) {this.spaceId=id;this.generation++} }
  capture() { return {generation:this.generation,token:this.token,spaceId:this.spaceId} }
  isCurrent(snapshot: {generation:number}) { return snapshot.generation===this.generation }
}
export const requestContext=new RequestContext()
