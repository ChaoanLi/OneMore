/** Cached Taro pages must not change the foreground page's active space. */
export function shouldSelectLinkedSpace(page: {
  visible: boolean
  switching: boolean
  global: boolean
  ready: boolean
  linked?: string
  activeSpace: string | null
  memberSpaceIds: string[]
}): boolean {
  return (
    page.visible &&
    !page.switching &&
    !page.global &&
    page.ready &&
    !!page.linked &&
    page.linked !== page.activeSpace &&
    page.memberSpaceIds.includes(page.linked)
  )
}
