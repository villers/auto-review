import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaudeAIService } from '../../../src/infrastructure/ai/claude-ai.service';
import { MockConfigService } from '../../mocks/config.mock';
import { CodeFile } from '../../../src/core/domain/entities/code-file.entity';
import { CommentCategory, CommentSeverity } from '../../../src/core/domain/entities/review.entity';

// Mock global fetch
const originalFetch = global.fetch;
let mockFetchImplementation: any;

// Setup fetch mock
global.fetch = vi.fn().mockImplementation((...args) => mockFetchImplementation(...args));

describe('ClaudeAIService', () => {
  let service: ClaudeAIService;
  let configService: MockConfigService;

  beforeEach(() => {
    // Reset mock between tests
    vi.clearAllMocks();
    mockFetchImplementation = vi.fn();
    
    configService = new MockConfigService({
      CLAUDE_API_KEY: 'test-claude-api-key'
    });
    
    service = new ClaudeAIService(configService as any);
  });

  // Restore original fetch after tests
  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('analyzeCode', () => {
    it('should analyze code files and return properly parsed results', async () => {
      // Arrange
      const files = [
        new CodeFile(
          'src/example.js',
          'function add(a, b) { return a + b; }',
          'JavaScript',
          1,
          0,
          []
        )
      ];
      
      // Mock Claude API response
      mockFetchImplementation = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            content: [
              {
                text: '```json\n{\n  "comments": [\n    {\n      "filePath": "src/example.js",\n      "lineNumber": 1,\n      "content": "Consider adding JSDoc comments to describe parameters",\n      "category": "BEST_PRACTICE",\n      "severity": "INFO"\n    }\n  ],\n  "summary": "The code is clean and functional but lacks documentation."\n}\n```'
              }
            ]
          })
        });
      });

      // Act
      const result = await service.analyzeCode(files);

      // Assert
      expect(result).toBeDefined();
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].filePath).toBe('src/example.js');
      expect(result.comments[0].lineNumber).toBe(1);
      expect(result.comments[0].category).toBe(CommentCategory.BEST_PRACTICE);
      expect(result.comments[0].severity).toBe(CommentSeverity.INFO);
      expect(result.summary).toBe('The code is clean and functional but lacks documentation.');
      
      // Verify Claude API was called with correct parameters
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetch.mock.calls[0][1].body).messages[0].content).toContain('performing a thorough code review');
    });

    it('should handle error responses from Claude API', async () => {
      // Arrange
      const files = [
        new CodeFile(
          'src/example.js',
          'function add(a, b) { return a + b; }',
          'JavaScript',
          1,
          0,
          []
        )
      ];
      
      // Mock Claude API error response
      mockFetchImplementation = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: 'API Error' } })
        });
      });

      // Act & Assert
      await expect(service.analyzeCode(files))
        .rejects.toThrow('Failed to call Claude API: Claude API Error: {"error":{"message":"API Error"}}');
    });

    it('should handle invalid JSON responses from Claude', async () => {
      // Arrange
      const files = [
        new CodeFile(
          'src/example.js',
          'function add(a, b) { return a + b; }',
          'JavaScript',
          1,
          0,
          []
        )
      ];
      
      // Mock Claude API with invalid JSON response
      mockFetchImplementation = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            content: [
              {
                text: 'This is not valid JSON'
              }
            ]
          })
        });
      });

      // Act & Assert
      await expect(service.analyzeCode(files))
        .rejects.toThrow('Error parsing AI response');

    });
  });
});