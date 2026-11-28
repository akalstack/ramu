'use strict'

// Puts Ramu's mark in the Live Activity's own asset catalog as a template image, so the activity can draw it in the
// system's colors. Listed before expo-widgets: config mods run in reverse order, so that plugin creates (and wipes) the
// widget folder before this one adds the catalog to it.
const fs = require('fs')
const path = require('path')
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins')

const TARGET = 'ExpoWidgetsTarget'
const CATALOG = 'Assets.xcassets'
const IMAGE_SET = 'RamuMark.imageset'
const SVG = 'RamuMark.svg'
const PHASE = 'Compile Widget Assets'
const info = { author: 'expo', version: 1 }

// The widget target does not compile a Resources phase, so the catalog is compiled into the extension by a script.
const COMPILE = [
  'set -e',
  `CATALOG="\${SRCROOT}/${TARGET}/${CATALOG}"`,
  'DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"',
  'mkdir -p "$DEST"',
  'xcrun actool "$CATALOG" --compile "$DEST" --platform "${PLATFORM_NAME}" --minimum-deployment-target "${IPHONEOS_DEPLOYMENT_TARGET:-16.0}" --output-format human-readable-text',
].join('\n')

const withMarkFiles = (config) =>
  withDangerousMod(config, [
    'ios',
    (cfg) => {
      const catalog = path.join(cfg.modRequest.platformProjectRoot, TARGET, CATALOG)
      const set = path.join(catalog, IMAGE_SET)
      fs.mkdirSync(set, { recursive: true })
      fs.writeFileSync(path.join(catalog, 'Contents.json'), JSON.stringify({ info }, null, 2) + '\n')
      fs.writeFileSync(
        path.join(set, 'Contents.json'),
        JSON.stringify(
          {
            images: [{ idiom: 'universal', filename: SVG }],
            info,
            properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
          },
          null,
          2,
        ) + '\n',
      )
      fs.copyFileSync(path.join(cfg.modRequest.projectRoot, 'assets', 'widget', SVG), path.join(set, SVG))
      return cfg
    },
  ])

const withCompilePhase = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults
    const objects = project.hash.project.objects
    const entries = (map) => Object.entries(map ?? {}).filter(([key]) => !key.endsWith('_comment'))
    const target = entries(objects.PBXNativeTarget).find(([, value]) => value?.name === TARGET)
    if (!target) throw new Error(`withWidgetMark: no ${TARGET} target; list this plugin before expo-widgets.`)
    const phases = target[1].buildPhases ?? []
    const present = entries(objects.PBXShellScriptBuildPhase).some(
      ([uuid, value]) => value?.name === `"${PHASE}"` && phases.some((phase) => phase.value === uuid),
    )
    if (!present) {
      const { uuid } = project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE, target[0], {
        shellPath: '/bin/sh',
        shellScript: COMPILE,
      })
      objects.PBXShellScriptBuildPhase[uuid].alwaysOutOfDate = 1
    }
    return cfg
  })

module.exports = (config) => withCompilePhase(withMarkFiles(config))
