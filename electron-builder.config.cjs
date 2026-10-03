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
    target: ["dmg"],
    identity: "-",
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    minimumSystemVersion: "12.0"
  },
  dmg: {
    title: "LinkTide ${version}"
  },
  artifactName: "LinkTide-${version}-mac-${arch}.${ext}"
};
