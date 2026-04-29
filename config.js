module.exports = {
  org: "celestiaorg",

  repos: [
    "blobstream-contracts",
    "celestia-app",
    "celestia-core",
    "celestia-node",
    "cosmos-sdk",
    "da-proxy",
    "go-fraud",
    "go-header",
    "go-libp2p-messenger",
    "go-square",
    "lumina",
    "nmt",
    "rsmt2d",
  ],

  teamMembers: [
    { name: "Rootul", github: "rootulp", defaultHidden: false },
    { name: "Nina", github: "ninabarbakadze", defaultHidden: false },
    { name: "Rachid", github: "rach-id", defaultHidden: false },
    { name: "Mikhail", github: "mcrakhman", defaultHidden: false },
    { name: "Slava", github: "vgonkivs", defaultHidden: false },
    { name: "Evan", github: "evan-forbes", defaultHidden: false },
    { name: "Vlad", github: "walldiss", defaultHidden: true },
    { name: "Hlib", github: "Wondertan", defaultHidden: true },
  ],

  thresholds: {
    greenMaxHours: 12,
    yellowMaxHours: 24,
  },
};
