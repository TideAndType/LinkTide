const hasAppleIdNotarization =
  Boolean(process.env.APPLE_ID) &&
  Boolean(process.env.APPLE_APP_SPECIFIC_PASSWORD) &&
  Boolean(process.env.APPLE_TEAM_ID);

module.exports = {
  appId: "com.tideandtype.linktide",
  productName: "LinkTide",
  copyright: "Copyright © 2026 Tide & Type Co.",
  directories: {
    output: "release"
  },
  files: [
    "dist/desktop/**/*",
    "package.json"
  ],
  extraResources: [
    {
      from: "apps/dashboard/out",
      to: "dashboard"
    }
  ],
  asar: true,
  asarUnpack: [
    "node_modules/playwright/**/*",
    "node_modules/playwright-core/**/*"
  ],
  mac: {
    category: "public.app-category.productivity",
    target: ["dmg", "zip"],
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    notarize: hasAppleIdNotarization,
    minimumSystemVersion: "12.0"
  },
  dmg: {
    title: "LinkTide ${version}"
  },
  artifactName: "LinkTide-${version}-mac-${arch}.${ext}",
  publish: [
    {
      provider: "github",
      owner: "TideAndType",
      repo: "LinkTide"
    }
  ]
};
