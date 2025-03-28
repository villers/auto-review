# GitLab/GitHub Review

Un système de revue de code automatisé pour les dépôts GitLab et GitHub qui utilise Claude AI pour fournir des commentaires détaillés sur les merge/pull requests.

## Fonctionnalités

- Analyse automatique des merge/pull requests lors de leur ouverture ou mise à jour
- Prise en charge des dépôts GitLab et GitHub
- Identification des problèmes potentiels dans le code : bugs, vulnérabilités de sécurité, problèmes de performance, etc.
- Suggestions d'améliorations et de bonnes pratiques
- Publication de commentaires directement sur la merge/pull request
- Résumé global de la qualité du code

## Architecture

Le projet suit une architecture simple et maintenable :

- **Core** : Interfaces, entités et services métier
- **Adapters** : Implémentations des interfaces pour les services externes (GitLab, GitHub, Claude)
- **API** : Contrôleurs et webhooks pour les intégrations

## Pour démarrer

### Prérequis

- Node.js (v18 ou ultérieur)
- Un compte GitLab et/ou GitHub avec accès API
- Une clé API Claude

### Installation

1. Cloner le dépôt
```bash
git clone https://github.com/yourusername/gitlab-review.git
cd gitlab-review
```

2. Installer les dépendances
```bash
npm install
```

3. Copier le fichier d'environnement d'exemple et le mettre à jour avec vos identifiants
```bash
cp .env.example .env
```

4. Éditer le fichier `.env` avec vos identifiants GitLab/GitHub et Claude API

### Exécution de l'application

```bash
# Mode développement
npm run start:dev

# Mode production
npm run build
npm run start:prod
```

## Configuration des Webhooks

### GitLab

Pour déclencher automatiquement des revues sur les nouvelles merge requests :

1. Accédez aux paramètres de votre projet GitLab
2. Naviguez vers Webhooks
3. Ajoutez un nouveau webhook avec l'URL `http://votre-serveur/api/webhook/gitlab`
4. Sélectionnez le déclencheur "Merge Request events"
5. Ajoutez le jeton secret depuis votre variable d'environnement `GITLAB_WEBHOOK_TOKEN`
6. Enregistrez le webhook

### GitHub

Pour déclencher automatiquement des revues sur les nouvelles pull requests :

1. Accédez aux paramètres de votre dépôt GitHub
2. Naviguez vers Webhooks
3. Ajoutez un nouveau webhook avec l'URL `http://votre-serveur/api/webhook/github`
4. Sélectionnez l'événement "Pull request"
5. Ajoutez le secret depuis votre variable d'environnement `GITHUB_WEBHOOK_SECRET`
6. Enregistrez le webhook

## Configuration

| Variable d'environnement | Description |
|----------------------|-------------|
| PORT | Port du serveur (par défaut : 3000) |
| CLAUDE_API_KEY | Votre clé API Claude AI |
| GITLAB_API_URL | URL de l'API GitLab (par défaut : https://gitlab.com/api/v4) |
| GITLAB_API_TOKEN | Votre token d'accès personnel GitLab |
| GITLAB_WEBHOOK_TOKEN | Token secret pour les webhooks GitLab |
| GITHUB_API_URL | URL de l'API GitHub (par défaut : https://api.github.com) |
| GITHUB_API_TOKEN | Votre token d'accès personnel GitHub |
| GITHUB_WEBHOOK_SECRET | Secret pour les webhooks GitHub |

## Améliorations futures

- Persistance en base de données (PostgreSQL/MongoDB)
- Règles de revue personnalisées
- Authentification et autorisation des utilisateurs
- Historique des revues et analytiques
- Support pour plusieurs fournisseurs d'IA
- Systèmes de contrôle de version supplémentaires (Bitbucket, Azure DevOps)

## Licence

[MIT](LICENSE)
