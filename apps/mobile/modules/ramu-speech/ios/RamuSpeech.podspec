Pod::Spec.new do |s|
  s.name           = 'RamuSpeech'
  s.version        = '1.0.0'
  s.summary        = 'On-device dictation for Ramu'
  s.description    = 'Records the microphone while the person dictates and recognizes speech on this device only.'
  s.author         = 'Ramu'
  s.homepage       = 'https://github.com/akalstack/ramu'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
end
