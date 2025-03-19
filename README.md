# GitLab Review

An AI-powered code review system for GitLab repositories that uses Claude AI to provide detailed feedback on merge requests.

## Features

- Automatically analyze merge requests when they are opened or updated
- Identify potential issues in code: bugs, security vulnerabilities, performance issues, and more
- Suggest improvements and best practices
- Post comments directly on the merge request
- Provide a summary of the overall code quality

## Architecture

This project follows clean architecture principles to ensure maintainability and flexibility:

- **Core**: Domain entities, use cases, and repository interfaces
- **Infrastructure**: External implementations (GitLab API, Claude AI, persistence)
- **Presentation**: Controllers, DTOs, and API responses

The system is designed to be easily extended to support GitHub in the future.

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- A GitLab account with API access
- A Claude API key

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/gitlab-review.git
cd gitlab-review
```

2. Install dependencies
```bash
npm install
```

3. Copy the example environment file and update with your credentials
```bash
cp .env.example .env
```

4. Edit the `.env` file with your GitLab and Claude API credentials

### Running the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## Setting Up GitLab Webhooks

To automatically trigger reviews on new merge requests:

1. Go to your GitLab project settings
2. Navigate to Webhooks
3. Add a new webhook with the URL `http://your-server/webhook/gitlab`
4. Select the "Merge Request events" trigger
5. Add the secret token from your `GITLAB_WEBHOOK_TOKEN` environment variable
6. Save the webhook

## Configuration

| Environment Variable | Description |
|----------------------|-------------|
| PORT | Server port (default: 3000) |
| CLAUDE_API_KEY | Your Claude AI API key |
| GITLAB_API_URL | GitLab API URL (default: https://gitlab.com/api/v4) |
| GITLAB_API_TOKEN | Your GitLab personal access token |
| GITLAB_WEBHOOK_TOKEN | Secret token for GitLab webhooks |

## Future Enhancements

- GitHub integration
- Database persistence (PostgreSQL/MongoDB)
- Custom review rules
- User authentication and authorization
- Review history and analytics
- Support for multiple AI providers

## License

[MIT](LICENSE)