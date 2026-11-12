cask "mare" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "https://github.com/heisdeku/mare/releases/download/v#{version}/mare-#{version}-macos-universal.zip"
  name "marè"
  desc "See what is using your ports and disk, and clear space safely"
  homepage "https://github.com/heisdeku/mare"

  depends_on :macos

  app "marè.app"

  # The app isn't notarised, so macOS would refuse to open it on first launch.
  postflight_steps do
    run "/usr/bin/xattr",
        args:         ["-dr", "com.apple.quarantine", "{{appdir}}/marè.app"],
        must_succeed: false
  end

  zap trash: [
    "~/Library/Caches/dev.oluwaferanmi.mare",
    "~/Library/Saved Application State/dev.oluwaferanmi.mare.savedState",
    "~/Library/WebKit/dev.oluwaferanmi.mare",
  ]
end
