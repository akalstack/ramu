Pod::Spec.new do |s|
  s.name           = 'RamuDiscovery'
  s.version        = '1.0.0'
  s.summary        = 'Browses Bonjour for nearby Ramu hosts'
  s.description    = 'Lists Ramu hosts advertising on the local network. It never pairs or connects.'
  s.author         = 'Ramu'
  s.homepage       = 'https://github.com/ahxar/ramu'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
end
