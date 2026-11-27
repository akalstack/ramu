Pod::Spec.new do |s|
  s.name           = 'RamuPaste'
  s.version        = '1.0.0'
  s.summary        = 'Hands a pasted picture or file in a text field to the message box'
  s.description    = 'Lets the system Paste in a React Native text field take a copied picture or file and pass it to JS.'
  s.author         = 'Ramu'
  s.homepage       = 'https://github.com/akalstack/ramu'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
end
