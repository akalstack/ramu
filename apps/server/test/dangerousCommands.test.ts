import { homedir } from 'node:os'
import { expect, it } from 'vitest'
import { dangerousCommand } from '../src/agent/dangerousCommands'

const scope = { cwd: '/work/app', additionalDirs: ['/work/shared'] }
const check = (command: string) => dangerousCommand(command, scope)

it('lets routine work inside the thread’s folders run', () => {
  for (const command of [
    'rm -rf node_modules dist',
    'rm -rf /work/app/build',
    'rm ./src/old.ts && pnpm test',
    'rm -rf /work/shared/cache',
    'rm -rf /tmp/ramu-test',
    'find . -name "*.log" -delete',
    'git reset --soft HEAD~1',
    'git checkout -- src/a.ts',
    'git restore --staged .',
    'git clean -n',
    'git push origin main',
    'chmod +x scripts/run.sh',
    'echo done > out.txt',
    'pnpm build 2>&1 | tail -5',
  ])
    expect(check(command), command).toBeNull()
})

it('asks before deleting outside the thread’s folders, a whole project, the repository or unknown paths', () => {
  expect(check('rm -rf ~')).toMatch(/outside/)
  expect(check(`rm -rf ${homedir()}/Documents`)).toMatch(/outside/)
  expect(check('rm -rf /')).toMatch(/outside/)
  expect(check('rm ../other/notes.md')).toMatch(/outside/)
  expect(check('rm -rf .')).toMatch(/whole project/)
  expect(check('rm -rf *')).toMatch(/whole project/)
  expect(check('rm -rf /work/app')).toMatch(/whole project/)
  expect(check('rm -rf .git')).toMatch(/repository itself/)
  expect(check('rm -rf "$BUILD_DIR"/')).toMatch(/cannot check/)
  expect(check('find ~ -name "*.tmp" -delete')).toMatch(/outside/)
  expect(check('ls | xargs rm -rf')).toMatch(/run time/)
  expect(check('chmod -R 777 /usr/local')).toMatch(/permissions/)
})

it('looks through shells, wrappers, substitutions and chains', () => {
  expect(check(`bash -c 'rm -rf ~/projects'`)).toMatch(/outside/)
  expect(check('cd src && FOO=1 env rm -rf /etc')).toMatch(/outside/)
  expect(check('echo $(rm -rf ~)')).toMatch(/outside/)
  expect(check('timeout 30 sudo make install')).toMatch(/administrator/)
})

it('asks before losing Git work, rewriting remote history, touching disks or the machine', () => {
  expect(check('git reset --hard origin/main')).toMatch(/uncommitted/)
  expect(check('git clean -fdx')).toMatch(/untracked/)
  expect(check('git push --force origin main')).toMatch(/remote/)
  expect(check('git push -f')).toMatch(/remote/)
  expect(check('git push origin +main')).toMatch(/remote/)
  expect(check('git push origin --delete feature')).toMatch(/remote/)
  expect(check('git -C ../repo filter-branch --tree-filter x')).toMatch(/history/)
  expect(check('git checkout .')).toMatch(/uncommitted/)
  expect(check('git stash clear')).toMatch(/stash/)
  expect(check('sudo rm /etc/hosts')).toMatch(/administrator/)
  expect(check('diskutil eraseDisk APFS X disk4')).toMatch(/disk/)
  expect(check('dd if=image.iso of=/dev/disk4')).toMatch(/disk/)
  expect(check('cat image > /dev/disk4')).toMatch(/disk/)
  expect(check('mkfs.ext4 /dev/sdb1')).toMatch(/disk/)
  expect(check('sudo shutdown -h now')).toMatch(/administrator/)
  expect(check('reboot')).toMatch(/restarts/)
})

it('stops pull request writes from a CLI, naming the tool that posts them through a card', () => {
  expect(check('gh pr merge 12 --squash')).toMatch(/pull_request_merge/)
  expect(check('gh pr comment 12 --body "done"')).toMatch(/pull_request_comment/)
  expect(check('glab mr approve 3')).toMatch(/pull_request_review/)
  for (const command of ['gh pr view 12', 'gh pr checks', 'gh pr diff 12', 'glab mr view 3', 'gh issue comment 4'])
    expect(check(command), command).toBeNull()
})
