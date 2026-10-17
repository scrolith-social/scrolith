module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.scrolitha-mcp.json'
    }]
  },
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  globalTeardown: '<rootDir>/jest.global-teardown.cjs',
  moduleNameMapper: {
    '^vitest$': '<rootDir>/src/__tests__/vitestShim.ts'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: ['**/scrolithaMcp.*.spec.ts']
};
