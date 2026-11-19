import { useEffect, useState } from 'react'
import { Alert, TextInput, View } from 'react-native'
import { GitBranch, GitBranchPlus, GitMerge, Pencil, Trash2 } from 'lucide-react-native'
import { useSay } from '../i18n'
import { font, space, useTheme } from '../theme'
import {
  branchActionBlock,
  branchOptionBlock,
  deletableBranches,
  type BranchAction,
  type BranchContext,
} from '../runtime/branchActions'
import { SheetGroup, SheetOption, useSheetInputStyle } from './SheetOptions'
import { Button, Sheet, T, type Icon } from './ui'

export type BranchSheet = BranchAction['kind']

/** Lets the sheet it was picked from finish closing first, as every sheet-to-sheet step on the phone does. */
const AFTER_SHEET_MS = 300

const OPTIONS: { kind: BranchSheet; icon: Icon; title: string; help: string; danger?: boolean }[] = [
  {
    kind: 'merge',
    icon: GitMerge,
    title: 'Merge a branch…',
    help: 'Bring another branch’s commits into {branch}.',
  },
  {
    kind: 'create-from',
    icon: GitBranchPlus,
    title: 'Create branch from…',
    help: 'Start a new branch from another branch and switch to it.',
  },
  { kind: 'rename', icon: Pencil, title: 'Rename branch…', help: 'Rename {branch} on this computer.' },
  {
    kind: 'delete',
    icon: Trash2,
    title: 'Delete branch…',
    help: 'Remove a branch you no longer need.',
    danger: true,
  },
]

/** The branch sheet's Merge, Create from, Rename and Delete entries; one that cannot run now says why. */
export function BranchActionOptions({
  context,
  busy,
  onPick,
}: {
  context: BranchContext
  busy: boolean
  onPick: (sheet: BranchSheet) => void
}) {
  const say = useSay()
  const branch = context.status.branch ?? ''
  return (
    <SheetGroup title={say('Branch actions')}>
      {OPTIONS.map((option) => {
        const off = branchOptionBlock(option.kind, context)
        return (
          <SheetOption
            key={option.kind}
            icon={option.icon}
            title={say(option.title)}
            help={say(off ?? option.help, { branch })}
            danger={option.danger}
            disabled={busy || !!off}
            onPress={() => onPick(option.kind)}
          />
        )
      })}
    </SheetGroup>
  )
}

/**
 * The sheets behind the branch actions: a branch to merge, start from or delete, and a name for a new or renamed branch.
 * Merging and deleting ask first. A view-only device sees every entry unavailable, and the host still checks each call.
 */
export function BranchActionSheets({
  sheet,
  context,
  busy,
  onClose,
  onRun,
}: {
  sheet: BranchSheet | null
  context: BranchContext
  busy: boolean
  onClose: () => void
  onRun: (action: BranchAction) => void
}) {
  const say = useSay()
  const { c } = useTheme()
  const inputStyle = useSheetInputStyle()
  const current = context.status.branch ?? ''
  const [from, setFrom] = useState<string | null>(null)
  const [name, setName] = useState('')
  useEffect(() => {
    setFrom(null)
    setName(sheet === 'rename' ? current : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a sheet starts from the branch checked out when it opens
  }, [sheet])
  const confirmThenRun = (action: BranchAction, title: string, message: string, label: string) => {
    onClose()
    setTimeout(
      () =>
        Alert.alert(title, message, [
          { text: say('Cancel'), style: 'cancel' },
          {
            text: label,
            style: action.kind === 'delete' ? 'destructive' : 'default',
            onPress: () => onRun(action),
          },
        ]),
      AFTER_SHEET_MS,
    )
  }
  const named: BranchAction | null =
    sheet === 'rename'
      ? { kind: 'rename', name: name.trim() }
      : sheet === 'create-from' && from
        ? { kind: 'create-from', name: name.trim(), from }
        : null
  const blocked = named ? branchActionBlock(named, context) : null
  const submit = () => {
    if (!named || blocked || busy) return
    onClose()
    onRun(named)
  }
  const others = context.branches.filter((branch) => branch.name !== current)
  const deletable = deletableBranches(context)
  return (
    <>
      <Sheet open={sheet === 'merge'} onClose={onClose} title={say('Merge into {branch}', { branch: current })}>
        <SheetGroup
          footer={say(
            'The branch you pick is merged into {branch}. If files conflict, the merge stops so you can choose a side for each.',
            { branch: current },
          )}
        >
          {others.map((branch) => {
            const action: BranchAction = { kind: 'merge', name: branch.name }
            const off = branchActionBlock(action, context)
            return (
              <SheetOption
                key={branch.name}
                icon={GitBranch}
                title={branch.name}
                help={off ? say(off) : undefined}
                disabled={busy || !!off}
                onPress={() =>
                  confirmThenRun(
                    action,
                    say('Merge {name} into {branch}?', { name: branch.name, branch: current }),
                    say('Its commits are added to {branch} on this computer. Nothing is pushed.', { branch: current }),
                    say('Merge'),
                  )
                }
              />
            )
          })}
        </SheetGroup>
      </Sheet>

      <Sheet open={sheet === 'delete'} onClose={onClose} title={say('Delete branch')}>
        <SheetGroup
          footer={say(
            'The branch checked out here is not listed. Git keeps a branch that is not merged yet, and the branch on the remote stays.',
          )}
        >
          {deletable.map((branch) => (
            <SheetOption
              key={branch.name}
              icon={Trash2}
              title={branch.name}
              danger
              disabled={busy}
              onPress={() =>
                confirmThenRun(
                  { kind: 'delete', name: branch.name },
                  say('Delete {name}?', { name: branch.name }),
                  say('The branch is removed from this computer. Git refuses if it is not merged yet.'),
                  say('Delete'),
                )
              }
            />
          ))}
        </SheetGroup>
      </Sheet>

      {/* One sheet for both steps of Create branch from, so the form replaces the list instead of a second sheet. */}
      <Sheet
        open={sheet === 'rename' || sheet === 'create-from'}
        onClose={onClose}
        title={
          sheet === 'rename'
            ? say('Rename branch')
            : from
              ? say('Create branch from {0}', { 0: from })
              : say('Create branch from')
        }
      >
        {sheet === 'create-from' && !from ? (
          <SheetGroup footer={say('The new branch starts at the tip of the branch you pick.')}>
            {context.branches.map((branch) => (
              <SheetOption
                key={branch.name}
                icon={GitBranch}
                title={branch.name}
                selected={branch.name === current}
                disabled={busy}
                onPress={() => setFrom(branch.name)}
              />
            ))}
          </SheetGroup>
        ) : (
          <View style={{ paddingHorizontal: space.l, gap: space.m }}>
            <T tone="muted">
              {sheet === 'rename'
                ? say('Renames {branch} on this computer. Its branch on the remote keeps its name.', {
                    branch: current,
                  })
                : say('The new branch starts from {branch} and is checked out right away.', { branch: from ?? '' })}
            </T>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              selectTextOnFocus
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={200}
              placeholder="feature/name"
              placeholderTextColor={c.placeholder}
              accessibilityLabel={say('Branch name')}
              returnKeyType="done"
              onSubmitEditing={submit}
              style={inputStyle}
            />
            {name.trim() && blocked && !(sheet === 'rename' && name.trim() === current) ? (
              <T size={font.caption} tone="bad">
                {say(blocked)}
              </T>
            ) : null}
            <Button
              title={sheet === 'rename' ? say('Rename') : say('Create and switch')}
              disabled={busy || !!blocked}
              onPress={submit}
            />
          </View>
        )}
      </Sheet>
    </>
  )
}
