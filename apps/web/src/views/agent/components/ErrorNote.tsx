import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

/** An error the agent or a tool reported, in the transcript. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="destructive" className="border-transparent bg-(--bad-wash) text-chat">
      <CircleAlert aria-hidden="true" />
      <AlertDescription className="text-destructive/90 break-words">{children}</AlertDescription>
    </Alert>
  )
}
