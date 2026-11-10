import * as Path from 'path'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { ISubmoduleDiff } from '../../models/diff'
import {
  AgentLaunchTarget,
  buildSubmoduleReviewPrompt,
  claudeCommand,
} from '../../lib/agent-review'

/**
 * Open a claude session in the submodule, pointed at the commits between the
 * diff's old and new SHA. Shared by the Changes and History views.
 */
export function launchSubmoduleReview(
  dispatcher: Dispatcher,
  repository: Repository,
  diff: ISubmoduleDiff,
  commitCount: number,
  ask: string,
  target: AgentLaunchTarget
): void {
  if (diff.oldSHA === null || diff.newSHA === null) {
    return
  }

  const prompt = buildSubmoduleReviewPrompt({
    submodulePath: diff.path,
    parentName: repository.name,
    oldSHA: diff.oldSHA,
    newSHA: diff.newSHA,
    commitCount,
    ask,
  })

  const command = claudeCommand(prompt)
  if (command === null) {
    return
  }

  dispatcher.launchAgentSession(repository, {
    cwd: diff.fullPath,
    command,
    label: `review ✦ ${Path.basename(diff.path)}`,
    target,
  })
}
