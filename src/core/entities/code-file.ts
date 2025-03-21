export enum DiffType {
  ADDED = 'added',
  DELETED = 'deleted',
  UNCHANGED = 'unchanged'
}

export interface FileDiff {
  lineNumber: number | null;
  content: string;
  type: DiffType;
}

export class CodeFile {
  constructor(
    public readonly path: string,
    public readonly content: string,
    public readonly language: string,
    public readonly diffs: FileDiff[]
  ) {}
}
