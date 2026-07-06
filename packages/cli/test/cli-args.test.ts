import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../src/cli'

describe('parseCliArgs', () => {
  it('defaults to dev', () => {
    expect(parseCliArgs([])).toEqual({ command: 'dev', configPath: null })
  })

  it('parses ci with flags', () => {
    expect(
      parseCliArgs(['ci', '--config', './apiscope.config.ts', '--update-baseline', '--json', 'out.json', '--junit', 'out.xml'])
    ).toEqual({
      command: 'ci',
      configPath: './apiscope.config.ts',
      updateBaseline: true,
      jsonPath: 'out.json',
      junitPath: 'out.xml'
    })
  })

  it('parses ci without optional flags', () => {
    expect(parseCliArgs(['ci'])).toEqual({ command: 'ci', configPath: null, updateBaseline: false })
  })

  it('returns help for unknown commands and --help', () => {
    expect(parseCliArgs(['nonsense'])).toEqual({ command: 'help' })
    expect(parseCliArgs(['--help'])).toEqual({ command: 'help' })
  })

  it('parses serve with a config path', () => {
    expect(parseCliArgs(['serve', '--config', './apiscope.config.ts'])).toEqual({
      command: 'serve',
      configPath: './apiscope.config.ts'
    })
  })

  it('parses generate-scenario with flags', () => {
    expect(
      parseCliArgs([
        'generate-scenario',
        '--window',
        '5m',
        '--base-url',
        'http://localhost:3000',
        '--shape',
        'ramp',
        '--out',
        './apiscope.config.ts'
      ])
    ).toEqual({
      command: 'generate-scenario',
      configPath: null,
      window: '5m',
      baseUrl: 'http://localhost:3000',
      shape: 'ramp',
      out: './apiscope.config.ts'
    })
  })

  it('parses generate-scenario with defaults', () => {
    expect(parseCliArgs(['generate-scenario', '--base-url', 'http://localhost:3000'])).toEqual({
      command: 'generate-scenario',
      configPath: null,
      window: '5m',
      baseUrl: 'http://localhost:3000',
      shape: 'steady',
      out: './apiscope.config.ts'
    })
  })

  it('parses mcp with http and port', () => {
    expect(parseCliArgs(['mcp', '--http', '--port', '7000'])).toEqual({
      command: 'mcp',
      http: true,
      port: 7000,
      collectorUrl: null
    })
  })

  it('parses mcp defaulting to stdio', () => {
    expect(parseCliArgs(['mcp'])).toEqual({
      command: 'mcp',
      http: false,
      port: null,
      collectorUrl: null
    })
  })
})
