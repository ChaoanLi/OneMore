export interface Space { id: string; name: string; ownerId: string; createdAt: string }
export interface Membership { spaceId: string; userId: string; role: 'owner' | 'member'; joinedAt: string; emailEnabled: boolean }
export interface SpaceSummary extends Space { role: Membership['role'] }
export interface SpaceJoinRequest { id: string; spaceId: string; userId: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string }
