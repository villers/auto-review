/**
 * Configuration pour la connexion à l'API
 */
export interface ApiConfig {
  baseUrl: string;
  authHeaders: Record<string, string>;
}

/**
 * Types pour les réponses d'API GitLab
 */
export interface DiffRefs {
  base_sha: string;
  start_sha: string;
  head_sha: string;
}

export interface MergeRequestChange {
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  diff: string;
}

export interface MergeRequestChanges {
  changes: MergeRequestChange[];
  diff_refs: DiffRefs;
  source_branch: string;
  target_branch: string;
}

export interface Note {
  id: number;
  body: string;
}

export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified';
