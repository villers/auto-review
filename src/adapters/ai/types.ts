/**
 * Configuration pour les modèles d'IA
 */
export interface AIModelConfig {
  name: string;
  apiEndpoint: string;
  apiVersion: string;
  temperature?: number;
  maxTokens?: number;
}
