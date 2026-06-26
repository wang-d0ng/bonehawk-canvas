const developerIdMode = process.env.BONEHAWK_MAC_SIGN_MODE === "developer-id";

module.exports = {
  appId: "com.bonehawk.canvas",
  productName: "Bonehawk Canvas",
  asar: true,
  directories: {
    output: "release"
  },
  files: [
    "desktop/**/*",
    "dist/src/**/*",
    "extension/**/*",
    "public/**/*",
    "package.json"
  ],
  mac: {
    category: "public.app-category.education",
    identity: developerIdMode ? undefined : "-",
    hardenedRuntime: developerIdMode,
    gatekeeperAssess: developerIdMode,
    notarize: developerIdMode,
    target: [
      {
        target: "dmg",
        arch: ["arm64"]
      },
      {
        target: "zip",
        arch: ["arm64"]
      }
    ]
  }
};
