import type { Rule } from '../engine'
import { uncompressedResponsesRule } from './uncompressed'
import { missingCacheHeadersRule } from './missing-cache'
import { oversizedPayloadRule } from './oversized-payload'
import { slowRouteRule } from './slow-route'
import { whereTimeGoesRule } from './where-time-goes'
import { unstableLatencyRule } from './unstable-latency'
import { nPlusOneRule } from './n-plus-one'
import { sequentialOutboundRule } from './sequential-outbound'
import { slowDependencyRule } from './slow-dependency'
import { errorHotspotRule } from './error-hotspot'

export const ALL_RULES: Rule[] = [
  uncompressedResponsesRule,
  missingCacheHeadersRule,
  oversizedPayloadRule,
  slowRouteRule,
  whereTimeGoesRule,
  unstableLatencyRule,
  nPlusOneRule,
  sequentialOutboundRule,
  slowDependencyRule,
  errorHotspotRule
]
