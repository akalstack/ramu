const { withGradleProperties } = require('expo/config-plugins')

// The development client's dex merge runs out of memory under the template's 2 GB Gradle heap
// (D8 OutOfMemoryError in mergeExtDexDebug); a larger heap lets it finish.
const jvmargs = '-Xmx6g -XX:MaxMetaspaceSize=1g'
module.exports = (config) =>
  withGradleProperties(config, (config) => {
    const existing = config.modResults.find((item) => item.type === 'property' && item.key === 'org.gradle.jvmargs')
    if (existing) existing.value = jvmargs
    else config.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: jvmargs })
    return config
  })
