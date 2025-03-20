# GitLab/GitHub Review

An AI-powered code review system for GitLab and GitHub repositories that uses Claude AI to provide detailed feedback on merge/pull requests.

## Features

- Automatically analyze merge/pull requests when they are opened or updated
- Support for both GitLab and GitHub repositories
- Identify potential issues in code: bugs, security vulnerabilities, performance issues, and more
- Suggest improvements and best practices
- Post comments directly on the merge/pull request
- Provide a summary of the overall code quality

## Architecture

This project follows clean architecture principles to ensure maintainability and flexibility:

- **Core**: Domain entities, use cases, and repository interfaces
- **Infrastructure**: External implementations (GitLab API, GitHub API, Claude AI, persistence)
- **Presentation**: Controllers, DTOs, and API responses

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- A GitLab and/or GitHub account with API access
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

4. Edit the `.env` file with your GitLab/GitHub and Claude API credentials

### Running the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## Setting Up Webhooks

### GitLab

To automatically trigger reviews on new merge requests:

1. Go to your GitLab project settings
2. Navigate to Webhooks
3. Add a new webhook with the URL `http://your-server/webhook/gitlab`
4. Select the "Merge Request events" trigger
5. Add the secret token from your `GITLAB_WEBHOOK_TOKEN` environment variable
6. Save the webhook

### GitHub

To automatically trigger reviews on new pull requests:

1. Go to your GitHub repository settings
2. Navigate to Webhooks
3. Add a new webhook with the URL `http://your-server/webhook/github`
4. Select the "Pull request" event
5. Add the secret from your `GITHUB_WEBHOOK_SECRET` environment variable
6. Save the webhook

## Configuration

| Environment Variable | Description |
|----------------------|-------------|
| PORT | Server port (default: 3000) |
| CLAUDE_API_KEY | Your Claude AI API key |
| GITLAB_API_URL | GitLab API URL (default: https://gitlab.com/api/v4) |
| GITLAB_API_TOKEN | Your GitLab personal access token |
| GITLAB_WEBHOOK_TOKEN | Secret token for GitLab webhooks |
| GITHUB_API_URL | GitHub API URL (default: https://api.github.com) |
| GITHUB_API_TOKEN | Your GitHub personal access token |
| GITHUB_WEBHOOK_SECRET | Secret for GitHub webhooks |

## Future Enhancements

- Database persistence (PostgreSQL/MongoDB)
- Custom review rules
- User authentication and authorization
- Review history and analytics
- Support for multiple AI providers
- Additional version control systems (Bitbucket, Azure DevOps)

## License

[MIT](LICENSE)