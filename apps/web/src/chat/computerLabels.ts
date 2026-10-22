import type { ComputerSessionSummary } from '@ramu/shared/api'
import { computerControllerLabel } from '@ramu/shared/computerControl'

export const controllerLabel = (session: ComputerSessionSummary): string => computerControllerLabel(session)
