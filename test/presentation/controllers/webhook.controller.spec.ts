import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhookController } from '../../../src/presentation/controllers/webhook.controller';
import { AnalyzeMergeRequestUseCase } from '../../../src/core/usecases/analyze-merge-request.usecase';
import { MockConfigService } from '../../mocks/config.mock';
import { HttpException } from '@nestjs/common';

describe('WebhookController', () => {
  let controller: WebhookController;
  let analyzeMRUseCase: {
    execute: vi.Mock;
  };
  let configService: MockConfigService;

  beforeEach(() => {
    // Create mock use cases and services
    analyzeMRUseCase = {
      execute: vi.fn().mockResolvedValue({})
    };
    
    configService = new MockConfigService({
      GITLAB_WEBHOOK_TOKEN: 'gitlab-webhook-secret'
    });
    
    controller = new WebhookController(
      analyzeMRUseCase as unknown as AnalyzeMergeRequestUseCase,
      configService as any
    );
  });

  describe('handleGitlabWebhook', () => {
    it('should verify webhook token and reject unauthorized requests', async () => {
      // Arrange
      const token = 'wrong-token';
      const webhookData = {};

      // Act & Assert
      await expect(controller.handleGitlabWebhook(token, webhookData))
        .rejects.toThrow(HttpException);
    });

    it('should process merge request open events', async () => {
      // Arrange
      const token = 'gitlab-webhook-secret';
      const webhookData = {
        object_kind: 'merge_request',
        object_attributes: {
          action: 'open',
          iid: 123
        },
        project: {
          id: 456
        }
      };

      // Act
      const result = await controller.handleGitlabWebhook(token, webhookData);

      // Assert
      expect(result).toEqual({ message: 'Review process started' });
      expect(analyzeMRUseCase.execute).toHaveBeenCalledWith(
        '456',
        123,
        'system'
      );
    });

    it('should ignore non-merge request events', async () => {
      // Arrange
      const token = 'gitlab-webhook-secret';
      const webhookData = {
        object_kind: 'push'
      };

      // Act
      const result = await controller.handleGitlabWebhook(token, webhookData);

      // Assert
      expect(result).toEqual({ message: 'Event ignored' });
      expect(analyzeMRUseCase.execute).not.toHaveBeenCalled();
    });
  });

  describe('handleGithubWebhook', () => {
    it('should process pull request opened events', async () => {
      // Arrange
      const signature = 'sha256=some-signature';
      const webhookData = {
        action: 'opened',
        pull_request: {
          number: 123
        },
        repository: {
          full_name: 'owner/repo'
        }
      };

      // Act
      const result = await controller.handleGithubWebhook(signature, webhookData);

      // Assert
      expect(result).toEqual({ message: 'Review process started for GitHub PR' });
      expect(analyzeMRUseCase.execute).toHaveBeenCalledWith(
        'owner/repo',
        123,
        'system'
      );
    });

    it('should process pull request synchronize events', async () => {
      // Arrange
      const signature = 'sha256=some-signature';
      const webhookData = {
        action: 'synchronize',
        pull_request: {
          number: 123
        },
        repository: {
          full_name: 'owner/repo'
        }
      };

      // Act
      const result = await controller.handleGithubWebhook(signature, webhookData);

      // Assert
      expect(result).toEqual({ message: 'Review process started for GitHub PR' });
      expect(analyzeMRUseCase.execute).toHaveBeenCalledWith(
        'owner/repo',
        123,
        'system'
      );
    });

    it('should ignore non-PR events', async () => {
      // Arrange
      const signature = 'sha256=some-signature';
      const webhookData = {
        action: 'closed',
        pull_request: {
          number: 123
        }
      };

      // Act
      const result = await controller.handleGithubWebhook(signature, webhookData);

      // Assert
      expect(result).toEqual({ message: 'Event ignored' });
      expect(analyzeMRUseCase.execute).not.toHaveBeenCalled();
    });
  });
});