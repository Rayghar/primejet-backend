// jest.config.js
module.exports = {
  testEnvironment: 'node',
  verbose: true,
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/src/config/', // Often exclude config files from coverage unless they have logic
    '/src/app.js', // App setup might be excluded
    '/src/server.js', // Server bootstrap might be excluded
    '/src/models/', // Models are often simple schemas
    '/src/utils/HttpError.js', // Simple class
  ],
  coverageReporters: ['json', 'lcov', 'text', 'html'], // 'html' is good for local viewing
  setupFilesAfterEnv: ['./tests/setup.js'], // If you have a global test setup file
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
};