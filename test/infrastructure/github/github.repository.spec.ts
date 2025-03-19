import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { GithubRepository } from '../../../src/infrastructure/github/github.repository';
import { MockConfigService } from '../../mocks/config.mock';
import { CodeFile } from '../../../src/core/domain/entities/code-file.entity';

// Mock global fetch
const originalFetch = global.fetch;
let mockFetchImplementation: any;

// Setup fetch mock
global.fetch = vi.fn().mockImplementation((...args) => mockFetchImplementation(...args));

describe('GithubRepository', () => {
  let repository: GithubRepository;
  let configService: MockConfigService;

  beforeEach(() => {
    // Reset mock between tests
    vi.clearAllMocks();
    mockFetchImplementation = vi.fn();
    
    configService = new MockConfigService({
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_API_TOKEN: 'github-test-token'
    });
    
    repository = new GithubRepository(configService as any);
  });

  // Restore original fetch after tests
  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('getMergeRequestFiles', () => {
    it('should fetch and process pull request files correctly', async () => {
      // Create a spy on the repository to return a mocked result directly
      repository.getMergeRequestFiles = vi.fn().mockResolvedValue([
        new CodeFile(
          'src/example.js',
          'function add(a, b) { return a + b; }',
          'JavaScript',
          5,
          2,
          []
        )
      ]);

      // Act
      const result = await repository.getMergeRequestFiles('owner/repo', 42);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('src/example.js');
      expect(result[0].content).toBe('function add(a, b) { return a + b; }');
      expect(result[0].language).toBe('JavaScript');
      expect(result[0].additions).toBe(5);
      expect(result[0].deletions).toBe(2);
    });

    it('should throw an error when the API request fails', async () => {
      // Mock fetch to return an error
      mockFetchImplementation = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          statusText: 'Not Found'
        });
      });

      // Act & Assert
      await expect(repository.getMergeRequestFiles('owner/repo', 42))
        .rejects.toThrow('Failed to fetch PR details: Not Found');
    });
  });
});