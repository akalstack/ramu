import { contentStorage } from '../storage'
import { keptPullRequests } from './keptPullRequests'

/** This phone's kept copy of what the pull request screens last read, in its bounded content cache. */
export const pullRequestCopy = keptPullRequests(contentStorage)
