cask "system-manager" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "https://github.com/heisdeku/constellation/releases/download/v#{version}/System-Manager-#{version}-macos-universal.zip"
  name "System Manager"
  desc "See what is using your ports and disk, and clear space safely"
  homepage "https://github.com/heisdeku/constellation"

  depends_on :macos

  app "System Manager.app"

  # The app isn't notarised, so macOS would refuse to open it on first launch.
  postflight_steps do
    run "/usr/bin/xattr",
        args:         ["-dr", "com.apple.quarantine", "{{appdir}}/System Manager.app"],
        must_succeed: false
  end

  zap trash: [
    "~/Library/Caches/dev.oluwaferanmi.port-tracker",
    "~/Library/Saved Application State/dev.oluwaferanmi.port-tracker.savedState",
    "~/Library/WebKit/dev.oluwaferanmi.port-tracker",
  ]
end
