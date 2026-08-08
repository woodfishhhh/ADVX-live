import { describe, expect, test } from 'bun:test'

import fixtureJson from './fixtures/agent-eval-smoke.json' with { type: 'json' }
import {
  AGENT_EVAL_ASSERTION_IDS,
  AgentEvalFixtureError,
  evaluateAgentFixture,
  parseAgentEvalFixture,
  serializeAgentEvalReport,
  type AgentEvalObservation
} from './agent-evaluator'

const fixture = parseAgentEvalFixture(fixtureJson)

describe('agent eval fixtures', () => {
  test('emits a deterministic JSON report with evidence for every assertion', () => {
    const report = evaluateAgentFixture(fixture, passingObservation())

    expect(report.status).toBe('passed')
    expect(report.passed_count).toBe(AGENT_EVAL_ASSERTION_IDS.length)
    expect(report.failed_count).toBe(0)
    expect(report.assertions.map((assertion) => assertion.id)).toEqual(
      [...AGENT_EVAL_ASSERTION_IDS]
    )
    expect(report.assertions.every((assertion) =>
      assertion.status === 'passed' && Object.keys(assertion.evidence).length > 0
    )).toBe(true)
    expect(serializeAgentEvalReport(report)).toBe(
      serializeAgentEvalReport(evaluateAgentFixture(fixture, passingObservation()))
    )
  })

  test('reports bounded failures per assertion instead of collapsing to a score', () => {
    const report = evaluateAgentFixture(fixture, {
      ...passingObservation(),
      calls: [
        ...passingObservation().calls,
        {
          viewer_instance_id: 'viewer-3',
          role: 'director',
          eligible: true,
          model_id: 'director-model'
        }
      ],
      outputs: [
        ...passingObservation().outputs,
        {
          action: 'invalid',
          text: null,
          repair_attempts: 2,
          viewer_instance_id: 'viewer-1',
          epoch: 1,
          sequence: 3
        }
      ]
    })

    expect(report.status).toBe('failed')
    expect(report.failed_count).toBe(4)
    expect(report.assertions.find((assertion) => assertion.id === 'no_director_or_global_theme')?.status)
      .toBe('failed')
    expect(report.assertions.find((assertion) => assertion.id === 'barrage_silence_parse')?.status)
      .toBe('failed')
    expect(report.assertions.find((assertion) => assertion.id === 'barrage_bounds')?.status)
      .toBe('failed')
    expect(report.assertions.find((assertion) => assertion.id === 'eligible_viewers_only')?.status)
      .toBe('failed')
  })

  test('rejects malformed or live-provider fixtures before evaluation', () => {
    expect(() => parseAgentEvalFixture({ ...fixtureJson, provider_evidence_class: 'live' }))
      .toThrow(AgentEvalFixtureError)
    expect(() => parseAgentEvalFixture({ ...fixtureJson, assertions: ['eligible_viewers_only', 'eligible_viewers_only'] }))
      .toThrow('assertions must be unique')
  })
})

function passingObservation(): AgentEvalObservation {
  return {
    calls: [
      {
        viewer_instance_id: 'viewer-1',
        role: 'viewer',
        eligible: true,
        model_id: 'viewer-model'
      },
      {
        viewer_instance_id: 'viewer-2',
        role: 'viewer',
        eligible: true,
        model_id: 'viewer-model'
      }
    ],
    outputs: [
      {
        action: 'barrage',
        text: 'hello from viewer one',
        repair_attempts: 0,
        viewer_instance_id: 'viewer-1',
        epoch: 1,
        sequence: 1
      },
      {
        action: 'silence',
        text: null,
        repair_attempts: 1,
        viewer_instance_id: 'viewer-2',
        epoch: 1,
        sequence: 2
      }
    ],
    reply_context: {
      event_ids: ['event-1', 'event-2'],
      same_wave_frozen: true
    },
    stale_results: [
      { epoch: 0, sequence: 9, emitted: false },
      { epoch: 1, sequence: 0, emitted: false }
    ],
    cancellation: {
      cancelled: true,
      late_memory_writes: 0
    },
    failure: {
      degraded: true,
      invented_output: false
    }
  }
}
