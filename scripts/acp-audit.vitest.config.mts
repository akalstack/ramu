import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['scripts/acp-native-aside.live.test.ts'], testTimeout: 90000 } })
