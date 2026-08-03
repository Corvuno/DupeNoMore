module.exports = {
  "testEnvironment": "node",
  "testMatch": [
    "<rootDir>/tests/unit/**/*.test.js",
    "<rootDir>/tests/e2e/**/*.test.js",
    "<rootDir>/tests/integration/**/*.test.js"
  ],
  "collectCoverageFrom": [
    "src/**/*.js",
    "!src/server.js"
  ]
};
