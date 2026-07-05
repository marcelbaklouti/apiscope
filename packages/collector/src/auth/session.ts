import { SignJWT, jwtVerify } from 'jose'

export interface SessionClaims {
  subject: string
  displayName: string
}

export interface SessionCodec {
  issue(claims: SessionClaims, ttlSeconds: number): Promise<string>
  verify(token: string): Promise<SessionClaims | null>
}

export function createSessionCodec(secret: Uint8Array): SessionCodec {
  return {
    async issue(claims, ttlSeconds) {
      return new SignJWT({ displayName: claims.displayName })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.subject)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(secret)
    },
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, secret)
        if (typeof payload.sub !== 'string' || typeof payload['displayName'] !== 'string') return null
        return { subject: payload.sub, displayName: payload['displayName'] }
      } catch {
        return null
      }
    }
  }
}
