import PQueue from 'p-queue'

import {
  ModelRequestScheduler,
  type ModelRequestSchedulerDependencies,
  type ModelSchedulerQueue,
  type ModelSchedulerQueueFactory,
  type ModelSchedulingPolicyInput
} from '../../application'

export type PQueueModelRequestSchedulerDependencies = Omit<
  ModelRequestSchedulerDependencies,
  'createQueue'
>

export const createPQueueModelSchedulerQueue: ModelSchedulerQueueFactory = (
  options
) => {
  const queue = new PQueue({ concurrency: options.concurrency })
  return {
    get size() {
      return queue.size
    },
    get pending() {
      return queue.pending
    },
    add<TValue>(
      task: () => Promise<TValue>,
      taskOptions: Parameters<ModelSchedulerQueue['add']>[1]
    ) {
      return queue.add(task, taskOptions)
    }
  }
}

export function createModelRequestScheduler(
  policy: ModelSchedulingPolicyInput = {},
  dependencies: PQueueModelRequestSchedulerDependencies = {}
): ModelRequestScheduler {
  return new ModelRequestScheduler(policy, {
    ...dependencies,
    createQueue: createPQueueModelSchedulerQueue
  })
}
