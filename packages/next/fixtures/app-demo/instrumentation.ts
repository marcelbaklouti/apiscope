import { withApiscope } from '@apiscope/next'

const apiscope = withApiscope({
  appName: 'next-fixture',
  collectorUrl: process.env.APISCOPE_COLLECTOR_URL ?? 'ws://127.0.0.1:4620'
})

export const register = apiscope.register
export const onRequestError = apiscope.onRequestError
